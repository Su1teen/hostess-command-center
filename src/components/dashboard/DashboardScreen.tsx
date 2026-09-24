import {
  ArrowUpRight,
  ChefHat,
  ClipboardList,
  PackageCheck,
  TrendingUp,
  Users,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { DEMO_MENU, DEMO_SALES_DASHBOARD, DEMO_SUPPLIERS } from "../../lib/demoData";
import { formatKzt } from "../../lib/formatters/money";
import { salesDashboardQuery } from "../../lib/queries/sales";
import { HourlyRevenueChart } from "../analytics/HourlyRevenueChart";
import { SalesKpis } from "../analytics/SalesKpis";
import { TopProducts } from "../analytics/TopProducts";

const quickLinks = [
  { to: "/menu" as const, label: "Меню", caption: "Барная карта и кухня", icon: ChefHat },
  { to: "/guests" as const, label: "Гости и чеки", caption: "Клиенты, заказы, кэшбэк", icon: Users },
  {
    to: "/suppliers" as const,
    label: "Поставщики",
    caption: "Контакты и поставки",
    icon: PackageCheck,
  },
  { to: "/sales" as const, label: "Продажи", caption: "Аналитика биржи", icon: TrendingUp },
];

export function DashboardScreen() {
  const query = useQuery(salesDashboardQuery("alcohol"));
  const data = query.data ?? DEMO_SALES_DASHBOARD;
  const lowStock = DEMO_MENU.filter((item) => item.stock < 8).length;

  return (
    <div className="space-y-5 px-4 pb-32 pt-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            Управление · Алматы
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Добрый вечер, Даян.</h1>
          <p className="mt-1 text-sm text-slate-500">Смена под контролем</p>
        </div>
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-sm font-bold text-white">
          Д
        </div>
      </header>

      <section className="rounded-[2rem] bg-slate-900 p-5 text-white shadow-lg shadow-slate-900/10">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-slate-300">Выручка бара сегодня</p>
            <p className="mt-1 text-3xl font-bold tabular-nums">{formatKzt(data.kpis.revenue)}</p>
          </div>
          <span className="flex items-center gap-1 rounded-full bg-emerald-400/15 px-2.5 py-1 text-xs font-semibold text-emerald-300">
            <TrendingUp size={13} /> +12.4%
          </span>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-2 border-t border-white/10 pt-4 text-xs">
          <div>
            <p className="text-slate-400">Сделок биржи</p>
            <p className="mt-1 text-base font-semibold">{data.sources.exchangeLines}</p>
          </div>
          <div>
            <p className="text-slate-400">Средний чек</p>
            <p className="mt-1 text-base font-semibold">
              {formatKzt(data.kpis.averageCheck ?? 4396)}
            </p>
          </div>
          <div>
            <p className="text-slate-400">Позиций</p>
            <p className="mt-1 text-base font-semibold">{data.kpis.itemsSold}</p>
          </div>
        </div>
      </section>

      <SalesKpis kpis={data.kpis} />
      <HourlyRevenueChart data={data.hourly} />
      <TopProducts items={data.top} />

      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">Быстрые действия</h2>
            <p className="text-xs text-slate-500">Главные разделы смены</p>
          </div>
          <ClipboardList size={19} className="text-slate-400" />
        </div>
        <div className="grid gap-2">
          {quickLinks.map(({ to, label, caption, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="flex min-h-16 items-center gap-3 rounded-3xl bg-white p-3.5 shadow-sm transition-transform active:scale-[.99]"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                <Icon size={19} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{label}</span>
                <span className="block text-xs text-slate-500">{caption}</span>
              </span>
              <ArrowUpRight size={17} className="text-slate-400" />
            </Link>
          ))}
        </div>
      </section>

      <section className="rounded-3xl bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-bold">Операционная сводка</h2>
            <p className="mt-1 text-xs text-slate-500">Кухня, склад и поставки</p>
          </div>
          <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
            <Users size={13} /> Всё хорошо
          </span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Link to="/menu" className="rounded-2xl bg-amber-50 p-3">
            <p className="text-xs text-amber-700">Мало на складе</p>
            <p className="mt-1 text-xl font-bold text-amber-950">{lowStock}</p>
            <p className="mt-1 text-[11px] text-amber-700">нужно проверить</p>
          </Link>
          <Link to="/suppliers" className="rounded-2xl bg-emerald-50 p-3">
            <p className="text-xs text-emerald-700">Поставщики</p>
            <p className="mt-1 text-xl font-bold text-emerald-950">{DEMO_SUPPLIERS.length}</p>
            <p className="mt-1 text-[11px] text-emerald-700">
              {formatKzt(DEMO_SUPPLIERS.reduce((sum, item) => sum + item.balance, 0))} баланс
            </p>
          </Link>
        </div>
      </section>
    </div>
  );
}
