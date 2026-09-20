import { createFileRoute } from "@tanstack/react-router";

import { ReservationsScreen } from "../components/reservations/ReservationsScreen";
import { reservationsBoardQuery } from "../lib/queries/reservations";

export const Route = createFileRoute("/reservations")({
  loader: ({ context }) => context.queryClient.ensureQueryData(reservationsBoardQuery()),
  component: ReservationsScreen,
});
