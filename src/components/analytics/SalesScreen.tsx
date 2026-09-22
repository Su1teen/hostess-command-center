import { useQuery } from "@tanstack/react-query";
import { DEMO_SALES_DASHBOARD } from "../../lib/demoData";
import { salesDashboardQuery } from "../../lib/queries/sales";
import { AlcoholCatalog } from "../catalog/AlcoholCatalog";
import { CategoryBreakdown } from "./CategoryBreakdown";
import { HourlyRevenueChart } from "./HourlyRevenueChart";
import { LastUpdated } from "./LastUpdated";
import { SalesKpis } from "./SalesKpis";
import { TopProducts } from "./TopProducts";

export function SalesScreen() {
  const query = useQuery(salesDashboardQuery("alcohol"));
  const data = query.data ?? DEMO_SALES_DASHBOARD;

  return (
    <div className="space-y-5 px-4 pb-28 pt-6">
      <header>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Барная аналитика · Сегодня
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Продажи · {data.dateLabel}</h1>
        <p className="mt-1 text-xs text-slate-500">Источник: биржа · только напитки</p>
        <LastUpdated generatedAt={data.generatedAt} />
      </header>
      <button
        type="button"
        onClick={() => query.refetch()}
        className="w-full rounded-2xl border border-slate-200 bg-white py-3 text-sm font-semibold text-slate-700 active:bg-slate-50"
      >
        Обновить цены и продажи
      </button>
      <SalesKpis kpis={data.kpis} />
      <HourlyRevenueChart data={data.hourly} />
      <CategoryBreakdown categories={data.categories} />
      <TopProducts items={data.top} />
      <AlcoholCatalog />
    </div>
  );
}
