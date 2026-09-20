/*
 * exchange_products is the working catalog of the XOXO pricing engine.
 * Command Center only reads it and edits the pricing corridor
 * (min_price / max_price / price_step / is_active). current_price is never
 * touched here — it is owned by the round engine.
 */
import type { ExchangeProduct, ExchangeProductSettingsInput } from "../../lib/types/products";
import { query } from "../db/pool";

type ProductRow = {
  id: string;
  slug: string;
  name: string;
  category: string;
  volume_ml: number | null;
  currency: string;
  original_price: string;
  start_price: string;
  current_price: string;
  min_price: string;
  max_price: string;
  price_step: string;
  price_level_percent: number;
  is_active: boolean;
  image_url: string | null;
  updated_at: Date;
};

const SELECT = `
  SELECT ep.id, ep.slug, ep.name, ep.category, ep.volume_ml, ep.currency,
         ep.original_price, ep.start_price, ep.current_price,
         ep.min_price, ep.max_price, ep.price_step, ep.price_level_percent,
         ep.is_active, ep.updated_at,
         p.image_url
  FROM exchange_products ep
  LEFT JOIN products p ON p.exchange_key = ep.slug
`;

function mapProduct(row: ProductRow): ExchangeProduct {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: row.category,
    volumeMl: row.volume_ml === null ? null : Number(row.volume_ml),
    currency: row.currency,
    originalPrice: Number(row.original_price),
    startPrice: Number(row.start_price),
    currentPrice: Number(row.current_price),
    minPrice: Number(row.min_price),
    maxPrice: Number(row.max_price),
    priceStep: Number(row.price_step),
    priceLevelPercent: Number(row.price_level_percent),
    isActive: row.is_active,
    imageUrl: row.image_url,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function listExchangeProducts(): Promise<ExchangeProduct[]> {
  const result = await query<ProductRow>(`${SELECT} ORDER BY ep.category, ep.name`);
  return result.rows.map(mapProduct);
}

export async function getExchangeProduct(id: string): Promise<ExchangeProduct | null> {
  const result = await query<ProductRow>(`${SELECT} WHERE ep.id = $1`, [id]);
  return result.rows[0] ? mapProduct(result.rows[0]) : null;
}

export async function updateExchangeProductSettings(
  input: ExchangeProductSettingsInput,
): Promise<ExchangeProduct | null> {
  const result = await query<{ id: string }>(
    `UPDATE exchange_products
     SET min_price = $2, max_price = $3, price_step = $4, is_active = $5, updated_at = now()
     WHERE id = $1
     RETURNING id`,
    [input.id, input.minPrice, input.maxPrice, input.priceStep, input.isActive],
  );
  return result.rows[0] ? getExchangeProduct(input.id) : null;
}
