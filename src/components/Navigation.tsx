"use client";

import { TABS, type TabId } from "@/lib/navigation";
import { GlobeIcon, SparklesIcon, WalletIcon } from "@/components/icons";

// Maps each tab id to its icon component. Kept next to Navigation (rather
// than in lib/navigation.ts) because icons are a presentation detail, while
// lib/navigation.ts holds framework-agnostic data that could, in theory, be
// reused outside the UI layer (e.g. in tests or analytics).
const TAB_ICONS: Record<TabId, (props: { className?: string }) => React.ReactElement> = {
  globe: GlobeIcon,
  "ai-planner": SparklesIcon,
  finances: WalletIcon,
};

interface NavigationProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

/**
 * Responsive navigation for the app's three main sections.
 *
 * This component is marked "use client" because it needs to respond to user
 * clicks (`onTabChange`). It does NOT own the active-tab state itself —
 * that lives in the parent (AppShell) and is passed down as props. Lifting
 * the state up like this means AppShell's content area and the Navigation
 * component always agree on which tab is active, with a single source of
 * truth instead of two components trying to stay in sync.
 *
 * Responsive behavior:
 * - On small screens (below Tailwind's `md` breakpoint), it renders as a
 *   horizontal top bar — easiest to reach with a thumb on mobile.
 * - On medium screens and up, it switches to a vertical sidebar docked to
 *   the left, which is the more conventional desktop app pattern and keeps
 *   the content area wide for maps/charts/chat.
 *
 * This is done with a single set of elements whose Tailwind classes change
 * per breakpoint (`flex-row md:flex-col`), rather than rendering two
 * separate DOM trees — simpler to maintain and avoids duplicating markup.
 */
export default function Navigation({ activeTab, onTabChange }: NavigationProps) {
  return (
    <nav
      className="flex w-full flex-row items-center gap-1 border-b border-black/10 bg-white/80 px-2 py-2 backdrop-blur
                 dark:border-white/10 dark:bg-black/40
                 md:h-screen md:w-56 md:flex-none md:flex-col md:items-stretch md:gap-2 md:border-b-0 md:border-r md:p-4"
      aria-label="Main navigation"
    >
      {/* Brand mark: only meaningful once there's a sidebar to anchor, so it's hidden on the mobile top bar. */}
      <div className="hidden px-2 pb-4 md:block">
        <span className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          GlobePlanAI
        </span>
      </div>

      <div className="flex flex-1 flex-row justify-around gap-1 md:flex-none md:flex-col md:justify-start md:gap-1">
        {TABS.map((tab) => {
          const Icon = TAB_ICONS[tab.id];
          const isActive = tab.id === activeTab;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              aria-current={isActive ? "page" : undefined}
              className={`flex flex-1 flex-col items-center gap-1 rounded-lg px-3 py-2 text-xs font-medium transition-colors
                          md:flex-none md:flex-row md:justify-start md:gap-3 md:text-sm
                          ${
                            isActive
                              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                              : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-white/10"
                          }`}
            >
              <Icon className="h-5 w-5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
