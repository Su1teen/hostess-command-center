export type ReservationStatus = "confirmed" | "expected" | "arrived" | "cancelled" | "no_show";
export type DepositStatus = "none" | "pending" | "paid" | "refunded";
export type ReservationSource = "whatsapp" | "instagram" | "phone" | "website" | "manual" | "other";

export interface ReservationPreorder {
  id?: string;
  productId?: string | null;
  productName: string;
  quantity: number;
  unitPrice: number;
  total: number;
  comment?: string | null;
}

export interface Reservation {
  id: string;
  externalId: string | null;
  tableId: string | null;
  tableLabel: string | null;
  guestName: string;
  phone: string;
  guests: number;
  startsAt: string;
  endsAt: string | null;
  status: ReservationStatus;
  depositAmount: number;
  depositStatus: DepositStatus;
  source: ReservationSource;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
  preorders: ReservationPreorder[];
  preorderTotal: number;
}

export interface ReservationsBoard {
  /** YYYY-MM-DD in venue timezone */
  date: string;
  dateLabel: string;
  kpis: {
    reservationsToday: number;
    expectedGuests: number;
    depositsTotal: number;
    preordersTotal: number;
  };
  upcoming: Reservation[];
}

export type TableOccupancy = "free" | "booked" | "seated";

export interface TableAvailabilityEntry {
  tableId: string;
  status: TableOccupancy;
  /** Reservation overlapping the requested window (if any). */
  reservation: Reservation | null;
}

export interface TableAvailability {
  startsAt: string;
  endsAt: string;
  tables: TableAvailabilityEntry[];
}

export type CreateReservationResult =
  | { ok: true; reservation: Reservation }
  | { ok: false; code: "conflict" | "invalid"; message: string };

export const TABLE_OCCUPANCY_LABEL: Record<TableOccupancy, string> = {
  free: "Свободен",
  booked: "Забронирован",
  seated: "Гости на месте",
};

export const RESERVATION_STATUS_LABEL: Record<ReservationStatus, string> = {
  confirmed: "Подтверждена",
  expected: "Ожидается",
  arrived: "Пришли",
  cancelled: "Отменена",
  no_show: "Не пришли",
};

export const DEPOSIT_STATUS_LABEL: Record<DepositStatus, string> = {
  none: "Без задатка",
  pending: "Задаток ожидается",
  paid: "Задаток получен",
  refunded: "Возвращён",
};

export const RESERVATION_SOURCE_LABEL: Record<ReservationSource, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  phone: "Телефон",
  website: "Сайт",
  manual: "Вручную",
  other: "Другое",
};
