import { GlobeIcon } from "@/components/icons";

/**
 * Placeholder content for the "Globe" tab.
 *
 * This is where an interactive 3D globe (e.g. react-globe.gl or a custom
 * WebGL/Three.js scene) will eventually let users browse destinations
 * visually. For now it renders a static explanatory panel so the tab
 * navigation can be demonstrated end-to-end before the globe itself is
 * built.
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

      <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex flex-col items-center gap-3 p-10 text-center">
          <GlobeIcon className="h-12 w-12 text-zinc-400 dark:text-zinc-600" />
          <p className="text-sm text-zinc-500 dark:text-zinc-500">
            The interactive 3D globe will render here.
          </p>
        </div>
      </div>
    </section>
  );
}
