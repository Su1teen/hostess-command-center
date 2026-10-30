import {
  LayoutDashboard,
  Map as MapIcon,
  ShoppingBag,
  MoreHorizontal,
  CalendarDays,
  Users,
  Utensils,
  QrCode,
  ChartNoAxesCombined,
  Truck,
  Bot,
  PartyPopper,
} from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { useOperations } from "../orders/ServiceOperations";
import { useStaffRole } from "../../lib/dine-in-client";
import { useAgentConversations } from "../agent/AgentScreen";

const items = [
  { to: "/shift", label: "Смена", icon: LayoutDashboard },
  { to: "/", label: "Зал", icon: MapIcon },
  { to: "/orders", label: "Заказы", icon: ShoppingBag },
] as const;
const more = [
  { to: "/agent", label: "Даян · WhatsApp", icon: Bot },
  { to: "/events", label: "Афиша и акции", icon: PartyPopper },
  { to: "/reservations", label: "Бронирования", icon: CalendarDays },
  { to: "/guests", label: "Гости", icon: Users },
  { to: "/menu", label: "Меню", icon: Utensils },
  { to: "/tables/qr", label: "Столы и QR", icon: QrCode },
  { to: "/dashboard", label: "Аналитика", icon: ChartNoAxesCombined, manager: true },
  { to: "/suppliers", label: "Поставки", icon: Truck, manager: true },
] as const;

export function BottomNav() {
  const operations = useOperations();
  const role = useStaffRole();
  const links = more.filter((item) => !("manager" in item) || role === "manager");
  const waiting = useAgentConversations().data?.conversations.filter((c) => c.paused).length ?? 0;
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return (
    <nav
      aria-label="Основная навигация"
      className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-around border-t border-slate-200 bg-white/95 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:inset-y-0 lg:right-auto lg:w-52 lg:flex-col lg:items-stretch lg:justify-start lg:gap-2 lg:border-r lg:border-t-0 lg:p-4"
    >
      <div className="mb-8 hidden px-3 pt-5 lg:block">
        <strong className="text-xl tracking-tight">XOXO</strong>
        <p className="mt-1 text-xs text-slate-500">Command Center</p>
      </div>
      {items.map(({ to, label, icon: Icon }) => {
        const active = pathname === to;
        return (
          <Link
            key={to}
            to={to}
            activeProps={{ className: "bg-slate-900 text-white" }}
            inactiveProps={{ className: "text-slate-500" }}
            className={`flex min-h-16 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-3 py-2 text-[11px] font-medium lg:max-h-12 lg:min-h-12 lg:flex-none lg:flex-row lg:justify-start lg:gap-3 lg:text-sm ${active ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100"}`}
          >
            <Icon size={18} strokeWidth={active ? 2.5 : 2} />
            {label}
            {to === "/shift" && !!operations?.data?.newCount && (
              <span
                className="rounded-full bg-amber-200 px-1.5 text-slate-900"
                aria-label="Новые заказы"
              >
                {operations.data.newCount}
              </span>
            )}
          </Link>
        );
      })}
      <Dropdown.Root>
        <Dropdown.Trigger
          className={`flex min-h-16 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-3 py-2 text-[11px] font-medium lg:hidden ${!items.some((i) => i.to === pathname) ? "bg-slate-900 text-white" : "text-slate-500"}`}
        >
          <span className="relative">
            <MoreHorizontal size={19} />
            {waiting > 0 && (
              <span className="absolute -right-2 -top-1.5 rounded-full bg-amber-400 px-1 text-[10px] font-bold text-slate-900">
                {waiting}
              </span>
            )}
          </span>
          Ещё
        </Dropdown.Trigger>
        <Dropdown.Portal>
          <Dropdown.Content
            side="top"
            align="end"
            sideOffset={12}
            className="z-[90] min-w-56 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl"
          >
            {links.map(({ to, label, icon: Icon }) => (
              <Dropdown.Item asChild key={to}>
                <Link
                  to={to}
                  className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm outline-none focus:bg-slate-100"
                >
                  <Icon size={17} />
                  {label}
                  {to === "/agent" && waiting > 0 && (
                    <span className="ml-auto rounded-full bg-amber-400 px-2 text-xs font-bold text-slate-900">
                      {waiting}
                    </span>
                  )}
                </Link>
              </Dropdown.Item>
            ))}
          </Dropdown.Content>
        </Dropdown.Portal>
      </Dropdown.Root>
      <div className="mt-5 hidden border-t border-slate-200 pt-4 lg:block">
        {links.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className={`mb-1 flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm ${pathname === to ? "bg-white font-semibold text-slate-900 shadow-sm" : "text-slate-500 hover:bg-slate-100"}`}
          >
            <Icon size={17} />
            {label}
            {to === "/agent" && waiting > 0 && (
              <span className="ml-auto rounded-full bg-amber-400 px-2 text-xs font-bold text-slate-900">
                {waiting}
              </span>
            )}
          </Link>
        ))}
      </div>
    </nav>
  );
}
