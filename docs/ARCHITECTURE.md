# GlobePlanAI — Architecture

This document explains how the codebase is organized and why, so new
contributors (human or AI) can find their way around quickly.

## Tech stack

- **Next.js (App Router)** — routing, rendering, and build tooling.
- **TypeScript** — static typing across the codebase.
- **Tailwind CSS v4** — utility-first styling, configured via `@theme` in
  `globals.css` (no separate `tailwind.config.js` is needed in this setup).
- **ESLint** — linting, configured via `eslint.config.mjs` using the
  `eslint-config-next` ruleset.

## Top-level layout

```
travel/
├── docs/                # Project documentation (this file lives here)
├── public/               # Static assets served as-is at the site root
├── src/
│   ├── app/               # Next.js App Router: routes, layouts, global styles
│   ├── components/        # Reusable React components (shared UI)
│   │   └── tabs/           # One component per top-level tab's content
│   └── lib/                # Framework-agnostic helpers and shared data
├── eslint.config.mjs
├── next.config.ts
├── package.json
├── postcss.config.mjs      # Required by Tailwind v4's PostCSS plugin
└── tsconfig.json           # Includes the "@/*" path alias -> "src/*"
```

## `src/app/` — routing and root layout

The App Router uses the filesystem to define routes: a folder is a URL
segment, and special files inside it (`page.tsx`, `layout.tsx`, etc.) define
what renders there.

- **`layout.tsx`** — the *root layout*. It is required, must render `<html>`
  and `<body>`, and wraps every page in the app. This is where site-wide
  `<head>` metadata (page title, description), global fonts, and global
  CSS are set up. It stays a **Server Component** (no `"use client"`).
- **`page.tsx`** — the route for `/` (the home page). It is intentionally
  kept as a thin Server Component that just renders `<AppShell />`. All the
  interactive logic lives in `AppShell`, not here — see below for why.
- **`globals.css`** — imports Tailwind and defines the `--background` /
  `--foreground` CSS variables used for light/dark mode.

As the app grows, new routes are added by creating new folders under
`src/app/` (e.g. `src/app/trips/[tripId]/page.tsx` for a dynamic trip
detail page). The current tab-based UI does **not** use separate routes —
see the "Tabs and client/server boundary" section below for why.

## `src/components/` — shared UI

- **`AppShell.tsx`** — the interactive heart of the current UI. It is a
  **Client Component** (marked with `"use client"` at the top of the file)
  because it uses `useState` to track which tab is active and passes an
  `onClick` handler down to `Navigation`. Server Components can't use state
  or event handlers, so this is the boundary where the tree "opts in" to
  client-side interactivity.
- **`Navigation.tsx`** — renders the three tabs (Globe, AI Planner,
  Finances) as a responsive nav: a horizontal bar on small screens, a
  vertical sidebar from Tailwind's `md` breakpoint up. It receives the
  active tab and a change handler as props rather than owning state itself,
  so `AppShell` remains the single source of truth.
- **`icons.tsx`** — small hand-written inline SVG icons for the nav, used
  instead of pulling in an icon library for just three glyphs.
- **`tabs/GlobeTab.tsx`, `tabs/AiPlannerTab.tsx`, `tabs/FinancesTab.tsx`** —
  one component per tab's content. Each is currently a placeholder panel;
  this is where real features (the 3D globe, the AI chat interface, the
  budget/expense views) will be built out independently of one another.

## `src/lib/` — shared, framework-agnostic code

- **`navigation.ts`** — defines the `TabId` union type and the `TABS`
  array (id, label, description) used by both `Navigation.tsx` and
  `AppShell.tsx`. Centralizing this means adding a fourth tab later is a
  single edit here (plus one new component under `src/components/tabs/`),
  instead of hunting down every place a tab's id or label is hardcoded.

As the app grows, this is also where things like API client wrappers, data
formatters, or validation schemas should go — anything that doesn't render
JSX and isn't tied to a specific component.

## Tabs and the client/server boundary

The task called for switching between "Globe", "AI Planner", and
"Finances" via local state, not via separate URL routes. That's why these
are implemented as three components rendered conditionally inside
`AppShell`, rather than as three folders under `src/app/`. Practically,
this means:

- Switching tabs is instant and never triggers a server round-trip.
- The URL stays on `/` regardless of which tab is active.
- If a later requirement needs shareable/bookmarkable links per tab (e.g.
  `/finances`), the natural evolution is to convert `src/app/` into three
  route folders and swap `AppShell`'s `useState` for Next.js's router
  APIs — the `TabId` type and tab content components can be reused as-is.

## Path alias

`tsconfig.json` defines `"@/*": ["./src/*"]`, so imports use
`@/components/...`, `@/lib/...` instead of long relative paths like
`../../lib/navigation`.
