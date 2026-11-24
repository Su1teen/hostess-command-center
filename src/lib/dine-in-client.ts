import { useQuery } from "@tanstack/react-query";
export async function staffApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/staff/v1${path}`, {
    cache: "no-store",
    ...init,
    headers: { ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers },
  });
  const data = await response.json();
  if (response.status === 401 && typeof window !== "undefined")
    window.dispatchEvent(new CustomEvent("hostess:session-expired"));
  if (!response.ok)
    throw Object.assign(new Error(data.error?.message ?? "Сервис недоступен"), {
      code: data.error?.code,
      status: response.status,
    });
  return data;
}
export function useStaffRole() {
  return useQuery({
    queryKey: ["staff-role"],
    queryFn: () => staffApi<{ staff: { role: string } }>("/me"),
    staleTime: 60000,
  }).data?.staff.role;
}
export const money = (minor: string | number) =>
  new Intl.NumberFormat("ru-KZ", {
    style: "currency",
    currency: "KZT",
    maximumFractionDigits: 2,
  }).format(Number(minor) / 100);
export const dateTime = (date: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Almaty",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(date));
/** Staff see the name printed on the plate («VIP 01», «Стол 02»), never the internal code. */
export const placeName = (o: { tableName?: string | null; tableCode: string }) =>
  o.tableName || `Стол ${o.tableCode}`;
export const placeWithZone = (o: {
  tableName?: string | null;
  tableCode: string;
  zoneName?: string | null;
}) => (o.zoneName ? `${placeName(o)} · ${o.zoneName}` : placeName(o));
export const statusLabels = {
  new: "Новый",
  accepted: "Принят",
  preparing: "Готовится",
  delivered: "Доставлен",
  closed: "Закрыт",
  cancelled: "Отменён",
};
export type DineOrder = {
  id: string;
  number: string;
  source?: "staff" | "qr" | "table_code" | "web_app";
  diningSessionId?: string;
  tableResourceId?: string;
  tableCode: string;
  tableName: string;
  zoneName: string;
  guestId: string | null;
  guestName: string | null;
  guestPhone: string | null;
  status: keyof typeof statusLabels;
  manualPaymentAt: string | null;
  acceptedAt: string;
  archivedAt?: string | null;
  subtotalMinor: string;
  discountMinor: string;
  payableMinor: string;
  cashbackMinor: string;
  items: {
    id: string;
    name: string;
    quantity: number;
    unitPriceMinor: string;
    totalMinor: string;
    roundId: string | null;
    itemType?: "EXCHANGE" | "REGULAR_MENU";
    menuVersion?: number | null;
    priceLevelPercent?: number | null;
    originalPriceMinor?: string | null;
  }[];
  events: {
    id: string;
    type: string;
    actor: string;
    createdAt: string;
    details: Record<string, unknown>;
  }[];
};
export type QrTable = {
  id: string;
  resourceId: string;
  code: string;
  name: string;
  zoneId: string;
  zoneName: string;
  url: string;
  enabled: boolean;
  generation: number;
  legacyCode: string | null;
  mappingVerified: boolean;
  bookable: boolean;
  zoneCode: string;
  resourceType: "table" | "private_room" | "bar_seating";
  capacity: number | null;
  version: number;
  relationship: "pending" | "independent" | "linked";
  linkedResourceId: string | null;
  linkedResourceName: string | null;
  linkedResourceCode: string | null;
  verificationNote: string;
  verifiedAt: string | null;
  bookingState: "pending" | "available" | "unavailable";
};
export type BookingTarget = {
  id: string;
  code: string;
  name: string;
  zoneName: string;
  resourceType: QrTable["resourceType"];
  capacity: number | null;
  linkedFromResourceId: string | null;
  bookable: boolean;
};
export type QrRegistry = {
  tables: QrTable[];
  zones: { id: string; name: string; code: string }[];
  bookingTargets: BookingTarget[];
  distribution?: { matchesExpected: boolean; expectedLabel: string };
};
export const controlClass =
  "min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm disabled:opacity-40";
/** Order made of exchange (биржа) lines — shown in violet, rings with its own sound. */
export const isExchangeOrder = (o: { items: { itemType?: string }[] }) =>
  o.items.length > 0 && o.items.some((i) => i.itemType === "EXCHANGE");
/** Exchange price index, same wording as on the board: «Уровень −10%». */
export const levelLabel = (level: number | null | undefined) =>
  level == null ? null : `Уровень ${level > 0 ? "+" : level < 0 ? "−" : ""}${Math.abs(level)}%`;
/** Order can go to the archive once it is done (mirrors the server rule). */
export const canArchive = (o: {
  status: string;
  manualPaymentAt: string | null;
  archivedAt?: string | null;
}) =>
  !o.archivedAt &&
  (o.status === "closed" ||
    o.status === "cancelled" ||
    (o.status === "delivered" && !!o.manualPaymentAt));
