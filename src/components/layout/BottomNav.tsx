import { ChefHat, LayoutDashboard, Map as MapIcon, Truck, Users } from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";

const items = [
  { to: "/", label: "Зал", icon: MapIcon },
  { to: "/dashboard", label: "Обзор", icon: LayoutDashboard },
  { to: "/menu", label: "Меню", icon: ChefHat },
  { to: "/guests", label: "Гости", icon: Users },
  { to: "/suppliers", label: "Поставки", icon: Truck },
] as const;

export function BottomNav() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return (
    <nav className="glass fixed bottom-4 left-1/2 z-40 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center justify-around rounded-full px-2 py-2 shadow-lg shadow-slate-300/20">
      {items.map(({ to, label, icon: Icon }) => {
        const active = pathname === to;
        return (
          <Link
            key={to}
            to={to}
            activeProps={{ className: "bg-slate-900 text-white" }}
            inactiveProps={{ className: "text-slate-500" }}
            className={`flex min-w-0 flex-1 flex-col items-center gap-1 rounded-full px-2 py-2 text-[10px] font-semibold transition-colors ${active ? "bg-slate-900 text-white" : "text-slate-500"}`}
          >
            <Icon size={18} strokeWidth={active ? 2.5 : 2} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
