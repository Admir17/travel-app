import { create } from "zustand";

/**
 * A geographic point. Shared by both `activeDestination` and each
 * `ItineraryPoint` so the globe component can plot either one using the
 * exact same shape, instead of two slightly different lat/lng interfaces.
 */
export interface Coordinates {
  lat: number;
  lng: number;
}

/**
 * The place the 3D globe should currently be focused on (e.g. after the
 * user searches for a city, or clicks a country on the globe itself).
 */
export interface ActiveDestination {
  name: string;
  coordinates: Coordinates;
}

/**
 * A single stop on the user's itinerary. `dayNumber` ties it to a specific
 * day of the trip (1-indexed) so the UI can group/sort points by day, and
 * `activities` holds free-form activity descriptions for that stop.
 */
export interface ItineraryPoint {
  id: string;
  locationName: string;
  coordinates: Coordinates;
  dayNumber: number;
  activities: string[];
}

/**
 * A closed set of spending categories rather than a free-form string. This
 * catches typos (e.g. "trasnport") at compile time and gives the finances
 * UI a known list to build category filters/icons from. "other" is the
 * escape hatch for anything that doesn't fit.
 */
export type ExpenseCategory =
  | "flights"
  | "accommodation"
  | "food"
  | "transport"
  | "activities"
  | "shopping"
  | "other";

/**
 * A single financial entry. `currency` is kept as a plain ISO 4217 code
 * (e.g. "USD", "EUR") rather than a union type, since the list of real
 * currencies is large and callers may want to support any of them.
 */
export interface Expense {
  id: string;
  title: string;
  amount: number;
  category: ExpenseCategory;
  currency: string;
}

/**
 * The full shape of the store: the state itself, plus every action allowed
 * to mutate it. Defining state and actions together in one interface (the
 * conventional Zustand pattern) means components only ever import one type
 * and one hook to read or update any part of the shared travel data.
 */
interface TravelState {
  // --- State ---

  // `null` until the user has picked/searched a destination, so the globe
  // knows to show a default view rather than pointing at (0, 0).
  activeDestination: ActiveDestination | null;
  itineraryPoints: ItineraryPoint[];
  expenses: Expense[];

  // --- Actions ---

  setActiveDestination: (destination: ActiveDestination) => void;

  // Callers provide everything except `id` — the store generates it, so
  // there's a single, consistent place responsible for id creation instead
  // of every calling component inventing its own.
  addItineraryPoint: (point: Omit<ItineraryPoint, "id">) => void;
  removeItineraryPoint: (id: string) => void;

  addExpense: (expense: Omit<Expense, "id">) => void;
  removeExpense: (id: string) => void;
}

/**
 * The central state hub for GlobePlanAI. Any component (Globe, AI Planner,
 * Finances) can read from and write to this same store via the
 * `useTravelStore` hook, without needing to pass data through props.
 *
 * `create<TravelState>()` (note the extra call) is Zustand's recommended
 * pattern for TypeScript: it lets `set`/`get` below be correctly typed
 * without having to annotate them by hand.
 */
export const useTravelStore = create<TravelState>()((set) => ({
  // Initial state: nothing selected/added yet.
  activeDestination: null,
  itineraryPoints: [],
  expenses: [],

  setActiveDestination: (destination) =>
    set({ activeDestination: destination }),

  addItineraryPoint: (point) =>
    set((state) => ({
      itineraryPoints: [
        ...state.itineraryPoints,
        { ...point, id: crypto.randomUUID() },
      ],
    })),

  removeItineraryPoint: (id) =>
    set((state) => ({
      itineraryPoints: state.itineraryPoints.filter((p) => p.id !== id),
    })),

  addExpense: (expense) =>
    set((state) => ({
      expenses: [...state.expenses, { ...expense, id: crypto.randomUUID() }],
    })),

  removeExpense: (id) =>
    set((state) => ({
      expenses: state.expenses.filter((e) => e.id !== id),
    })),
}));
