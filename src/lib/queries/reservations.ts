import { queryOptions } from "@tanstack/react-query";
import { getReservationsBoard } from "../functions/reservations.fn";

export function reservationsBoardQuery() {
  return queryOptions({
    queryKey: ["reservations-board"],
    queryFn: () => getReservationsBoard(),
    refetchInterval: 60_000,
  });
}
