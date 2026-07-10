"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import {
  AmbientLight,
  CanvasTexture,
  ConeGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshPhongMaterial,
  type Object3D,
  SRGBColorSpace,
  SphereGeometry,
  Vector3,
} from "three";
import { type ActiveDestination, useTravelStore } from "@/store/useTravelStore";

/**
 * ARCHITECTURE NOTE — how react-globe.gl actually renders/animates, and
 * why the styling below is procedural rather than photographic:
 *
 * react-globe.gl (a React wrapper around globe.gl / three-globe) owns a
 * single requestAnimationFrame loop (see three-render-objects' internal
 * `_animationCycle`). On every tick, in order:
 *   1. `controls.update(delta)` — advances OrbitControls, reading the
 *      camera's *current* live position/target every tick (it never
 *      remembers an old target, so whatever last touched the camera wins).
 *   2. `tweenGroup.update()` — advances any active @tweenjs/tween.js
 *      tweens. `pointOfView()` creates exactly one such tween that
 *      interpolates lat/lng/altitude over a fixed duration, then removes
 *      itself. That's why programmatic fly-to and manual dragging never
 *      fight each other: the tween is temporary and self-removing, while
 *      OrbitControls only reacts to actual pointer input plus damping.
 *   3. `renderer.render(scene, camera)` — draws the frame.
 *
 * An earlier version of this component used a photographic Blue Marble
 * texture (plus bump + specular map images). That looked "realistic" but
 * came with three real costs: it's blurry once you zoom in past the
 * texture's native resolution, it's three image decodes plus per-fragment
 * bump/specular sampling on every rendered frame, and it visually clashed
 * with the "clean, stylized" look we actually want. This version instead
 * colors the globe procedurally — no image texture at all:
 *   - The ocean is a tiny (2×256px) canvas gradient, generated once at
 *     runtime, not loaded over the network. Since it's just two color
 *     stops, it's resolution-independent (never blurry) and effectively
 *     free to render.
 *   - Each country's fill color is computed once from its own GeoJSON
 *     geometry (its center latitude), not sampled from an image at all.
 * Both go from a warm tone near the equator to a cool tone near the
 * poles, which is the "warm/cold" effect requested — just stylized
 * instead of a satellite photo.
 */

// Same-origin static file (see public/data/countries.geojson) rather than
// an external URL. Natural Earth's public-domain 110m admin-0 countries
// dataset, trimmed to just the two properties this UI reads.
const COUNTRIES_GEOJSON_URL = "/data/countries.geojson";

// Marker for the exact active-destination point (distinct from the
// country hover-highlight below) — a real map-pin shape, not a flat dot.
const PIN_COLOR = "#dc2626";

// --- Pin drop animation -------------------------------------------------
// Fractions of the globe's own radius (see createPinObject's comment for
// why this must be relative rather than an absolute number): the pin
// starts well above the surface and eases down to just above it.
const PIN_START_ALTITUDE = 0.6;
const PIN_REST_ALTITUDE = 0.02;
const PIN_DROP_DURATION_MS = 900;

/**
 * Eases toward 1 with a small overshoot past it before settling back —
 * applied to the pin's altitude, this reads as "it fell, dipped slightly
 * into the surface, then springs back to resting height," a much more
 * tactile "it landed" feel than a linear slide would give.
 */
function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/**
 * Builds the pin mesh: a cone (the pointed tip) topped with a sphere (the
 * rounded head) — the classic map-pin silhouette, built once and reused
 * for the lifetime of the component (there's only ever 0 or 1 pins).
 *
 * Built with its local origin at the very tip, extending upward from
 * there (+Y), so positioning it later is just "put the tip at this exact
 * point" rather than needing to offset for the shape's own bounding box.
 *
 * Sized as a fraction of `globeRadius` rather than a fixed number:
 * react-globe.gl's declarative props (pointRadius, polygonAltitude, etc.)
 * normalize distances for you, but this custom-layer mesh is placed with
 * raw Three.js coordinates via getCoords() — and three-globe's internal
 * globe radius is 100 scene units, not 1. Deriving the size from
 * getGlobeRadius() (rather than hardcoding 100) keeps this correct even
 * if that internal constant ever changes.
 */
