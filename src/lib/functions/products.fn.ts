import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  listExchangeProducts as listProducts,
  updateProductSettings as updateSettings,
} from "../../server/services/products.service";

export const getExchangeProducts = createServerFn({ method: "GET" }).handler(async () => {
  try {
    return await listProducts();
  } catch (error) {
    console.error("[products] getExchangeProducts failed", error);
    throw new Error("База данных недоступна");
  }
});

export const updateExchangeProductSettings = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      id: z.string().uuid(),
      minPrice: z.number().min(0),
      maxPrice: z.number().min(0),
      priceStep: z.number().positive(),
      isActive: z.boolean(),
    }),
  )
  .handler(async ({ data }) => {
    try {
      return await updateSettings(data);
    } catch (error) {
      console.error("[products] updateExchangeProductSettings failed", error);
      throw new Error("База данных недоступна");
    }
  });
