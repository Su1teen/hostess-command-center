import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { getSalesDashboard } from "../functions/sales.fn";
import type { SalesFilter } from "../types/sales";

export function salesDashboardQuery(filter: SalesFilter) {
  return queryOptions({
    queryKey: ["sales-dashboard", filter],
    queryFn: () => getSalesDashboard({ data: { filter } }),
    refetchInterval: 20_000,
    staleTime: 10_000,
    placeholderData: keepPreviousData,
  });
}
