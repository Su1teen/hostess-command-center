import { exchangeRequest, exchangeApiEnabled } from "./exchange-bridge";
import type { SalesDashboard, SalesFilter } from "../../lib/types/sales";
import { getSalesDashboard as fetchSalesDashboard } from "../repositories/sales.repository";

export function getSalesDashboard(filter: SalesFilter): Promise<SalesDashboard> {
  return exchangeApiEnabled()
    ? exchangeRequest<SalesDashboard>(`/sales?filter=${filter}`)
    : fetchSalesDashboard(filter);
}
