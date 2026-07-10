"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import { MeshPhongMaterial } from "three";
import { useTravelStore } from "@/store/useTravelStore";

/**
 * ARCHITECTURE NOTE — why this component uses react-globe.gl instead of
 * hand-written react-three-fiber (as the first version of this file did):
 *
 * Rendering real country borders means turning GeoJSON polygons (nested
 * arrays of [lng, lat] rings, some countries as MultiPolygons, some
 * crossing the antimeridian) into curved 3D meshes on a sphere, then
 * wiring up hover/click picking against those meshes by hand. That's a
 * meaningful chunk of computational-geometry code to write and maintain
 * ourselves. react-globe.gl (a React wrapper around the battle-tested
 * globe.gl / three-globe libraries) already solves exactly this problem:
 * give it `polygonsData` (raw GeoJSON features) and it handles the
 * sphere projection, hover/click picking, and per-feature styling for us.
 * It also exposes `pointOfView()`, a single bounded animated camera
 * transition — which is what fixes the "camera snaps back after dragging"
 * bug from the previous version (see the comment on the activeDestination
 * effect below for why).
 *
 * Trade-off: react-globe.gl renders its own <canvas> via a plain
 * three.js renderer, not through an <r3f Canvas>, so it can no longer sit
 * inside our r3f scene graph — but since this was the only component using
 * react-three-fiber/@react-three/drei, those packages have been removed
 * entirely instead of kept around unused. `three` itself is still a direct
 * dependency: react-globe.gl's own dependency chain requires it anyway, and
 * keeping our own top-level copy at a version it accepts (>=0.179) lets npm
 * deduplicate everything onto a single shared copy rather than bundling two.
 */

// Same-origin static file (see public/data/countries.geojson) rather than
// fetching from an external URL at runtime. The data originates from
// Natural Earth's public-domain 110m admin-0 countries dataset (low
// resolution, ~180 features, suitable for a full-globe view); we stripped
// it down from ~65 metadata columns per country to just the two fields
// this UI actually reads, roughly halving the payload size.
const COUNTRIES_GEOJSON_URL = "/data/countries.geojson";

// How far the camera sits from the globe's center when flying to a
// destination, in react-globe.gl's "altitude" units (1 == one globe
// radius above the surface). Smaller = more zoomed in.
const FLY_TO_ALTITUDE = 1.8;
// Duration (ms) of the animated camera transition triggered by selecting
// a new activeDestination.
const FLY_TO_DURATION_MS = 1500;

const HOVER_COLOR = "#f97316"; // matches the accent color used elsewhere in the app

/** The two properties we kept when trimming the source GeoJSON (see the URL comment above). */
interface CountryProperties {
  ADMIN: string; // display name, e.g. "France"
  ISO_A2: string; // 2-letter country code, e.g. "FR"
}

/** A single country polygon/multipolygon feature, as react-globe.gl expects to receive it. */
interface CountryFeature {
  type: "Feature";
  properties: CountryProperties;
  geometry: { type: string; coordinates: unknown };
}

/**
 * Derives a stable fill color from a country's ISO code via a simple
 * string hash. "Stable" means the same country always gets the same
 * color across renders and reloads, without us having to ship or maintain
 * a hand-picked color list for ~180 countries.
 */
