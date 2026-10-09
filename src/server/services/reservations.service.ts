import type {
  CreateReservationResult,
  ReservationPreorder,
  ReservationStatus,
  DepositStatus,
  ReservationsBoard,
  TableAvailability,
  TableAvailabilityEntry,
  TableOccupancy,
} from "../../lib/types/reservations";
import { HALL_TABLES, findTable } from "../../lib/hall/layout";
import { almatyDayRange } from "../time";
import * as reservations from "../repositories/reservations.repository";

export async function getReservationsBoard(date?: string): Promise<ReservationsBoard> {
  const range = almatyDayRange(date);
  const upcoming = await reservations.listByRange(range.start, range.end);
  const active = upcoming.filter((reservation) => reservation.status !== "cancelled");
  return {
    date: range.date,
    dateLabel: range.dateLabel,
    kpis: {
      reservationsToday: active.length,
      expectedGuests: upcoming
        .filter(
          (reservation) => reservation.status === "confirmed" || reservation.status === "expected",
        )
        .reduce((sum, reservation) => sum + reservation.guests, 0),
      depositsTotal: upcoming
        .filter((reservation) => reservation.depositStatus === "paid")
        .reduce((sum, reservation) => sum + reservation.depositAmount, 0),
      preordersTotal: upcoming.reduce((sum, reservation) => sum + reservation.preorderTotal, 0),
    },
    upcoming: [...upcoming].sort((a, b) => {
      const terminal = (status: string) => status === "cancelled" || status === "no_show";
      return (
        Number(terminal(a.status)) - Number(terminal(b.status)) ||
        a.startsAt.localeCompare(b.startsAt)
      );
    }),
  };
}

/**
 * Occupancy of every hall table for the window [startsAt, endsAt).
 * Single query for all tables; `arrived` wins over `confirmed`/`expected`.
 */
export async function getTableAvailability(
  startsAt: string,
  endsAt: string,
): Promise<TableAvailability> {
  const overlapping = await reservations.listActiveOverlapping(
    new Date(startsAt),
    new Date(endsAt),
  );
  const byTable = new Map<string, TableAvailabilityEntry>();
  for (const reservation of overlapping) {
    if (!reservation.tableIds.length) continue;
    for (const tableId of reservation.tableIds) {
      const status: TableOccupancy = reservation.status === "arrived" ? "seated" : "booked";
      const existing = byTable.get(tableId);
      if (!existing || (existing.status === "booked" && status === "seated")) {
        byTable.set(tableId, { tableId, status, reservation });
      }
    }
  }
  return {
    startsAt,
    endsAt,
    tables: HALL_TABLES.map(
      (table) => byTable.get(table.id) ?? { tableId: table.id, status: "free", reservation: null },
    ),
  };
}

export async function createReservation(
  input: Omit<reservations.ReservationInsert, "tableLabel">,
  preorders: ReservationPreorder[],
): Promise<CreateReservationResult> {
  const table = findTable(input.tableId);
  if (!table) return { ok: false, code: "invalid", message: "Такого стола нет в зале" };
  if (new Date(input.endsAt) <= new Date(input.startsAt))
    return {
      ok: false,
      code: "invalid",
      message: "Время окончания должно быть позже начала",
    };
  if (input.guests > table.seats)
    return { ok: false, code: "invalid", message: "Превышена вместимость стола" };
  try {
    const reservation = await reservations.insert(
      { ...input, tableLabel: table.label },
      preorders.map((preorder) => ({
        ...preorder,
        total: preorder.quantity * preorder.unitPrice,
      })),
    );
    return { ok: true, reservation };
  } catch (error) {
    if (error instanceof reservations.ReservationConflictError) {
      return {
        ok: false,
        code: "conflict",
        message: `Стол ${table.label} уже занят: ${error.conflicting.guestName}`,
      };
    }
    if ((error as { code?: string })?.code === "23P01")
      return {
        ok: false,
        code: "conflict",
        message: "Стол занят или временно удерживается гостем",
      };
    throw error;
  }
}

export function setReservationStatus(id: string, status: ReservationStatus) {
  return reservations.updateStatus(id, status);
}

export function setDepositStatus(id: string, status: DepositStatus) {
  return reservations.updateDepositStatus(id, status);
}
