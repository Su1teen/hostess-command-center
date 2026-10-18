import type { PoolClient } from "pg";
import { z } from "zod";
import { pool } from "../db/pool";
import { transaction, type Session } from "../guest/auth";
import { ApiError } from "../guest/security";
import type { Line } from "./domain";

const imageUrl = z
  .string()
  .url()
  .max(2000)
  .refine((value) => new URL(value).protocol === "https:", "Фото должно использовать HTTPS")
  .nullable();
export const menuInput = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(3000).default(""),
    category: z.string().trim().min(1).max(100),
    imageUrl: imageUrl.default(null),
    portion: z.string().trim().max(100).default(""),
    allergens: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
    priceMinor: z.number().int().min(0).max(1_000_000_000),
    isAvailable: z.boolean().default(true),
    published: z.boolean().default(false),
    sortOrder: z.number().int().min(-10000).max(10000).default(0),
    version: z.number().int().positive().optional(),
  })
  .strict();

export async function menuCatalog(venueId: string, venueCode: string, staff = false) {
  const items = (
    await pool.query(
      `SELECT id,name,description,category,image_url AS "imageUrl",portion,allergens,
    price_minor::text AS "priceMinor",is_available AS "isAvailable",published,sort_order AS "sortOrder",version,updated_at AS "updatedAt"
    FROM venue_menu_items WHERE venue_id=$1 AND ($2 OR published) ORDER BY sort_order,category,name,id`,
      [venueId, staff],
    )
  ).rows;
  const products = items.map((item) => ({ ...item, price: Number(item.priceMinor) / 100 }));
  const updatedAt = new Date().toISOString();
  return {
    status: "ok",
    venueCode,
    currency: "KZT",
    updatedAt,
    generatedAt: updatedAt,
    items: products,
    products,
  };
}

export async function saveMenuItem(venueId: string, staff: Session, raw: unknown, id?: string) {
  const input = menuInput.parse(raw);
  if (id && !input.version)
    throw new ApiError(422, "VERSION_REQUIRED", "Обновите карточку перед сохранением");
  return transaction(async (client) => {
    const params = [
      venueId,
      input.name,
      input.description,
      input.category,
      input.imageUrl,
      input.portion,
      input.allergens,
      input.priceMinor,
      input.isAvailable,
      input.published,
      input.sortOrder,
    ];
    const result = id
      ? await client.query(
          `UPDATE venue_menu_items SET name=$2,description=$3,category=$4,image_url=$5,portion=$6,allergens=$7,
          price_minor=$8,is_available=$9,published=$10,sort_order=$11,version=version+1,updated_at=clock_timestamp()
          WHERE venue_id=$1 AND id=$12 AND version=$13 RETURNING id,version`,
          [...params, id, input.version],
        )
      : await client.query(
          `INSERT INTO venue_menu_items(venue_id,name,description,category,image_url,portion,allergens,price_minor,is_available,published,sort_order)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,version`,
          params,
        );
    if (!result.rowCount)
      throw new ApiError(
        409,
        "MENU_CHANGED",
        "Меню уже изменено другим сотрудником. Обновите карточку",
      );
    await client.query(
      "INSERT INTO hostess_audit(actor,action,entity_id,details) VALUES($1,$2,$3,$4)",
      [
        `staff:${staff.staff_id}`,
        id ? "menu_updated" : "menu_created",
        result.rows[0].id,
        JSON.stringify({ version: result.rows[0].version, published: input.published }),
      ],
    );
    return result.rows[0];
  });
}

export async function regularPriceLines(
  client: Pick<PoolClient, "query">,
  venueId: string,
  items: { productId: string; quantity: number }[],
): Promise<Line[]> {
  if (!items.length) return [];
  const rows = (
    await client.query(
      `SELECT id,name,price_minor,version FROM venue_menu_items
    WHERE venue_id=$1 AND id=ANY($2::uuid[]) AND published AND is_available FOR SHARE`,
      [venueId, items.map((item) => item.productId)],
    )
  ).rows;
  return items.map((item) => {
    const row = rows.find((row) => row.id === item.productId);
    if (!row)
      throw new ApiError(409, "PRODUCT_UNAVAILABLE", "Позиция меню недоступна. Обновите корзину");
    return {
      ...item,
      itemType: "REGULAR_MENU",
      name: row.name,
      unitPriceMinor: Number(row.price_minor),
      totalMinor: Number(row.price_minor) * item.quantity,
      roundId: null,
      menuVersion: row.version,
    };
  });
}

export async function validateRegularQuote(client: PoolClient, venueId: string, lines: Line[]) {
  const regular = lines.filter((line) => line.itemType === "REGULAR_MENU");
  const current = await regularPriceLines(client, venueId, regular);
  if (
    current.some(
      (line, index) =>
        line.menuVersion !== regular[index].menuVersion ||
        line.unitPriceMinor !== regular[index].unitPriceMinor,
    )
  )
    throw new ApiError(409, "REQUOTE", "Меню изменилось. Подтвердите новый расчёт");
}

export async function occupancySignals(slugs: string[]) {
  const rows = (
    await pool.query(
      `SELECT v.slug,
    count(r.id)::int AS capacity,
    count(r.id) FILTER(WHERE m.verified_at IS NOT NULL AND m.relationship<>'pending')::int AS verified,
    count(r.id) FILTER(WHERE m.verified_at IS NOT NULL AND m.relationship<>'pending' AND EXISTS(
      SELECT 1 FROM dining_sessions s WHERE s.resource_id=r.id AND s.closed_at IS NULL AND s.seated_at IS NOT NULL AND s.visit_status='seated'))::int AS occupied
    FROM hostess_venues v LEFT JOIN table_qr_codes q ON q.venue_id=v.id
    LEFT JOIN venue_resources r ON r.id=q.resource_id AND r.status='active'
    LEFT JOIN venue_resource_mappings m ON m.resource_id=r.id
    WHERE v.active AND v.slug=ANY($1::text[]) GROUP BY v.slug`,
      [slugs],
    )
  ).rows;
  const updatedAt = new Date().toISOString();
  return {
    updatedAt,
    signals: slugs.map((venueId) => {
      const row = rows.find((row) => row.slug === venueId);
      const trustworthy = !!row?.capacity && row.verified === row.capacity;
      const valuePercent = trustworthy ? Math.round((row.occupied * 100) / row.capacity) : null;
      return {
        venueId,
        valuePercent,
        level:
          valuePercent === null
            ? "unknown"
            : valuePercent < 55
              ? "low"
              : valuePercent < 80
                ? "medium"
                : "high",
        source: trustworthy ? "staff_confirmed" : "unavailable",
        updatedAt: trustworthy ? updatedAt : null,
        staleAfter: 90,
        capacity: row?.capacity ?? 0,
        occupiedUnits: row?.occupied ?? 0,
        unit: "tables",
      };
    }),
  };
}
