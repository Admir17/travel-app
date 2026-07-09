import { WalletIcon } from "@/components/icons";

/**
 * Placeholder content for the "Finances" tab.
 *
 * This is where trip budgets, expense tracking, and currency conversion
 * will live. For now it shows a static summary card grid to establish the
 * visual pattern that real budget/expense data will later populate.
 */
export default function FinancesTab() {
  const summaryCards = [
    { label: "Total budget", value: "$0.00" },
    { label: "Spent so far", value: "$0.00" },
    { label: "Remaining", value: "$0.00" },
  ];

  return (
    <section className="flex h-full flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Finances
        </h1>
        <p className="mt-1 max-w-xl text-sm text-zinc-600 dark:text-zinc-400">
          Track your trip budget, log expenses, and keep an eye on currency
          conversions as you travel.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {summaryCards.map((card) => (
          <div
            key={card.label}
            className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
              {card.label}
            </p>
            <p className="mt-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
              {card.value}
            </p>
          </div>
        ))}
      </div>

      <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex flex-col items-center gap-3 p-10 text-center">
          <WalletIcon className="h-12 w-12 text-zinc-400 dark:text-zinc-600" />
          <p className="text-sm text-zinc-500 dark:text-zinc-500">
            An expense list and charts will render here.
          </p>
        </div>
      </div>
    </section>
  );
}
