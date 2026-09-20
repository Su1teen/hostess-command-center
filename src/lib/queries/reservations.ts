import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { getReservationsBoard, getTableAvailability } from "../functions/reservations.fn";

export const RESERVATIONS_KEY = ["reservations"] as const;

export function reservationsBoardQuery(date?: string) {
  return queryOptions({
    queryKey: [...RESERVATIONS_KEY, "board", date ?? "today"],
    queryFn: () => getReservationsBoard({ data: date ? { date } : {} }),
    refetchInterval: 60_000,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
}

export function tableAvailabilityQuery(startsAt: string, endsAt: string) {
  return queryOptions({
    queryKey: [...RESERVATIONS_KEY, "availability", startsAt, endsAt],
    queryFn: () => getTableAvailability({ data: { startsAt, endsAt } }),
    staleTime: 15_000,
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
}
