import dynamic from "next/dynamic";

// GlobeView renders a react-three-fiber <Canvas>, which needs real browser
// WebGL/ResizeObserver APIs that don't exist during Next.js's server-side
// render pass. Loading it with `ssr: false` skips that component on the
// server and mounts it only once the page is running in the browser,
// which is the standard way to use react-three-fiber inside the App
// Router without triggering a server-render crash.
const GlobeView = dynamic(() => import("@/components/GlobeView"), {
  ssr: false,
});

/**
 * Content for the "Globe" tab: an interactive 3D Earth that stays in sync
 * with the active destination in useTravelStore (see GlobeView.tsx).
 */
export default function GlobeTab() {
  return (
    <section className="flex h-full flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Globe
        </h1>
        <p className="mt-1 max-w-xl text-sm text-zinc-600 dark:text-zinc-400">
          Explore destinations visually on an interactive 3D globe. Spin,
          zoom, and pick a country to start planning a trip there.
        </p>
      </header>

      <div className="min-h-[400px] flex-1 overflow-hidden rounded-2xl border border-zinc-300 bg-zinc-950 dark:border-zinc-700">
        <GlobeView />
      </div>
    </section>
  );
}