function createPinObject(globeRadius: number): Object3D {
  const headRadius = globeRadius * 0.012;
  const tipHeight = globeRadius * 0.032;

  const material = new MeshPhongMaterial({
    color: PIN_COLOR,
    specular: "#ffffff",
    shininess: 90,
  });

  // ConeGeometry is centered on its own origin by default (tip at
  // +height/2, base at -height/2). Flipping it 180° swaps that, then
  // shifting up by half its height moves the tip to local (0,0,0) and the
  // base to (0, tipHeight, 0) — "origin at the tip, extending upward."
  const coneGeometry = new ConeGeometry(headRadius * 0.55, tipHeight, 20);
  coneGeometry.rotateX(Math.PI);
  coneGeometry.translate(0, tipHeight / 2, 0);
  const cone = new Mesh(coneGeometry, material);

  const sphereGeometry = new SphereGeometry(headRadius, 20, 20);
  const sphere = new Mesh(sphereGeometry, material);
  // Overlaps slightly into the cone's base for a seamless joint, rather
  // than a visible seam where the two shapes meet.
  sphere.position.set(0, tipHeight + headRadius * 0.7, 0);

  const pin = new Group();
  pin.add(cone, sphere);
  return pin;
}

// --- Warm/cold palette: "Jewel Tone Atlas" -----------------------------
// Ocean: rich teal-blue near the equator, deep sapphire navy near the poles.
const OCEAN_WARM: RGB = { r: 0x0f, g: 0x6e, b: 0x8c };
const OCEAN_COLD: RGB = { r: 0x0a, g: 0x26, b: 0x47 };
// Land: emerald green near the equator, warm gold/tundra (not pale ice)
// near the poles — keeps the poles rich and saturated instead of washed out.
const LAND_WARM: RGB = { r: 0x1f, g: 0x7a, b: 0x53 };
const LAND_COLD: RGB = { r: 0xc9, g: 0xa8, b: 0x6a };

interface RGB {
  r: number;
  g: number;
  b: number;
}

/** Linear-interpolates between two RGB colors; t=0 -> a, t=1 -> b. */
function mixRgb(a: RGB, b: RGB, t: number): RGB {
  const clamped = Math.min(Math.max(t, 0), 1);
  return {
    r: Math.round(a.r + (b.r - a.r) * clamped),
    g: Math.round(a.g + (b.g - a.g) * clamped),
    b: Math.round(a.b + (b.b - a.b) * clamped),
  };
}

function rgbToCss(color: RGB, alpha = 1): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
}

/** Warm at the equator, cold at either pole — `t` is 0 (equator) to 1 (pole). */
function temperatureRgb(lat: number, warm: RGB, cold: RGB): RGB {
  return mixRgb(warm, cold, Math.abs(lat) / 90);
}

/**
 * Builds the tiny procedural ocean gradient described in the
 * component-level comment above. Symmetric top-to-bottom (cold at both
 * the very top and very bottom of the texture, warm in the middle), which
 * conveniently means we don't need to worry about which end of the
 * texture maps to which pole — both poles want the same "cold" color.
 */
function createOceanTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, rgbToCss(OCEAN_COLD));
  gradient.addColorStop(0.5, rgbToCss(OCEAN_WARM));
  gradient.addColorStop(1, rgbToCss(OCEAN_COLD));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new CanvasTexture(canvas);
  // Tags this as a color/albedo texture (as opposed to e.g. a bump or
  // specular map), matching how three-globe tags its own loaded color
  // textures — keeps the colors rendering the way they were authored.
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** The two properties we kept when trimming the source GeoJSON (see public/data/countries.geojson). */
interface CountryProperties {
  ADMIN: string; // display name, e.g. "France"
  ISO_A2: string; // 2-letter country code, e.g. "FR"
}

/** A single country polygon/multipolygon feature, as fetched from the GeoJSON file. */
interface CountryFeature {
  type: "Feature";
  properties: CountryProperties;
  geometry: { type: string; coordinates: unknown };
}

/**
 * A country feature augmented with values computed once when the GeoJSON
 * loads, rather than recomputed on every render/hover/click. react-globe.gl
 * hands the exact same object reference back through its callbacks, so
 * stashing extra fields directly on it is a cheap, simple cache.
 */
