import { createFileRoute } from "@tanstack/react-router";

import { SalesScreen } from "../components/analytics/SalesScreen";
import { salesDashboardQuery } from "../lib/queries/sales";

export const Route = createFileRoute("/sales")({
  loader: async ({ context }) => {
    try {
      await context.queryClient.ensureQueryData(salesDashboardQuery("all"));
    } catch {
      return null;
    }
  },
  component: SalesScreen,
});
