import { SparklesIcon } from "@/components/icons";

/**
 * Placeholder content for the "AI Planner" tab.
 *
 * This is where a chat-style interface will connect to an LLM to help
 * generate itineraries, suggest activities, and answer travel questions.
 * For now it shows a static mock of a chat panel so the layout and
 * interaction pattern can be reviewed before wiring up a real model.
 */
export default function AiPlannerTab() {
  return (
    <section className="flex h-full flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          AI Planner
        </h1>
        <p className="mt-1 max-w-xl text-sm text-zinc-600 dark:text-zinc-400">
          Chat with your AI travel assistant to draft a day-by-day itinerary
          based on your budget, dates, and interests.
        </p>
      </header>

      <div className="flex flex-1 flex-col justify-end gap-3 rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 p-6 dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex items-center gap-3 text-zinc-400 dark:text-zinc-600">
          <SparklesIcon className="h-6 w-6" />
          <p className="text-sm">
            The AI chat interface will render here.
          </p>
        </div>
        <div className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-400 dark:border-zinc-700 dark:bg-black dark:text-zinc-600">
          Ask the AI planner anything about your trip&hellip;
        </div>
      </div>
    </section>
  );
}
