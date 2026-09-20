import { createFileRoute } from "@tanstack/react-router";

import { HallScreen } from "../components/hall/HallScreen";

export const Route = createFileRoute("/")({
  component: HallScreen,
});
