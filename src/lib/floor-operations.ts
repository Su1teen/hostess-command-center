import type { DineOrder } from "./dine-in-client";

export type FloorReservation = {
  id: string;
  version: number;
  resourceId: string | null;
  guestId: string | null;
  guestName: string;
  phone: string | null;
  guests: number;
  startsAt: string;
  endsAt: string;
  status: "confirmed" | "expected" | "arrived" | "cancelled" | "no_show";
  source: string;
  comment: string | null;
  preorders: { productName: string; quantity: number; comment: string | null }[];
};
export type FloorSession = {
  id: string;
  resourceId: string;
  reservationId: string | null;
  guestId: string | null;
  guestName: string | null;
  guestPhone: string | null;
  guests: number | null;
  openedAt: string;
  seatedAt: string | null;
  expectedEndAt: string | null;
  closedAt: string | null;
  status: "qr_activity" | "seated" | "released" | "expired";
  version: number;
  orderCount: number;
  activeOrderCount: number;
  payableMinor: string;
};
export type FloorLayout = {
  version: number;
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
  shape: string | null;
  rotation: number | null;
};
export type FloorEvent = {
  id: string;
  source: "reservation" | "session" | "hold";
  startsAt: string;
  endsAt: string;
  label: string;
  status: string;
  reservationId?: string;
  sessionId?: string;
};
export type FloorState =
  | "free"
  | "reserved"
  | "seated"
  | "qr_activity"
  | "overdue"
  | "blocked"
  | "unconfigured";
export type FloorResource = {
  id: string;
  code: string;
  name: string;
  zoneId: string;
  capacity: number | null;
  resourceType: "table" | "private_room" | "bar_seating";
  enabled: boolean;
  qrUrl: string;
  bookingResourceId: string | null;
  bookable: boolean;
  available: boolean;
  relationship: "pending" | "independent" | "linked";
  state: FloorState;
  layout: FloorLayout;
  currentSession: FloorSession | null;
  projectedSession: FloorSession | null;
  currentReservation: FloorReservation | null;
  nextReservation: FloorReservation | null;
  reservations: FloorReservation[];
  sessions: FloorSession[];
  events: FloorEvent[];
  warnings: string[];
};
export type FloorZone = {
  id: string;
  code: string;
  name: string;
  resources: FloorResource[];
  counts: {
    total: number;
    seated: number;
    available: number;
    reservations: number;
    activeOrders: number;
    attention: number;
  };
};
export type FloorSnapshot = {
  date: string;
  startsAt: string;
  endsAt: string;
  at: string;
  intervalEndsAt: string;
  now: string;
  timezone: "Asia/Almaty";
  zones: FloorZone[];
};
export type FloorFolio = {
  session: FloorSession;
  table: { resourceId: string; code: string; name: string; zoneName: string };
  reservation: FloorReservation | null;
  orders: DineOrder[];
  totals: {
    subtotalMinor: string;
    discountMinor: string;
    payableMinor: string;
    cashbackMinor: string;
    cancelledMinor: string;
    manualReceivedMinor: string;
    withoutManualReceiptMinor: string;
  };
  events: {
    id: string;
    type: string;
    actor: string;
    createdAt: string;
    details: Record<string, unknown>;
  }[];
};
export type SeatInput = {
  resourceId: string;
  reservationId?: string;
  guests: number;
  guestId?: string;
  expectedEndAt: string;
  idempotencyKey: string;
};
export type ReleaseInput = { reason: string; version: number; idempotencyKey: string };
export type FloorReservationInput = {
  resourceId: string;
  guestName: string;
  phone?: string;
  guests: number;
  startsAt: string;
  endsAt: string;
  source: "whatsapp" | "instagram" | "phone" | "website" | "manual" | "other";
  comment?: string;
  idempotencyKey: string;
};
export type FloorReservationChange = {
  version: number;
  status?: "confirmed" | "expected" | "cancelled" | "no_show";
  reason: string;
  startsAt?: string;
  endsAt?: string;
  resourceId?: string;
  idempotencyKey: string;
};
export type FloorLayoutInput = {
  zoneId: string;
  resources: {
    resourceId: string;
    version: number;
    x: number;
    y: number;
    width: number;
    height: number;
    shape: "rectangle" | "round";
    rotation: number;
  }[];
  idempotencyKey: string;
};
