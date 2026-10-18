import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

process.env.HOST ??= "0.0.0.0";
// Railway may start directly from main. Apply additive migrations under the
// migration runner's advisory lock before accepting any QR or staff request.
const migration = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("./migrate.mjs", import.meta.url))],
  {
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  },
);
if (migration.error || migration.status !== 0)
  throw new Error("Database migration failed; refusing to serve an incompatible schema");
await import("../.output/server/index.mjs");
