/*
 * Canonical sales sources:
 * - exchange_sales = canonical bar-exchange sales. One row per (round, product)
 *   with cumulative quantity and snapshot price_at_sale. Revenue is quantity *
 *   price_at_sale; timestamp is price_rounds.starts_at.
 * - sales_events = experimental iiko webhook ingestion. Include RECEIVED and
 *   PROCESSED events with positive quantity, excluding exchange products to
 *   avoid double counting. Revenue is available only when unit_price exists.
 * - Orders and average check are iiko-only; exchange lines have no order concept.
 */
import { VENUE_TIMEZONE } from "../../lib/constants";
import type { SalesDashboard, SalesFilter } from "../../lib/types/sales";
import { query } from "../db/pool";
import { almatyDayRange } from "../time";

type NumericRow = Record<string, string | number | null>;

export async function getSalesDashboard(filter: SalesFilter): Promise<SalesDashboard> {
  const { start, end, dateLabel } = almatyDayRange();
  const result = await query<NumericRow>(
    `
      WITH lines AS (
        SELECT
          pr.starts_at AS ts,
          COALESCE(ep.name, p.display_name, 'Позиция биржи') AS name,
          COALESCE(ep.category, p.category_name, 'Без категории') AS category,
          true AS is_alcohol,
          es.quantity::numeric AS quantity,
          (es.quantity::numeric * es.price_at_sale)::numeric AS revenue,
          'exchange'::text AS source,
          NULL::text AS iiko_order_id
        FROM exchange_sales es
        JOIN price_rounds pr ON pr.id = es.round_id
        LEFT JOIN exchange_products ep ON ep.id = es.exchange_product_id
        LEFT JOIN products p ON p.id = es.product_id
        WHERE pr.starts_at >= $1 AND pr.starts_at < $2
          AND ($3 = 'all' OR $3 = 'alcohol')
        UNION ALL
        SELECT
          COALESCE(se.occurred_at, se.received_at) AS ts,
          COALESCE(p.display_name, 'Позиция iiko (без сопоставления)') AS name,
          COALESCE(p.category_name, 'Без категории') AS category,
          COALESCE(p.is_drink_candidate, false) AS is_alcohol,
          se.quantity::numeric AS quantity,
          CASE WHEN se.unit_price IS NULL THEN NULL ELSE (se.quantity::numeric * se.unit_price)::numeric END AS revenue,
          'iiko'::text AS source,
          se.iiko_order_id
        FROM sales_events se
        LEFT JOIN products p ON p.id = se.product_id
        WHERE se.status IN ('RECEIVED', 'PROCESSED')
          AND se.quantity > 0
          AND COALESCE(se.occurred_at, se.received_at) >= $1
          AND COALESCE(se.occurred_at, se.received_at) < $2
          AND COALESCE(p.is_exchange_product, false) = false
          AND false
      ),
      kpis AS (
        SELECT
          COALESCE(SUM(revenue), 0) AS revenue,
          COALESCE(SUM(quantity), 0) AS items_sold,
          COALESCE(SUM(revenue) FILTER (WHERE is_alcohol), 0) AS alcohol_revenue,
          COUNT(*) FILTER (WHERE source = 'exchange') AS exchange_lines,
          COUNT(*) FILTER (WHERE source = 'iiko') AS iiko_events,
          COUNT(DISTINCT iiko_order_id) FILTER (WHERE source = 'iiko' AND iiko_order_id IS NOT NULL) AS orders_count,
          SUM(revenue) FILTER (WHERE source = 'iiko' AND iiko_order_id IS NOT NULL) AS priced_order_revenue,
          COUNT(*) FILTER (WHERE source = 'iiko' AND revenue IS NULL) AS iiko_events_without_price
        FROM lines
      ),
      hourly AS (
        SELECT EXTRACT(HOUR FROM ts AT TIME ZONE '${VENUE_TIMEZONE}')::int AS hour,
          COALESCE(SUM(revenue), 0) AS revenue, COALESCE(SUM(quantity), 0) AS items
        FROM lines GROUP BY 1
      ),
      categories AS (
        SELECT category, COALESCE(SUM(revenue), 0) AS revenue, COALESCE(SUM(quantity), 0) AS items
        FROM lines GROUP BY category
      ),
      top_items AS (
        SELECT name, category, BOOL_OR(is_alcohol) AS is_alcohol, SUM(quantity) AS quantity,
          COALESCE(SUM(revenue), 0) AS revenue, source
        FROM lines GROUP BY name, category, source
        ORDER BY revenue DESC LIMIT 10
      )
      SELECT
        (SELECT row_to_json(kpis) FROM kpis) AS kpis,
        (SELECT COALESCE(json_agg(hourly ORDER BY hour), '[]'::json) FROM hourly) AS hourly,
        (SELECT COALESCE(json_agg(categories ORDER BY revenue DESC), '[]'::json) FROM categories) AS categories,
        (SELECT COALESCE(json_agg(top_items ORDER BY revenue DESC), '[]'::json) FROM top_items) AS top_items
    `,
    [start, end, filter],
  );
  const row = result.rows[0] as NumericRow & {
    kpis: NumericRow;
    hourly: NumericRow[];
    categories: NumericRow[];
    top_items: NumericRow[];
  };
  const kpis = row.kpis ?? {};
  const exchangeCount = Number(kpis.exchange_lines ?? 0);
  const categories = (row.categories ?? []).map((item) => ({
    category: String(item.category),
    revenue: Number(item.revenue ?? 0),
    items: Number(item.items ?? 0),
    share: 0,
  }));
  const totalRevenue = categories.reduce((sum, item) => sum + item.revenue, 0);
  for (const category of categories)
    category.share = totalRevenue ? category.revenue / totalRevenue : 0;
  const currentHour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: VENUE_TIMEZONE,
      hour: "numeric",
      hour12: false,
    }).format(new Date()),
  );
  const hoursWithData = (row.hourly ?? []).map((item) => Number(item.hour));
  const startHour = hoursWithData.length ? Math.min(12, Math.min(...hoursWithData)) : currentHour;
  const endHour = hoursWithData.length
    ? Math.max(Math.max(...hoursWithData), currentHour)
    : currentHour;
  const hourlyByHour = new Map((row.hourly ?? []).map((item) => [Number(item.hour), item]));
  const hourly = Array.from({ length: Math.max(1, endHour - startHour + 1) }, (_, index) => {
    const hour = startHour + index;
    const item = hourlyByHour.get(hour);
    return {
      hour,
      label: `${String(hour).padStart(2, "0")}:00`,
      revenue: Number(item?.revenue ?? 0),
      items: Number(item?.items ?? 0),
    };
  });
  return {
    kpis: {
      revenue: Number(kpis.revenue ?? 0),
      itemsSold: Number(kpis.items_sold ?? 0),
      alcoholRevenue: Number(kpis.alcohol_revenue ?? 0),
      ordersCount: exchangeCount,
      averageCheck: exchangeCount ? Number(kpis.revenue ?? 0) / exchangeCount : null,
    },
    hourly,
    categories,
    top: (row.top_items ?? []).map((item) => ({
      name: String(item.name),
      category: String(item.category),
      isAlcohol: Boolean(item.is_alcohol),
      quantity: Number(item.quantity ?? 0),
      revenue: Number(item.revenue ?? 0),
      source: item.source === "exchange" ? "exchange" : "iiko",
    })),
    sources: {
      exchangeLines: Number(kpis.exchange_lines ?? 0),
      iikoEvents: Number(kpis.iiko_events ?? 0),
      iikoEventsWithoutPrice: Number(kpis.iiko_events_without_price ?? 0),
    },
    generatedAt: new Date().toISOString(),
    dateLabel,
    timezone: VENUE_TIMEZONE,
  };
}