interface PreparedCountry extends CountryFeature {
  centerLat: number;
  centerLng: number;
  /** Rough angular size in degrees (max of its lat/lng span) — used to size the camera fly-to. */
  angularExtent: number;
  restColor: string;
  hoverColor: string;
}

/**
 * Recursively flattens a GeoJSON Polygon's or MultiPolygon's nested
 * coordinate arrays down to a flat list of [lng, lat] pairs. Polygons are
 * nested 3 levels deep (rings -> points -> [lng, lat]) and MultiPolygons 4
 * levels deep (polygons -> rings -> points -> [lng, lat]); recursing until
 * we hit a 2-number array handles both shapes with the same code.
 */
function collectLngLatPairs(coords: unknown, out: [number, number][]): void {
  if (!Array.isArray(coords)) return;
  if (coords.length === 2 && typeof coords[0] === "number" && typeof coords[1] === "number") {
    out.push(coords as [number, number]);
    return;
  }
  for (const child of coords) collectLngLatPairs(child, out);
}

/** Planar (shoelace) area of a single ring — not true geographic area, but
 * good enough as a relative "how big is this polygon" comparison. */
function ringArea(ring: [number, number][]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

/**
 * For a MultiPolygon, returns the coordinates of just its largest
 * constituent polygon (by outer-ring area) — for a plain Polygon, returns
 * its coordinates unchanged.
 *
 * This exists to fix a real bug: France's geometry in this dataset is a
 * MultiPolygon that includes French Guiana as a separate landmass
 * thousands of kilometers away in South America. Averaging every point
 * across the *whole* feature (mainland France + French Guiana) lands the
 * center in the middle of the Atlantic Ocean — visibly wrong, since it
 * puts both the marker and the camera's fly-to target in open sea. Using
 * only the largest landmass sidesteps this for France and every other
 * country with small far-flung territories (e.g. the Netherlands'
 * Caribbean islands, Norway's Svalbard) without needing per-country
 * special-casing.
 */
function selectPrimaryPolygonCoordinates(geometry: CountryFeature["geometry"]): unknown {
  if (geometry.type !== "MultiPolygon") return geometry.coordinates;

  const polygons = geometry.coordinates as unknown as number[][][][];
  let largest = polygons[0];
  let largestArea = -Infinity;
  for (const polygon of polygons) {
    const outerRing = polygon[0] as unknown as [number, number][];
    const area = ringArea(outerRing);
    if (area > largestArea) {
      largestArea = area;
      largest = polygon;
    }
  }
  return largest;
}

/**
 * Computes a country's center point and rough angular size from its raw
 * geometry — specifically, from just its largest landmass (see
 * selectPrimaryPolygonCoordinates above). Longitude still needs special
 * handling for countries whose main landmass itself crosses the
 * antimeridian (Russia, Fiji): a plain min/max would average their
 * far-east and far-west points into a meaningless center near longitude 0.
 * We detect that case (span > 180°) and "unwrap" by shifting negative
 * longitudes by +360° before averaging, then wrap the result back into
 * [-180, 180]. This is a simple bounding-box heuristic, not a true
 * area-weighted centroid — good enough for "roughly center the camera on
 * this country," not for precision geo work.
 */
function computeCountryBounds(feature: CountryFeature): {
  centerLat: number;
  centerLng: number;
  angularExtent: number;
} {
  const points: [number, number][] = [];
  collectLngLatPairs(selectPrimaryPolygonCoordinates(feature.geometry), points);

  let minLat = Infinity;
  let maxLat = -Infinity;
  let rawMinLng = Infinity;
  let rawMaxLng = -Infinity;
  for (const [lng, lat] of points) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < rawMinLng) rawMinLng = lng;
    if (lng > rawMaxLng) rawMaxLng = lng;
  }

  const crossesAntimeridian = rawMaxLng - rawMinLng > 180;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const [lng] of points) {
    const adjusted = crossesAntimeridian && lng < 0 ? lng + 360 : lng;
    if (adjusted < minLng) minLng = adjusted;
    if (adjusted > maxLng) maxLng = adjusted;
  }

  const centerLat = (minLat + maxLat) / 2;
  let centerLng = (minLng + maxLng) / 2;
  if (crossesAntimeridian) centerLng = ((centerLng + 540) % 360) - 180;

  return {
    centerLat,
    centerLng,
    angularExtent: Math.max(maxLat - minLat, maxLng - minLng),
  };
}

