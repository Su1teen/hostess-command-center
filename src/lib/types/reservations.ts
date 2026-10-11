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
  tableIds: string[];
  tableId: string | null;
  tableLabel: string | null;
  resourceId?: string | null;
  resourceName?: string | null;
  zoneName?: string | null;
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
  resources: VenueResourceAvailability[];
  zones: VenueZoneAvailability[];
}

export interface VenueZoneAvailability {
  id: string;
  code: string;
  name: string;
  type: "main_hall" | "secondary_hall" | "vip" | "shared_hall" | "bar";
  description: string | null;
  displayOrder: number;
  resources: VenueResourceAvailability[];
}

export interface VenueResourceAvailability {
  id: string;
  zoneId: string;
  zoneCode: string;
  zoneName: string;
  code: string;
  name: string;
  resourceType: "table" | "private_room" | "bar_seating";
  capacity: number | null;
  isReservable: boolean;
  status: "free" | "booked" | "unavailable";
  available: boolean;
  layout: {
    x: number | null;
    y: number | null;
    width: number | null;
    height: number | null;
    shape: string | null;
    rotation: number | null;
  } | null;
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
