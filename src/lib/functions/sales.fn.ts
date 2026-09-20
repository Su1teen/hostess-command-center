import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { getSalesDashboard as getSalesDashboardService } from "../../server/services/sales.service";

export const getSalesDashboard = createServerFn({ method: "GET" })
  .inputValidator(z.object({ filter: z.enum(["all", "alcohol", "kitchen"]) }))
  .handler(async ({ data }) => {
    try {
      return await getSalesDashboardService(data.filter);
    } catch (error) {
      console.error("[sales] getSalesDashboard failed", error);
      throw new Error("База данных недоступна");
    }
  });
