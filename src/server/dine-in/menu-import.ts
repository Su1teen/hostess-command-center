import { z } from "zod";
import { transaction, type Session } from "../guest/auth";
import { ApiError, hash } from "../guest/security";
import { listExchangeProducts } from "../services/products.service";
import { menuInput } from "./menu";

const itemSchema = menuInput
  .omit({ version: true })
  .extend({
    sourceKey: z.string().trim().min(1).max(200),
    sourceUrl: z
      .string()
      .url()
      .max(2000)
      .refine((v) => new URL(v).protocol === "https:"),
    sourceDetails: z.record(z.unknown()).default({}),
  })
  .strict();
const inputSchema = z
  .object({
    mode: z.enum(["preview", "apply"]),
    items: z.array(itemSchema).min(1).max(500),
    previewToken: z.string().optional(),
    idempotencyKey: z.string().min(16).max(128).optional(),
  })
  .strict();
const normalize = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
const identity = (item: { name: string; portion: string; category: string }) =>
  [item.name, item.portion, item.category].map(normalize).join(":");
const content = (item: z.infer<typeof itemSchema>) => ({
  name: item.name,
  description: item.description,
  category: item.category,
  imageUrl: item.imageUrl,
  portion: item.portion,
  allergens: item.allergens,
  priceMinor: item.priceMinor,
  isAvailable: item.isAvailable,
  published: item.published,
  sortOrder: item.sortOrder,
});

export async function importMenu(venueId: string, staff: Session, raw: unknown) {
  const input = inputSchema.parse(raw);
  if (new Set(input.items.map((i) => i.sourceKey)).size !== input.items.length)
    throw new ApiError(422, "DUPLICATE_SOURCE", "В файле повторяются исходные идентификаторы");
  if (input.mode === "apply" && (!input.previewToken || !input.idempotencyKey))
    throw new ApiError(422, "PREVIEW_REQUIRED", "Сначала проверьте предварительный просмотр");
  // Same complete Exchange catalogue as the existing management screen, including inactive SKUs.
  const exchange = await listExchangeProducts();
  return transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`menu:${venueId}`]);
    const signature = hash(
      JSON.stringify({
        actor: staff.staff_id,
        operation: "menu-import",
        items: input.items,
        previewToken: input.previewToken,
      }),
    );
    if (input.mode === "apply") {
      const prior = (
        await client.query(
          "SELECT request_hash,response FROM floor_operation_idempotency WHERE venue_id=$1 AND key=$2",
          [venueId, input.idempotencyKey],
        )
      ).rows[0];
      if (prior) {
        if (prior.request_hash !== signature)
          throw new ApiError(409, "IDEMPOTENCY_MISMATCH", "Ключ импорта уже использован");
        return prior.response;
      }
    }
    const current = (
      await client.query(
        `SELECT id,name,description,category,image_url AS "imageUrl",portion,allergens,price_minor::text AS "priceMinor",is_available AS "isAvailable",published,sort_order AS "sortOrder",version,source_key AS "sourceKey" FROM venue_menu_items WHERE venue_id=$1 ORDER BY id FOR UPDATE`,
        [venueId],
      )
    ).rows;
    const seen = new Set<string>();
    const rows = input.items.map((item) => {
      const old = current.find((row) => row.sourceKey === item.sourceKey);
      const key = identity(item);
      const isExchange = exchange.some(
        (p) =>
          normalize(p.name) === normalize(item.name) &&
          (!p.volumeMl ||
            !item.portion ||
            normalize(item.portion) === `${p.volumeMl}ml` ||
            normalize(item.portion) === `${p.volumeMl}мл`),
      );
      const duplicate =
        seen.has(key) || current.some((row) => row.id !== old?.id && identity(row) === key);
      seen.add(key);
      const status = isExchange
        ? "exchange"
        : duplicate
          ? "duplicate"
          : !old
            ? "create"
            : JSON.stringify({ ...content(item), priceMinor: String(item.priceMinor) }) ===
                JSON.stringify({
                  name: old.name,
                  description: old.description,
                  category: old.category,
                  imageUrl: old.imageUrl,
                  portion: old.portion,
                  allergens: old.allergens,
                  priceMinor: old.priceMinor,
                  isAvailable: old.isAvailable,
                  published: old.published,
                  sortOrder: old.sortOrder,
                })
              ? "unchanged"
              : "update";
      return {
        sourceKey: item.sourceKey,
        name: item.name,
        category: item.category,
        portion: item.portion,
        priceMinor: item.priceMinor,
        status,
        id: old?.id ?? null,
        version: old?.version ?? null,
      };
    });
    const previewToken = hash(
      JSON.stringify({
        items: input.items,
        rows,
        exchange: exchange.map((p) => [p.id, p.name, p.volumeMl]),
      }),
    );
    const counts = Object.fromEntries(
      ["create", "update", "unchanged", "exchange", "duplicate"].map((key) => [
        key,
        rows.filter((row) => row.status === key).length,
      ]),
    );
    const result = { rows, counts, previewToken, applied: input.mode === "apply" };
    if (input.mode === "preview") return result;
    if (input.previewToken !== previewToken)
      throw new ApiError(
        409,
        "MENU_CHANGED",
        "Каталог изменился. Обновите предварительный просмотр",
      );
    const changed = input.items
      .filter((_, index) => ["create", "update"].includes(rows[index].status))
      .map((item) => ({ ...item, sourceFingerprint: hash(JSON.stringify(item)) }));
    if (changed.length)
      await client.query(
        `
      INSERT INTO venue_menu_items(venue_id,name,description,category,image_url,portion,allergens,price_minor,is_available,published,sort_order,source_key,source_url,source_fingerprint,source_details)
      SELECT $1,name,description,category,"imageUrl",portion,allergens,"priceMinor","isAvailable",published,"sortOrder","sourceKey","sourceUrl","sourceFingerprint","sourceDetails"
      FROM jsonb_to_recordset($2::jsonb) AS x(name text,description text,category text,"imageUrl" text,portion text,allergens text[],"priceMinor" bigint,"isAvailable" boolean,published boolean,"sortOrder" integer,"sourceKey" text,"sourceUrl" text,"sourceFingerprint" text,"sourceDetails" jsonb)
      ON CONFLICT(venue_id,source_key) WHERE source_key IS NOT NULL DO UPDATE SET
        name=EXCLUDED.name,description=EXCLUDED.description,category=EXCLUDED.category,image_url=EXCLUDED.image_url,portion=EXCLUDED.portion,allergens=EXCLUDED.allergens,price_minor=EXCLUDED.price_minor,is_available=EXCLUDED.is_available,published=EXCLUDED.published,sort_order=EXCLUDED.sort_order,
        source_url=EXCLUDED.source_url,source_fingerprint=EXCLUDED.source_fingerprint,source_details=EXCLUDED.source_details,version=venue_menu_items.version+1,updated_at=clock_timestamp()`,
        [venueId, JSON.stringify(changed)],
      );
    await client.query(
      "INSERT INTO hostess_audit(actor,action,entity_id,details) VALUES($1,'menu_import',$2,$3)",
      [
        `staff:${staff.staff_id}`,
        venueId,
        JSON.stringify({ counts, sourceKeys: changed.map((i) => i.sourceKey) }),
      ],
    );
    await client.query(
      "INSERT INTO floor_operation_idempotency(venue_id,key,request_hash,response) VALUES($1,$2,$3,$4)",
      [venueId, input.idempotencyKey, signature, JSON.stringify(result)],
    );
    return result;
  });
}
