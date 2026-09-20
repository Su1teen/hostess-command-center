import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { HallScreen } from "../components/hall/HallScreen";

export const Route = createFileRoute("/")({
  validateSearch: z.object({ reservations: z.boolean().optional() }),
  component: HallRoute,
});

function HallRoute() {
  const { reservations } = Route.useSearch();
  return <HallScreen openReservations={reservations === true} />;
}
