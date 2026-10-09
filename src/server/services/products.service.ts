import { exchangeRequest, exchangeApiEnabled } from "./exchange-bridge";
import { requireStaff } from "../guest/auth";
import type {
  ExchangeProduct,
  ExchangeProductSettingsInput,
  UpdateProductResult,
} from "../../lib/types/products";
import * as products from "../repositories/products.repository";

export function listExchangeProducts(): Promise<ExchangeProduct[]> {
  return exchangeApiEnabled()
    ? exchangeRequest<ExchangeProduct[]>("/products")
    : products.listExchangeProducts();
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
  const { id, ...settings } = input;
  const product = exchangeApiEnabled()
    ? await exchangeRequest<ExchangeProduct>(
        `/products/${id}`,
        settings,
        (await requireStaff(true, true)).staff_id ?? undefined,
      )
    : await products.updateExchangeProductSettings(input);
  if (!product) return { ok: false, message: "Товар не найден" };
  return { ok: true, product };
}
