"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import { AmbientLight, CanvasTexture, DirectionalLight, MeshPhongMaterial, SRGBColorSpace } from "three";
import { useTravelStore } from "@/store/useTravelStore";

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
// country hover-highlight below).
const MARKER_COLOR = "#f97316";

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

/**
 * Computes a country's center point and rough angular size from its raw
 * geometry. Longitude needs special handling for countries that cross the
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
  collectLngLatPairs(feature.geometry.coordinates, points);

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
    if (!activeDestination || !globeRef.current) return;
    const { lat, lng } = activeDestination.coordinates;
    const altitude = altitudeForExtent(lastSelectedExtentRef.current);
    globeRef.current.pointOfView({ lat, lng, altitude }, FLY_TO_DURATION_MS);
  }, [activeDestination]);

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

  // The exact active-destination point, shown as a small marker distinct
  // from the (whole-country) hover highlight.
  const markerData = activeDestination
    ? [{ lat: activeDestination.coordinates.lat, lng: activeDestination.coordinates.lng }]
    : [];

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
          into one background-image value cleanly. Kept subtle (15% opacity)
          and colored to match MARKER_COLOR/orange-500 so the backdrop's
          warmth ties back into the destination marker's accent rather than
          introducing an unrelated hue. `pointer-events-none` so it never
          intercepts drags/clicks meant for the globe underneath. */}
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
            pointsData={markerData}
            pointLat="lat"
            pointLng="lng"
            pointColor={() => MARKER_COLOR}
            pointAltitude={0.02}
            pointRadius={0.4}
          />
        )}
      </div>
    </div>
  );
}
