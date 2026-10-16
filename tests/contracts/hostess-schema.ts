// Consumer compatibility fixture: Su1teen/hostess src/lib/dine-in-api.ts, 2026-10-16.
import {z} from "zod";
const id = z.string().min(1).max(200);
const amount = z.number().finite().nonnegative();
const date = z.string().datetime({ offset: true });
export const tableSchema = z.object({
  venue: z.object({ id, slug: z.string(), name: z.string(), currency: z.literal("KZT") }),
  table: z.object({
    resourceId: id,
    code: z.string(),
    name: z.string(),
    zoneName: z.string().nullable().optional(),
  }),
});
export const menuSchema = z.object({
  generatedAt: date,
  status: z.enum(["ok", "no_published_round"]),
  currentRound: z.object({ id, endsAt: date }).nullable(),
  products: z.array(
    z.object({
      id,
      name: z.string(),
      price: amount,
      originalPrice: amount.optional(),
      changePercent: z.number().finite().optional(),
      isAvailable: z.boolean(),
      category: z.string().nullable().optional(),
      imageUrl: z.string().url().nullable().optional(),
    }),
  ),
});
export const lineSchema = z.object({
  productId: id,
  productName: z.string(),
  quantity: z.number().int().min(1).max(20),
  unitPrice: amount,
  total: amount,
});
export const totalsSchema = z.object({
  subtotal: amount,
  discount: amount,
  payable: amount,
  cashback: amount,
});
export const quoteSchema = totalsSchema.extend({
  id,
  expiresAt: date,
  roundId: id,
  lines: z.array(lineSchema).min(1),
  // An opaque anonymous binding, when required by Command Center. Never a guest ID.
  checkoutToken: z.string().optional(),
});
export const orderSchema = totalsSchema.extend({
  id,
  orderNumber: z.union([z.string(), z.number()]),
  createdAt: date,
  venueCode: z.string(),
  tableCode: z.string(),
  status: z.string(),
  paymentStatus: z.literal("assumed_paid"),
  lines: z.array(lineSchema).min(1),
  cashbackExpiresAt: date.nullable().optional(),
  receiptToken: z.string().optional(),
});
export const walletSchema = z.object({
  balance: amount,
  expiringAmount: amount,
  nextExpiresAt: date.nullable(),
  lots: z.array(z.object({ id, remaining: amount, expiresAt: date })),
});
export const transactionSchema = z.object({
  id,
  type: z.enum(["earn", "redeem", "expire", "reversal", "adjustment"]),
  amount: z.number().finite(),
  createdAt: date,
  expiresAt: date.nullable().optional(),
  orderId: z.string().nullable().optional(),
});
export const profileSchema = z.object({
  guest: z.object({
    id,
    name: z.string(),
    provisional: z.boolean(),
    phone: z.string().nullable().optional(),
  }),
});
