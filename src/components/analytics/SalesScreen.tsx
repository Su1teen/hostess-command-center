import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SalesFilter } from "../../lib/types/sales";
import { salesDashboardQuery } from "../../lib/queries/sales";
import { ErrorBanner } from "../shared/ErrorBanner";
import { ScreenSkeletons } from "../shared/Skeletons";
import { SalesKpis } from "./SalesKpis";
import { HourlyRevenueChart } from "./HourlyRevenueChart";
import { CategoryBreakdown } from "./CategoryBreakdown";
import { TopProducts } from "./TopProducts";
import { SalesFilterTabs } from "./SalesFilterTabs";
import { LastUpdated } from "./LastUpdated";
import { AlcoholCatalog } from "../catalog/AlcoholCatalog";

export function SalesScreen() {
  const [filter, setFilter] = useState<SalesFilter>("all");
  const query = useQuery(salesDashboardQuery(filter));
  if (query.isPending && !query.data) return <ScreenSkeletons />;
  if (query.isError && !query.data)
    return (
      <div className="px-4 pt-8">
        <h1 className="text-2xl font-bold">Продажи</h1>
        <ErrorBanner>База данных недоступна</ErrorBanner>
        <button
          onClick={() => query.refetch()}
          className="mt-3 w-full rounded-2xl bg-slate-900 py-3 text-sm font-semibold text-white"
        >
          Повторить
        </button>
      </div>
    );
  const data = query.data;
  if (!data) return null;
  return (
    <div className="space-y-5 px-4 pb-28 pt-6">
      <header>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Аналитика · Сегодня
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Продажи · {data.dateLabel}</h1>
        <LastUpdated generatedAt={data.generatedAt} />
      </header>
      {query.isError && <ErrorBanner>Нет связи с базой — показаны последние данные</ErrorBanner>}
      <SalesFilterTabs value={filter} onChange={setFilter} />
      <SalesKpis kpis={data.kpis} />
      <HourlyRevenueChart data={data.hourly} />
      <CategoryBreakdown categories={data.categories} />
      <TopProducts items={data.top} />
      <AlcoholCatalog />
      <p className="text-center text-[11px] text-slate-400">
        Биржа: {data.sources.exchangeLines} линий · iiko: {data.sources.iikoEvents} событий
      </p>
    </div>
  );
}