/** Precomputes center/color/extent for every country once, when the GeoJSON first loads. */
function prepareCountries(features: CountryFeature[]): PreparedCountry[] {
  return features.map((feature) => {
    const { centerLat, centerLng, angularExtent } = computeCountryBounds(feature);
    const base = temperatureRgb(centerLat, LAND_WARM, LAND_COLD);
    return {
      ...feature,
      centerLat,
      centerLng,
      angularExtent,
      restColor: rgbToCss(base, 0.92),
      // Hover = lighten toward white, rather than swapping to a different
      // hue — reads as "this country is glowing/highlighted" rather than
      // a jarring color change.
      hoverColor: rgbToCss(mixRgb(base, { r: 255, g: 255, b: 255 }, 0.5), 0.96),
    };
  });
}

// --- Camera fly-to sizing ----------------------------------------------
// Maps a country's angular size (degrees) to a react-globe.gl "altitude"
// (camera distance in globe-radii). Small countries get a close zoom,
// large ones a wider one, both clamped to a sane range so we never end up
// uncomfortably close (feels like clipping into the globe) or barely
// zoomed at all. These constants were tuned by eye against a small
// country (e.g. Luxembourg, ~1° extent), a mid-sized one (e.g. Germany,
// ~10°), and a very large one (e.g. Russia, ~100°+ even after the
// antimeridian correction above).
const MIN_FLY_TO_ALTITUDE = 0.3;
const MAX_FLY_TO_ALTITUDE = 2.2;
const REFERENCE_EXTENT_DEGREES = 90;
const FLY_TO_DURATION_MS = 1600;

function altitudeForExtent(angularExtent: number): number {
  const raw =
    MIN_FLY_TO_ALTITUDE +
    (angularExtent / REFERENCE_EXTENT_DEGREES) * (MAX_FLY_TO_ALTITUDE - MIN_FLY_TO_ALTITUDE);
  return Math.min(Math.max(raw, MIN_FLY_TO_ALTITUDE), MAX_FLY_TO_ALTITUDE);
}

