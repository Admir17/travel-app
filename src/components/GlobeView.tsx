"use client";

import { useEffect, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { useTravelStore } from "@/store/useTravelStore";

// Radius of the globe mesh itself, in Three.js scene units. All other
// distances (camera distance, marker placement) are expressed relative to
// this so the whole scene scales together if it's ever tweaked.
const GLOBE_RADIUS = 1;

// How far from the globe's center the camera sits while looking at a
// destination. Kept a bit larger than GLOBE_RADIUS so the whole sphere is
// visible, not just a close-up of the surface.
const CAMERA_DISTANCE = 2.5;

/**
 * Converts geographic coordinates (latitude/longitude, in degrees) into a
 * point on a sphere of the given radius, centered at the origin.
 *
 * This is the standard spherical-to-Cartesian conversion used across most
 * three.js globe demos: latitude maps to the polar angle `phi` (measured
 * from the north pole), longitude maps to the azimuthal angle `theta`.
 * The same formula is reused both to place the destination marker on the
 * globe's surface (radius = GLOBE_RADIUS) and to compute the camera's
 * "looking at this point" position (radius = CAMERA_DISTANCE).
 */
function latLngToVector3(lat: number, lng: number, radius: number): THREE.Vector3 {
  const phi = THREE.MathUtils.degToRad(90 - lat);
  const theta = THREE.MathUtils.degToRad(lng + 180);

  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

/**
 * The Earth mesh: a solid sphere for lighting/shading to act on, plus a
 * slightly larger wireframe sphere on top purely for visual texture (so it
 * reads as a "globe with grid lines" instead of a plain ball). No image
 * texture is used, keeping this dependency-free.
 */
function Earth() {
  return (
    <group>
      <mesh>
        <sphereGeometry args={[GLOBE_RADIUS, 64, 32]} />
        <meshStandardMaterial color="#1b4965" roughness={0.85} metalness={0.05} />
      </mesh>
      {/* Slightly larger radius avoids z-fighting with the solid sphere underneath. */}
      <mesh>
        <sphereGeometry args={[GLOBE_RADIUS * 1.002, 32, 16]} />
        <meshBasicMaterial color="#5fa8d3" wireframe transparent opacity={0.25} />
      </mesh>
    </group>
  );
}

/**
 * A small marker placed on the globe's surface at the active destination's
 * coordinates, so a viewer can visually confirm the camera is converging on
 * the right spot. Renders nothing while no destination is selected.
 */
function DestinationMarker({ lat, lng }: { lat: number; lng: number }) {
  const position = latLngToVector3(lat, lng, GLOBE_RADIUS * 1.01);

  return (
    <mesh position={position}>
      <sphereGeometry args={[0.025, 16, 16]} />
      <meshStandardMaterial color="#f97316" emissive="#f97316" emissiveIntensity={0.6} />
    </mesh>
  );
}

/**
 * Lives inside <Canvas> (required, since it uses R3F's useFrame/useThree
 * hooks) and owns the "fly the camera to the active destination" animation.
 *
 * Design notes:
 * - The target position is stored in a ref, not React state. It only needs
 *   to be *read* every animation frame (in useFrame), so putting it in
 *   state would trigger pointless re-renders 60 times a second for no
 *   benefit.
 * - useEffect recomputes that ref whenever `activeDestination` changes —
 *   this is the "listen for changes" hook the task asks for.
 * - useFrame runs every rendered frame and eases the camera's *actual*
 *   position toward the target using exponential damping (frame-rate
 *   independent, unlike a fixed `lerp(target, 0.05)` which would animate
 *   faster or slower depending on the user's monitor refresh rate).
 * - <OrbitControls> is unaffected by this: on every frame it derives its
 *   own spherical (angle/distance) state from the camera's *current*
 *   position relative to its target, so it simply picks up wherever we
 *   leave the camera rather than fighting our animation.
 */
function CameraRig() {
  const activeDestination = useTravelStore((state) => state.activeDestination);
  const targetPosition = useRef(new THREE.Vector3(0, 0, CAMERA_DISTANCE));

  useEffect(() => {
    if (!activeDestination) return;
    const { lat, lng } = activeDestination.coordinates;
    targetPosition.current = latLngToVector3(lat, lng, CAMERA_DISTANCE);
  }, [activeDestination]);

  useFrame((state, delta) => {
    // Exponential decay towards the target: at each frame we close a
    // fraction of the remaining distance, where that fraction depends on
    // elapsed time (delta) rather than frame count.
    const dampingSpeed = 2; // higher = snappier arrival
    const alpha = 1 - Math.exp(-dampingSpeed * delta);
    state.camera.position.lerp(targetPosition.current, alpha);
  });

  return null;
}

/**
 * The interactive 3D globe. Renders a full-size R3F <Canvas> containing a
 * lit, orbit-controllable Earth sphere, and keeps its camera in sync with
 * `activeDestination` from useTravelStore.
 *
 * Sizing: this component fills its parent container (`w-full h-full`).
 * The parent is responsible for giving that container a real height (e.g.
 * via a flex layout) — a <Canvas> inside a zero-height element renders
 * nothing, since it sizes itself to match its parent rather than the
 * viewport.
 */
export default function GlobeView() {
  return (
    <div className="h-full w-full">
      <Canvas camera={{ position: [0, 0, CAMERA_DISTANCE], fov: 45 }}>
        {/* Ambient light lifts shadows so the dark side of the globe is
            never fully black; directional light gives it a "sun" side. */}
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 3, 5]} intensity={1.2} />

        <Earth />
        <ActiveDestinationMarker />
        <CameraRig />

        <OrbitControls
          enablePan={false}
          minDistance={GLOBE_RADIUS * 1.5}
          maxDistance={GLOBE_RADIUS * 5}
        />
      </Canvas>
    </div>
  );
}

/** Reads the store so <DestinationMarker> only renders once a destination is set. */
function ActiveDestinationMarker() {
  const activeDestination = useTravelStore((state) => state.activeDestination);
  if (!activeDestination) return null;

  const { lat, lng } = activeDestination.coordinates;
  return <DestinationMarker lat={lat} lng={lng} />;
}
