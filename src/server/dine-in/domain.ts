import { z } from "zod";
import { ApiError } from "../guest/security";

export const moneySchema = z.number().int().min(0).max(100_000_000_000);
export const quoteInput = z
  .object({
    qrToken: z.string().regex(/^(?:[A-Za-z0-9_-]{43,64}|web_[a-f0-9-]{36})$/),
    items: z
      .array(
        z
          .object({
            productId: z.string().uuid(),
            quantity: z.number().int().min(1).max(20),
            itemType: z.enum(["EXCHANGE", "REGULAR_MENU"]).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(30),
    redeemMinor: moneySchema.optional(),
    redeemAmount: z.number().finite().nonnegative().max(1_000_000_000).optional(),
  })
  .strict()
  .refine(
    (v) =>
      new Set(v.items.map((i) => `${i.itemType ?? "EXCHANGE"}:${i.productId}`)).size ===
      v.items.length,
    "Duplicate products",
  )
  .refine(
    (v) => v.redeemMinor === undefined || v.redeemAmount === undefined,
    "Use one redemption unit",
  )
  .transform((v) => ({
    ...v,
    redeemMinor:
      v.redeemAmount === undefined
        ? (v.redeemMinor ?? 0)
        : toMinor(v.redeemAmount, 100_000_000_000),
  }));
export const orderInput = z
  .object({ quoteId: z.string().uuid(), idempotencyKey: z.string().min(16).max(128) })
  .strict();
export const statusNames = [
  "new",
  "accepted",
  "preparing",
  "delivered",
  "closed",
  "cancelled",
] as const;
export type OrderStatus = (typeof statusNames)[number];
export function assertTransition(from: OrderStatus, to: OrderStatus) {
  if (from === to) return;
  if (
    to === "cancelled" ||
    statusNames.indexOf(to) !== statusNames.indexOf(from) + 1 ||
    from === "closed" ||
    from === "cancelled"
  )
    throw new ApiError(409, "INVALID_TRANSITION", "Недопустимый переход статуса");
}
export function toMinor(value: number | string, maximum = 1_000_000_000) {
  const text = String(value);
  if (!/^\d+(\.\d{1,2})?$/.test(text))
    throw new ApiError(503, "INVALID_PRICE", "Некорректная цена биржи");
  const [whole, fraction = ""] = text.split(".");
  const result = Number(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0")));
  if (!Number.isSafeInteger(result) || result > maximum)
    throw new ApiError(503, "INVALID_PRICE", "Цена вне допустимого диапазона");
  return result;
}
export function calculate(
  subtotal: number,
  requested: number,
  balance: number,
  bps = 300,
  limit = 10000,
) {
  const discount = Math.min(
    requested,
    balance,
    Number((BigInt(subtotal) * BigInt(limit)) / 10000n),
  );
  const payable = subtotal - discount;
  return {
    subtotalMinor: subtotal,
    discountMinor: discount,
    payableMinor: payable,
    cashbackMinor: Number((BigInt(payable) * BigInt(bps)) / 1_000_000n) * 100,
  };
}
export function normalizePhone(input: string) {
  let digits = input.replace(/[^0-9]/g, "");
  if (digits.length === 11 && digits.startsWith("8")) digits = "7" + digits.slice(1);
  if (digits.length === 10) digits = "7" + digits;
  if (!/^7\d{10}$/.test(digits))
    throw new ApiError(422, "INVALID_PHONE", "Введите номер +7XXXXXXXXXX");
  return "+" + digits;
}
export const snapshotSchema = z.object({
  status: z.literal("ok"),
  generatedAt: z.string().datetime(),
  currentRound: z.object({ id: z.string().uuid(), endsAt: z.string().datetime() }),
  products: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string().min(1).max(200),
      price: z.union([z.number().finite().nonnegative(), z.string()]),
      currency: z.literal("KZT"),
      isAvailable: z.boolean(),
      slug: z.string().optional(),
      category: z.string().optional(),
      imageUrl: z.string().nullable().optional(),
      volumeMl: z.number().nullable().optional(),
      originalPrice: z.number().nullable().optional(),
      previousPrice: z.number().nullable().optional(),
      minPrice: z.number().nullable().optional(),
      changePercent: z.number().nullable().optional(),
    }),
  ),
});
export type Snapshot = z.infer<typeof snapshotSchema>;
export type Line = {
  productId: string;
  name: string;
  quantity: number;
  unitPriceMinor: number;
  totalMinor: number;
  roundId: string | null;
  itemType?: "EXCHANGE" | "REGULAR_MENU";
  menuVersion?: number;
};
export function priceLines(
  snapshot: Snapshot,
  items: z.infer<typeof quoteInput>["items"],
  now = Date.now(),
) {
  const expiry = Math.min(now + 120_000, Date.parse(snapshot.currentRound.endsAt));
  if (expiry <= now + 5000 || Math.abs(now - Date.parse(snapshot.generatedAt)) > 60_000)
    throw new ApiError(409, "REQUOTE", "Раунд обновляется. Запросите новую цену");
  const lines = items.map((item) => {
    const p = snapshot.products.find((p) => p.id === item.productId && p.isAvailable);
    if (!p) throw new ApiError(409, "PRODUCT_UNAVAILABLE", "Товар недоступен");
    const unitPriceMinor = toMinor(p.price);
    return {
      ...item,
      itemType: "EXCHANGE" as const,
      name: p.name,
      unitPriceMinor,
      totalMinor: unitPriceMinor * item.quantity,
      roundId: snapshot.currentRound.id,
    };
  });
  return { lines, expiresAt: new Date(expiry).toISOString() };
}
