import { createFileRoute } from "@tanstack/react-router";

import { DashboardScreen } from "../components/dashboard/DashboardScreen";

export const Route = createFileRoute("/dashboard")({
  component: DashboardScreen,
});
