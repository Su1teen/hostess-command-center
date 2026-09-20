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
  dateLabel: string;
  kpis: {
    reservationsToday: number;
    expectedGuests: number;
    depositsTotal: number;
    preordersTotal: number;
  };
  upcoming: Reservation[];
}

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
