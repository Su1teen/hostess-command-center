import { requireStaff } from "../../server/guest/auth";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { getSalesDashboard as getSalesDashboardService } from "../../server/services/sales.service";

export const getSalesDashboard = createServerFn({ method: "GET" })
  .inputValidator(z.object({ filter: z.enum(["all", "alcohol", "kitchen"]) }))
  .handler(async ({ data }) => {
    await requireStaff();
    try {
      return await getSalesDashboardService(data.filter);
    } catch (error) {
      console.error("[command-center] operation failed");
      throw new Error("База данных недоступна");
    }
  });
