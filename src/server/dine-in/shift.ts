import { pool } from "../db/pool";
import { ApiError, equalSecret } from "../guest/security";
import { failure, json } from "./http";

/** Narrow server-to-server read contract for XOXO staff, backed by Command Center's database. */
export async function handleShiftRead(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/service/v1/dine-in/")) return null;
  try {
    if (request.method !== "GET") throw new ApiError(405, "METHOD_NOT_ALLOWED", "Метод недоступен");
    if (
      !process.env.COMMAND_CENTER_SERVICE_KEY ||
      !equalSecret(
        request.headers.get("x-command-center-key"),
        process.env.COMMAND_CENTER_SERVICE_KEY,
      )
    )
      throw new ApiError(401, "UNAUTHORIZED", "Доступ запрещён");
    if (process.env.DINE_IN_ENABLED !== "yes")
      throw new ApiError(503, "DINE_IN_DISABLED", "QR-заказы пока не включены");
    if (url.pathname === "/api/service/v1/dine-in/menu") {
      if (url.search) throw new ApiError(422, "INVALID_INPUT", "Некорректный запрос");
      const items = (
        await pool.query(`SELECT i.id,i.name,i.description,i.category,i.image_url AS "imageUrl",
        i.portion,i.allergens,i.price_minor::text AS "priceMinor",i.is_available AS "isAvailable",i.version
        FROM venue_menu_items i JOIN hostess_venues v ON v.id=i.venue_id
        WHERE v.slug='xoxo' AND i.published ORDER BY i.sort_order,i.category,i.name,i.id LIMIT 500`)
      ).rows;
      return json({
        generatedAt: new Date().toISOString(),
        source: "command_center",
        currency: "KZT",
        items,
      });
    }
    if (url.pathname === "/api/service/v1/dine-in/orders") {
      const scope = url.searchParams.get("scope") ?? "active";
      if (
        !["active", "recent"].includes(scope) ||
        [...url.searchParams.keys()].some((key) => key !== "scope")
      )
        throw new ApiError(422, "INVALID_INPUT", "Некорректный период");
      const orders = (
        await pool.query(
          `SELECT o.id,o.number::text,o.table_resource_id AS "tableResourceId",
        r.code AS "tableCode",r.name AS "tableName",z.name AS "zoneName",
        o.dining_session_id AS "diningSessionId",o.guest_id AS "guestId",g.name AS "guestName",
        o.status,o.payment_status AS "paymentStatus",o.manual_payment_at AS "manualPaymentAt",
        o.accepted_at AS "acceptedAt",o.subtotal_minor::text AS "subtotalMinor",
        o.discount_minor::text AS "discountMinor",o.payable_minor::text AS "payableMinor",
        o.cashback_minor::text AS "cashbackMinor",
        (SELECT l.expires_at FROM loyalty_lots l WHERE l.order_id=o.id) AS "cashbackExpiresAt",
        (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',i.id,
          'productId',COALESCE(i.exchange_product_id,to_jsonb(i)->>'menu_item_id'),
          'itemType',COALESCE(to_jsonb(i)->>'item_type','EXCHANGE'),
          'name',i.name,'quantity',i.quantity,'unitPriceMinor',i.unit_price_minor::text,
          'totalMinor',i.total_minor::text,'roundId',i.round_id) ORDER BY i.id),'[]')
          FROM dine_in_order_items i WHERE i.order_id=o.id AND i.venue_id=o.venue_id) AS items
        FROM dine_in_orders o JOIN hostess_venues v ON v.id=o.venue_id
        JOIN venue_resources r ON r.id=o.table_resource_id AND r.venue_id=o.venue_id
        JOIN venue_zones z ON z.id=r.zone_id LEFT JOIN hostess_guests g ON g.id=o.guest_id
        WHERE v.slug='xoxo' AND ($1::text='recent' OR o.status NOT IN ('closed','cancelled'))
        ORDER BY o.accepted_at DESC,o.id DESC LIMIT 101`,
          [scope],
        )
      ).rows;
      return json({
        generatedAt: new Date().toISOString(),
        source: "command_center",
        currency: "KZT",
        scope,
        hasMore: orders.length > 100,
        orders: orders.slice(0, 100),
      });
    }
    throw new ApiError(404, "NOT_FOUND", "Маршрут не найден");
  } catch (error) {
    return failure(error);
  }
}
