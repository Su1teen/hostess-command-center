import type { ReactNode } from "react";

import { BottomNav } from "./BottomNav";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto min-h-screen max-w-md bg-slate-50 pb-32">{children}</div>
      <BottomNav />
    </main>
  );
}
