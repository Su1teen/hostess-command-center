import { useQuery } from "@tanstack/react-query";
export async function staffApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/staff/v1${path}`, {
    cache: "no-store",
    ...init,
    headers: { ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message ?? "Сервис недоступен");
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
  tableCode: string;
  tableName: string;
  zoneName: string;
  guestId: string | null;
  guestName: string | null;
  guestPhone: string | null;
  status: keyof typeof statusLabels;
  manualPaymentAt: string | null;
  acceptedAt: string;
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
    roundId: string;
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
};
export const controlClass =
  "min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm disabled:opacity-40";
