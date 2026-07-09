"use client";

import { useState } from "react";
import Navigation from "@/components/Navigation";
import GlobeTab from "@/components/tabs/GlobeTab";
import AiPlannerTab from "@/components/tabs/AiPlannerTab";
import FinancesTab from "@/components/tabs/FinancesTab";
import type { TabId } from "@/lib/navigation";

/**
 * Top-level client shell that ties navigation and tab content together.
 *
 * Why this lives in its own component rather than directly in
 * `app/page.tsx`: Next.js Server Components (the default in the App
 * Router) cannot use React state or event handlers. Since switching tabs
 * needs both (`useState` + `onClick`), this piece of the tree must opt into
 * being a Client Component via the `"use client"` directive at the top of
 * the file. Keeping that boundary in a small, dedicated component (instead
 * of marking the whole page as a Client Component) keeps as much of the app
 * as possible server-rendered by default, which is the recommended App
 * Router pattern.
 *
 * The active tab is intentionally plain `useState` (no routing, no URL
 * state, no external store) because the task calls for simple local-state
 * switching for now. If deep-linking to a specific tab (e.g. sharing a URL
 * that opens directly on "Finances") becomes a requirement later, this is
 * the place to swap `useState` for Next.js's `useRouter`/`useSearchParams`.
 */
export default function AppShell() {
  const [activeTab, setActiveTab] = useState<TabId>("globe");

  // Renders whichever tab's content matches the current state. A switch
  // statement (rather than a lookup object built on every render) also lets
  // TypeScript flag if a new TabId is added to the union without a
  // corresponding case being added here.
  function renderActiveTab() {
    switch (activeTab) {
      case "globe":
        return <GlobeTab />;
      case "ai-planner":
        return <AiPlannerTab />;
      case "finances":
        return <FinancesTab />;
    }
  }

  return (
    <div className="flex min-h-screen w-full flex-col md:flex-row">
      <Navigation activeTab={activeTab} onTabChange={setActiveTab} />
      <main className="flex-1 overflow-y-auto p-6 md:p-10">
        {renderActiveTab()}
      </main>
    </div>
  );
}
