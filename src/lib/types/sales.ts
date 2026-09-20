export type SalesFilter = "all" | "alcohol" | "kitchen";

export interface SalesKpis {
  revenue: number;
  itemsSold: number;
  alcoholRevenue: number;
  ordersCount: number | null;
  averageCheck: number | null;
}

export interface SalesHourlyPoint {
  hour: number;
  label: string;
  revenue: number;
  items: number;
}

export interface SalesCategory {
  category: string;
  revenue: number;
  items: number;
  share: number;
}

export interface TopSale {
  name: string;
  category: string;
  isAlcohol: boolean;
  quantity: number;
  revenue: number;
  source: "exchange" | "iiko";
}

export interface SalesSources {
  exchangeLines: number;
  iikoEvents: number;
  iikoEventsWithoutPrice: number;
}

export interface SalesDashboard {
  kpis: SalesKpis;
  hourly: SalesHourlyPoint[];
  categories: SalesCategory[];
  top: TopSale[];
  sources: SalesSources;
  generatedAt: string;
  dateLabel: string;
  timezone: string;
}
