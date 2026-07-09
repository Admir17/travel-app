import AppShell from "@/components/AppShell";

// This page stays a Server Component (no "use client" directive needed
// here). It simply renders AppShell, which owns the interactive tab-switch
// state — see the comment in AppShell.tsx for why the client boundary is
// drawn there instead of at this level.
export default function Home() {
  return <AppShell />;
}