export default function GlobeView() {
  // Measures the wrapping div's pixel size. Unlike r3f's <Canvas>, which
  // fills its parent automatically via CSS, react-globe.gl's <Globe>
  // takes explicit numeric width/height props, so we track them ourselves
  // with a ResizeObserver and re-render whenever the container resizes.
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Country borders, fetched once on mount from our own /public folder,
  // then precomputed once via prepareCountries (see its comment for why).
  const [countries, setCountries] = useState<PreparedCountry[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch(COUNTRIES_GEOJSON_URL)
      .then((response) => response.json())
      .then((data: { features: CountryFeature[] }) => {
        if (!cancelled) setCountries(prepareCountries(data.features));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Tracks whichever country the mouse is currently over, purely to drive
  // the hover-highlight fill below — it never touches the store.
  const [hoveredCountry, setHoveredCountry] = useState<PreparedCountry | null>(null);

  /**
   * The globe's surface material — visible only where it peeks through
   * gaps between countries, i.e. the ocean, since land is entirely
   * covered by the opaque country polygons above it. A plain
   * MeshPhongMaterial with a uniform (non-mapped) specular gives the
   * ocean a soft sheen — cheap to render, since Phong's specular term is
   * just a per-fragment dot product, unlike the old version's specular
   * *map* which needed an extra texture sample per fragment.
   */
  const globeMaterial = useMemo(
    () =>
      new MeshPhongMaterial({
        map: createOceanTexture(),
        specular: "#1c3b45",
        shininess: 20,
      }),
    [],
  );

  const globeRef = useRef<GlobeMethods | undefined>(undefined);

  // Custom lighting: overrides react-globe.gl's default lights() once on
  // mount. The default directional light sits directly overhead (0,1,0),
  // which barely moves the specular hot-spot during typical left/right
  // dragging. Placing it off to one side instead — like real sunlight,
  // fixed in world space rather than attached to the camera — means that
  // as OrbitControls orbits the camera around the (stationary) globe, the
  // angle between the view direction and the light direction keeps
  // changing, so the ocean's specular highlight visibly slides across the
  // surface as you drag. Intensities are scaled by Math.PI to match
  // three-globe's own defaults, which target three.js's physically-based
  // lighting model (three r155+).
  useEffect(() => {
    if (!globeRef.current) return;
    const ambient = new AmbientLight(0xffffff, 0.75 * Math.PI);
    const sun = new DirectionalLight(0xffffff, 1.1 * Math.PI);
    sun.position.set(1, 0.6, 0.6);
    globeRef.current.lights([ambient, sun]);
  }, []);

  const activeDestination = useTravelStore((state) => state.activeDestination);
  const setActiveDestination = useTravelStore((state) => state.setActiveDestination);

  /**
   * activeDestination lives in the shared store deliberately, so it
   * survives switching to the AI Planner or Finances tab and back — other
   * features may want that context later. But this component itself
   * fully unmounts and remounts every time the user switches away from
   * and back to the Globe tab (that's what the intro "twist" on re-open
   * is: a fresh WebGL scene), and it would otherwise immediately re-fly
   * the camera to and re-drop a pin for whatever destination happens to
   * still be sitting in the store from before — stale state resurfacing
   * as if it just happened.
   *
   * `confirmedDestination` filters that out: it's null for whatever was
   * already in the store when this component mounted, and only updates to
   * match activeDestination for a genuinely new selection made while this
   * view is open. The two effects below (and pinData) key off this
   * instead of activeDestination directly.
   *
   * This uses React's documented "adjusting state when a prop changes"
   * pattern — comparing against the previous render's value and calling
   * setState conditionally *during render* — rather than a ref checked
   * inside an effect. A ref would need its `.current` read during render
   * (inside the pinData memo below) to filter the very first value, and
   * reading a ref during render is exactly what refs aren't for; doing the
   * comparison with state instead keeps this pure and effect-free.
   */
  const [prevActiveDestination, setPrevActiveDestination] = useState(activeDestination);
  const [confirmedDestination, setConfirmedDestination] = useState<ActiveDestination | null>(null);
  if (activeDestination !== prevActiveDestination) {
    setPrevActiveDestination(activeDestination);
    setConfirmedDestination(activeDestination);
  }

  // The store's ActiveDestination only carries a name and coordinates —
  // deliberately not a camera altitude, since "how far the camera should
  // sit" is a Globe-rendering detail that other consumers of the store
  // (AI Planner, Finances) have no reason to know about. Instead, we keep
  // the last-clicked country's angular size in a ref, sized purely for
  // this component's own use in the fly-to effect below.
  const lastSelectedExtentRef = useRef(REFERENCE_EXTENT_DEGREES);

  /**
   * Flies the camera to the active destination whenever it changes. This
   * effect only *starts* a bounded animated transition (see the
   * component-level comment above for what pointOfView()'s tween actually
   * does) — it never runs on a per-frame loop, so it can't fight a manual
   * drag the way a naive "lerp every frame forever" implementation would.
   */
  useEffect(() => {
    if (!confirmedDestination || !globeRef.current) return;
    const { lat, lng } = confirmedDestination.coordinates;
    const altitude = altitudeForExtent(lastSelectedExtentRef.current);
    globeRef.current.pointOfView({ lat, lng, altitude }, FLY_TO_DURATION_MS);
  }, [confirmedDestination]);

  // Clicking a country centers and zooms the camera on that country as a
  // whole (its precomputed center + a size-appropriate altitude), rather
  // than on the exact pixel the user happened to click — "select this
  // country," not "select this specific spot within it."
  const handlePolygonClick = useCallback(
    (polygon: object) => {
      const country = polygon as PreparedCountry;
      lastSelectedExtentRef.current = country.angularExtent;
      setActiveDestination({
        name: country.properties.ADMIN,
        coordinates: { lat: country.centerLat, lng: country.centerLng },
      });
    },
    [setActiveDestination],
  );

  const getCapColor = useCallback(
    (polygon: object) => {
      const country = polygon as PreparedCountry;
      return country === hoveredCountry ? country.hoverColor : country.restColor;
    },
    [hoveredCountry],
  );

  // The exact confirmed-destination point, shown as a small pin distinct
  // from the (whole-country) hover highlight. Deliberately holds only
  // lat/lng, not a timestamp — "when was this selected" is purely an
  // animation-timing concern (see the drop-animation effect below), not
  // data the globe layer itself needs, so it doesn't belong in this memo.
  // Keyed off confirmedDestination (not activeDestination) so it stays
  // empty for a stale leftover destination from before this mount — no pin
  // mesh is even created for one, rather than one appearing frozen at its
  // starting altitude with nothing to ever animate it down.
  const pinData = useMemo<{ lat: number; lng: number }[]>(() => {
    if (!confirmedDestination) return [];
    return [{ lat: confirmedDestination.coordinates.lat, lng: confirmedDestination.coordinates.lng }];
  }, [confirmedDestination]);

  // Holds the currently-live pin mesh, so the animation effect below can
  // mutate its position directly every frame.
  //
  // IMPORTANT CORRECTION: an earlier version of this animation used
  // react-globe.gl's `customThreeObjectUpdate` prop, assuming (per its
  // name) that it ran continuously like a real per-frame animation hook.
  // Checking three-globe's actual source proved that wrong: this library
  // is built on the "kapsule" pattern, where `update()` (and therefore
  // customThreeObjectUpdate) only re-runs when a *prop value changes* —
  // exactly once per new activeDestination, the same as a d3 data-join's
  // "update" selection, never on a timer. That's why the pin used to
  // compute its (high, mid-air) starting position once and then freeze
  // there forever instead of falling: the callback simply never ran
  // again. The actual continuous per-frame loop (three-render-objects'
  // `_animationCycle`, see the component-level comment) only calls
  // `controls.update()`, `tweenGroup.update()`, and `renderer.render()` —
  // it does not re-invoke each layer's reactive update function. So this
  // component now drives the animation itself with a plain
  // requestAnimationFrame loop, mutating the mesh directly; the render
  // loop just draws whatever's in the scene graph each frame regardless
  // of how it got there, so a direct mutation is picked up automatically.
  const pinObjectRef = useRef<Object3D | null>(null);
  const pinAnimationFrameRef = useRef<number | null>(null);

  // Called once per selection to create the pin mesh (react-globe.gl's
  // custom layer calls this when a datum enters, or — since this library
  // has no update accessor to diff against here — on every subsequent
  // change too, recreating it fresh each time; harmless, since there's
  // only ever 0 or 1 pins). Positions it at its starting (high) altitude
  // immediately and synchronously, so the very first rendered frame
  // already shows it in the right place rather than flashing at the scene
  // origin before the animation effect's first tick runs.
  const createPin = useCallback((datum: object) => {
    const globeRadius = globeRef.current?.getGlobeRadius() ?? 100;
    const pin = createPinObject(globeRadius);
    pinObjectRef.current = pin;

    const { lat, lng } = datum as { lat: number; lng: number };
    if (globeRef.current) {
      const { x, y, z } = globeRef.current.getCoords(lat, lng, PIN_START_ALTITUDE);
      pin.position.set(x, y, z);
    }
    return pin;
  }, []);

  /**
   * Drives the pin's drop animation directly, independent of React's
   * render cycle: this effect only *starts* a self-scheduling
   * requestAnimationFrame loop when confirmedDestination changes (and its
   * cleanup cancels that loop if a new selection interrupts it), rather
   * than running the animation math on every React render.
   */
  useEffect(() => {
    if (!confirmedDestination) return;
    const { lat, lng } = confirmedDestination.coordinates;
    const startTime = Date.now();

    const tick = () => {
      const globe = globeRef.current;
      const pin = pinObjectRef.current;
      if (globe && pin) {
        const progress = Math.min((Date.now() - startTime) / PIN_DROP_DURATION_MS, 1);
        const altitude = PIN_START_ALTITUDE + (PIN_REST_ALTITUDE - PIN_START_ALTITUDE) * easeOutBack(progress);

        const { x, y, z } = globe.getCoords(lat, lng, altitude);
        pin.position.set(x, y, z);
        // Orients the pin so its tip (local +Y — see createPinObject)
        // points outward along the surface normal at this exact point,
        // i.e. straight "up" away from the globe here, rather than every
        // pin sharing one fixed world-space orientation.
        const outwardNormal = new Vector3(x, y, z).normalize();
        pin.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), outwardNormal);

        if (progress >= 1) return; // landed — stop scheduling further frames
      }
      // Either still mid-animation, or the mesh hasn't been created yet
      // (react-globe.gl hasn't processed the prop change) — keep polling.
      pinAnimationFrameRef.current = requestAnimationFrame(tick);
    };

    pinAnimationFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (pinAnimationFrameRef.current !== null) cancelAnimationFrame(pinAnimationFrameRef.current);
    };
  }, [confirmedDestination]);

  return (
    // Premium "sapphire" backdrop, rather than the flat black a
    // transparent globe canvas would otherwise reveal — a plain WebGL
    // clear color reads as "space simulator," not "travel app." Unlike an
    // arbitrary purple/indigo dusk, these three stops are pulled straight
    // from the globe's own ocean palette (near-black navy -> OCEAN_COLD ->
    // a deepened OCEAN_WARM), so the backdrop reads as the ocean's color
    // continuing into the surrounding atmosphere rather than an unrelated
    // hue. The gradient lives here (not in whichever tab embeds this
    // component) so GlobeView looks right on its own regardless of what
    // wraps it. `relative` gives the glow overlay below a positioning
    // context to anchor to.
    <div className="relative h-full w-full overflow-hidden bg-gradient-to-b from-[#030c16] via-[#0a2647] to-[#0f3d4a]">
      {/* Soft horizon glow: a separate radial layer (not a third gradient
          stop above) since a radial shape and a linear sweep don't combine
          into one background-image value cleanly. Kept subtle (15%
          opacity) and colored in orange-500 to echo the app's existing
          accent color. `pointer-events-none` so it never intercepts
          drags/clicks meant for the globe underneath. */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,_rgba(249,115,22,0.15),_transparent_65%)]" />
      <div ref={containerRef} className="relative h-full w-full">
        {/* Guard against mounting a 0x0 canvas before the ResizeObserver
            has reported the container's real size at least once. */}
        {size.width > 0 && size.height > 0 && (
          <Globe
            ref={globeRef}
            width={size.width}
            height={size.height}
            backgroundColor="rgba(0,0,0,0)"
            globeMaterial={globeMaterial}
            showAtmosphere
            atmosphereColor="#cfe8ff"
            atmosphereAltitude={0.13}
            polygonsData={countries}
            polygonCapColor={getCapColor}
            // A subtle dark wall under each cap, for a slight extruded/map-like edge.
            polygonSideColor={() => "rgba(0, 0, 0, 0.15)"}
            // A muted, low-contrast stroke — deliberately subtle rather than
            // a bold cartoon outline. The line itself is already thin by
            // construction: three-globe draws polygon borders with plain
            // WebGL line segments, which render at a fixed ~1px regardless
            // of any width setting on virtually every browser/GPU.
            polygonStrokeColor={() => "rgba(240, 245, 248, 0.65)"}
            polygonAltitude={(polygon) => (polygon === hoveredCountry ? 0.02 : 0.01)}
            polygonLabel={(polygon) => (polygon as PreparedCountry).properties.ADMIN}
            polygonsTransitionDuration={200}
            onPolygonHover={(polygon) => setHoveredCountry(polygon as PreparedCountry | null)}
            onPolygonClick={handlePolygonClick}
            // The "custom layer" (rather than the simpler points layer
            // used previously) is what makes a real 3D pin shape
            // possible — the actual drop animation is driven independently
            // by the effect above, not by this prop. customLayerLabel
            // shows the destination's name on hover, matching the country
            // tooltips above.
            customLayerData={pinData}
            customThreeObject={createPin}
            customLayerLabel={() => confirmedDestination?.name ?? ""}
          />
        )}
      </div>
    </div>
  );
}