function colorForCountry(iso: string): string {
  let hash = 0;
  for (let i = 0; i < iso.length; i++) {
    hash = (hash * 31 + iso.charCodeAt(i)) | 0; // |0 keeps this a 32-bit int, like Java's String.hashCode
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 42%)`;
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

  // Country borders, fetched once on mount from our own /public folder.
  const [countries, setCountries] = useState<CountryFeature[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch(COUNTRIES_GEOJSON_URL)
      .then((response) => response.json())
      .then((data: { features: CountryFeature[] }) => {
        if (!cancelled) setCountries(data.features);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Tracks whichever country the mouse is currently over, purely to drive
  // the hover-highlight color below — it never touches the store.
  const [hoveredCountry, setHoveredCountry] = useState<CountryFeature | null>(null);

  // A plain (non-textured) material for the globe's surface: a deep ocean
  // blue, matching the previous R3F version's color. useMemo avoids
  // creating a new THREE.Material instance (and re-triggering globe.gl's
  // internal material update) on every render.
  const globeMaterial = useMemo(
    () => new MeshPhongMaterial({ color: "#0b2545", shininess: 8 }),
    [],
  );

  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const activeDestination = useTravelStore((state) => state.activeDestination);
  const setActiveDestination = useTravelStore((state) => state.setActiveDestination);

  /**
   * BUG FIX — the previous r3f version's camera used to "snap back" after
   * a manual drag. That happened because its useFrame loop unconditionally
   * lerped the camera toward the target *every single frame, forever*,
   * regardless of whether the user was dragging — so a few frames after
   * you let go of the mouse, that same loop pulled the camera right back.
   *
   * pointOfView() does not have that problem: it's a single, time-boxed
   * animated transition (runs for FLY_TO_DURATION_MS, then stops calling
   * itself entirely). Once it's done, react-globe.gl's internal
   * OrbitControls fully own the camera again with nothing fighting them.
   * This effect body only *starts* that transition — it never runs on a
   * per-frame loop — which is what "decouples" programmatic fly-to
   * animation from manual dragging: they simply never execute at the same
   * time. Dragging mid-flight will feel like grabbing the camera off its
   * flight path, exactly as expected, with no fight to snap back to.
   */
  useEffect(() => {
    if (!activeDestination || !globeRef.current) return;
    const { lat, lng } = activeDestination.coordinates;
    globeRef.current.pointOfView({ lat, lng, altitude: FLY_TO_ALTITUDE }, FLY_TO_DURATION_MS);
  }, [activeDestination]);

  // Clicking a country updates the shared store. `coords` here is the
  // exact lat/lng under the mouse at the moment of the click (react-
  // globe.gl computes this for us), which is simpler and more robust than
  // deriving a "representative point" ourselves — a naive bounding-box
  // centroid breaks down for countries that cross the antimeridian (e.g.
  // Russia, Fiji) or have far-flung territories (e.g. France/French
  // Guiana), whereas "wherever you actually clicked" has none of those
  // edge cases.
  const handlePolygonClick = useCallback(
    (polygon: object, _event: MouseEvent, coords: { lat: number; lng: number }) => {
      const feature = polygon as CountryFeature;
      setActiveDestination({
        name: feature.properties.ADMIN,
        coordinates: { lat: coords.lat, lng: coords.lng },
      });
    },
    [setActiveDestination],
  );

  const getCapColor = useCallback(
    (polygon: object) => {
      const feature = polygon as CountryFeature;
      return feature === hoveredCountry ? HOVER_COLOR : colorForCountry(feature.properties.ISO_A2);
    },
    [hoveredCountry],
  );

  // The exact active-destination point, shown as a small marker distinct
  // from the (whole-country) hover/selection fill — useful when the
  // destination is a specific city rather than a country's centroid.
  const markerData = activeDestination
    ? [{ lat: activeDestination.coordinates.lat, lng: activeDestination.coordinates.lng }]
    : [];

  return (
    <div ref={containerRef} className="h-full w-full">
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
          atmosphereColor="#5fa8d3"
          showGraticules
          polygonsData={countries}
          polygonCapColor={getCapColor}
          polygonSideColor={() => "rgba(0, 0, 0, 0.15)"}
          polygonStrokeColor={() => "#0f172a"}
          polygonAltitude={(polygon) => (polygon === hoveredCountry ? 0.02 : 0.01)}
          polygonLabel={(polygon) => (polygon as CountryFeature).properties.ADMIN}
          polygonsTransitionDuration={200}
          onPolygonHover={(polygon) => setHoveredCountry(polygon as CountryFeature | null)}
          onPolygonClick={handlePolygonClick}
          pointsData={markerData}
          pointLat="lat"
          pointLng="lng"
          pointColor={() => HOVER_COLOR}
          pointAltitude={0.02}
          pointRadius={0.4}
        />
      )}
    </div>
  );
}
