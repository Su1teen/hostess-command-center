import { createFileRoute } from "@tanstack/react-router";

import { pingDb } from "../server/db/pool";

export const Route = createFileRoute("/health")({
  server: {
    handlers: {
      GET: async () =>
        Response.json({
          status: "ok",
          buildSha: process.env.RAILWAY_GIT_COMMIT_SHA ?? "unknown",
          db: (await pingDb()) ? "ok" : "unavailable",
          timestamp: new Date().toISOString(),
        }),
    },
  },
});
