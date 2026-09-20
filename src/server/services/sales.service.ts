import type { SalesDashboard, SalesFilter } from "../../lib/types/sales";
import { getSalesDashboard as fetchSalesDashboard } from "../repositories/sales.repository";

export function getSalesDashboard(filter: SalesFilter): Promise<SalesDashboard> {
  return fetchSalesDashboard(filter);
}
