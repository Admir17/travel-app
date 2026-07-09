/**
 * Central definition of the app's top-level tabs.
 *
 * Keeping this list in one place (instead of duplicating labels/ids across
 * the Navigation component and the content router) means that adding a
 * fourth tab later only requires one edit here, plus one new content
 * component wired up in AppShell.
 */

// A union type of the valid tab identifiers. Using a union (instead of a
// plain `string`) means TypeScript will catch typos like "golbe" at compile
// time, and the switch statement in AppShell can be checked for
// exhaustiveness by the compiler.
export type TabId = "globe" | "ai-planner" | "finances";

export interface TabDefinition {
  id: TabId;
  label: string;
  description: string;
}

export const TABS: TabDefinition[] = [
  {
    id: "globe",
    label: "Globe",
    description: "Explore destinations on an interactive 3D globe.",
  },
  {
    id: "ai-planner",
    label: "AI Planner",
    description: "Chat with your AI assistant to build a trip itinerary.",
  },
  {
    id: "finances",
    label: "Finances",
    description: "Track budgets, expenses, and currency conversions for your trip.",
  },
];
