import type { ReactNode } from "react";

import { StaffGate } from "./StaffGate";
import { BottomNav } from "./BottomNav";
import { ServiceOperations } from "../orders/ServiceOperations";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <StaffGate>
      <ServiceOperations>
        <main className="min-h-screen bg-slate-50">
          <div className="mx-auto min-h-screen max-w-6xl bg-slate-50 pb-32">{children}</div>
          <BottomNav />
        </main>
      </ServiceOperations>
    </StaffGate>
  );
}
