import type {
  ExchangeProduct,
  ExchangeProductSettingsInput,
  UpdateProductResult,
} from "../../lib/types/products";
import * as products from "../repositories/products.repository";

export function listExchangeProducts(): Promise<ExchangeProduct[]> {
  return products.listExchangeProducts();
}

export function validateProductSettings(input: ExchangeProductSettingsInput): string | null {
  if (!Number.isFinite(input.minPrice) || input.minPrice < 0)
    return "Минимальная цена не может быть отрицательной";
  if (!Number.isFinite(input.maxPrice) || input.maxPrice < input.minPrice)
    return "Максимальная цена должна быть не меньше минимальной";
  if (!Number.isFinite(input.priceStep) || input.priceStep <= 0)
    return "Шаг цены должен быть больше нуля";
  return null;
}

export async function updateProductSettings(
  input: ExchangeProductSettingsInput,
): Promise<UpdateProductResult> {
  const error = validateProductSettings(input);
  if (error) return { ok: false, message: error };
  const product = await products.updateExchangeProductSettings(input);
  if (!product) return { ok: false, message: "Товар не найден" };
  return { ok: true, product };
}
