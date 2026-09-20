/** Row of XOXO `exchange_products` (+ `products.image_url` when linked by exchange_key). */
export interface ExchangeProduct {
  id: string;
  slug: string;
  name: string;
  category: string;
  volumeMl: number | null;
  currency: string;
  originalPrice: number;
  startPrice: number;
  currentPrice: number;
  minPrice: number;
  maxPrice: number;
  priceStep: number;
  priceLevelPercent: number;
  isActive: boolean;
  imageUrl: string | null;
  updatedAt: string;
}

export interface ExchangeProductSettingsInput {
  id: string;
  minPrice: number;
  maxPrice: number;
  priceStep: number;
  isActive: boolean;
}

export type UpdateProductResult =
  | { ok: true; product: ExchangeProduct }
  | { ok: false; message: string };
