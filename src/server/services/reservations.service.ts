import type {
  ReservationPreorder,
  ReservationStatus,
  DepositStatus,
  ReservationsBoard,
} from "../../lib/types/reservations";
import { almatyDayRange } from "../time";
import * as reservations from "../repositories/reservations.repository";

export async function getReservationsBoard(): Promise<ReservationsBoard> {
  const { start, end, dateLabel } = almatyDayRange();
  const upcoming = await reservations.listByRange(start, end);
  const active = upcoming.filter((reservation) => reservation.status !== "cancelled");
  return {
    dateLabel,
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

export async function createReservation(
  input: reservations.ReservationInsert,
  preorders: ReservationPreorder[],
) {
  return reservations.insert(
    input,
    preorders.map((preorder) => ({
      ...preorder,
      total: preorder.quantity * preorder.unitPrice,
    })),
  );
}

export function setReservationStatus(id: string, status: ReservationStatus) {
  return reservations.updateStatus(id, status);
}

export function setDepositStatus(id: string, status: DepositStatus) {
  return reservations.updateDepositStatus(id, status);
}
