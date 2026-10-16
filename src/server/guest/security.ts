import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const randomToken = () => randomBytes(32).toString("base64url");
export function equalSecret(a: string | null | undefined, b: string | undefined) {
  if (!a || !b || b.length < 32) return false;
  return timingSafeEqual(Buffer.from(hash(a), "hex"), Buffer.from(hash(b), "hex"));
}
export function readCookie(request: Request, name: string) {
  return (request.headers.get("cookie") ?? "")
    .split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}
export function cookie(name: string, value: string, maxAge: number) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
export function verifyPassword(password: string, encoded: string) {
  const [salt, expected] = encoded.split(":");
  if (!salt || !/^[a-f0-9]{128}$/.test(expected ?? "")) return false;
  return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(expected, "hex"));
}
export function whatsappSubject(jid: string) {
  // LID cannot be interpreted as phone. A trusted WAHA resolver must supply a real sender JID.
  const match = /^(7\d{10})@(?:c\.us|s\.whatsapp\.net)$/.exec(jid);
  if (!match)
    throw new ApiError(
      422,
      "IDENTITY_UNVERIFIED",
      "Нужно подтвердить WhatsApp identity; LID не является телефоном",
    );
  return { subject: `${match[1]}@c.us`, phone: `+${match[1]}` };
}
export const intervalSchema = z
  .object({
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
  })
  .refine((v) => {
    const duration = Date.parse(v.endsAt) - Date.parse(v.startsAt);
    return duration >= 30 * 60_000 && duration <= 6 * 3600_000;
  }, "Длительность: от 30 минут до 6 часов");
export const selectionSchema = z.object({
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  guests: z.number().int().min(1).max(20),
  tableIds: z.array(z.string()).min(1).max(4),
});
export const inventorySelectionSchema = z
  .object({
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    guests: z.number().int().min(1).max(20),
    resourceId: z.string().uuid().optional(),
    zoneId: z.string().uuid().optional(),
  })
  .strict();
export const bookingSelectionSchema = z.union([selectionSchema, inventorySelectionSchema]);
export function validateBookingWindow(
  input: { startsAt: string; endsAt: string },
  allowPast = false,
) {
  intervalSchema.parse(input);
  if (
    (!allowPast && Date.parse(input.startsAt) < Date.now()) ||
    Date.parse(input.startsAt) > Date.now() + 90 * 86400_000
  )
    throw new ApiError(422, "INVALID_DATE", "Выберите будущую дату в пределах 90 дней");
  const local = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Almaty",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const minutes = (s: string) => {
    const [h, m] = local.format(new Date(s)).split(":").map(Number);
    return h * 60 + m;
  };
  const start = minutes(input.startsAt),
    duration = (Date.parse(input.endsAt) - Date.parse(input.startsAt)) / 60_000;
  const serviceMinute = start < 17 * 60 ? start + 1440 : start;
  if (serviceMinute < 17 * 60 || serviceMinute + duration > 28 * 60)
    throw new ApiError(422, "CLOSED", "Бронирование доступно с 17:00 до 04:00");
}

export function validateSelection(
  input: z.infer<typeof selectionSchema>,
  tables: { id: string; seats: number }[],
  allowPast = false,
) {
  validateBookingWindow(input, allowPast);
  const ids = [...new Set(input.tableIds)];
  if (ids.length !== input.tableIds.length || ids.some((id) => !tables.some((t) => t.id === id)))
    throw new ApiError(422, "INVALID_TABLE", "Проверьте выбранные столы");
  // Only contiguous A or B tables can be joined. Round tables and bar stay separate.
  if (ids.length > 1) {
    const sorted = ids.slice().sort();
    if (
      !sorted.every(
        (id, i) =>
          /^[AB][1-4]$/.test(id) &&
          id[0] === sorted[0][0] &&
          (!i || Number(id[1]) === Number(sorted[i - 1][1]) + 1),
      )
    )
      throw new ApiError(422, "INVALID_GROUP", "Можно объединить соседние столы одного ряда");
  }
  const capacity = ids.reduce((sum, id) => sum + tables.find((t) => t.id === id)!.seats, 0);
  if (input.guests > capacity) throw new ApiError(422, "CAPACITY", "Выбранных мест недостаточно");
}
