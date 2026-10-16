import pg from "pg";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
const raw = process.env.TEST_DATABASE_URL;
if (!raw)
  throw new Error("TEST_DATABASE_URL must point to isolated local PostgreSQL (user hostess_test)");
const url = new URL(raw);
if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.username !== "hostess_test")
  throw new Error("Refusing non-local or non-test database");
const pool = new pg.Pool({ connectionString: raw });
let failed = false;
function run(cmd, args, env) {
  const p = spawnSync(cmd, args, {
    env: { ...process.env, ...env },
    stdio: "inherit",
    shell: false,
  });
  if (p.error) throw p.error;
  if (p.status !== 0) throw new Error(`${cmd} exited ${p.status}`);
}
try {
  for (const suite of ["booking", "dine-in", "migrations"]) {
    const schema = "hostess_test_" + randomUUID().replaceAll("-", "");
    await pool.query(`CREATE SCHEMA ${schema}`);
    const scoped = new URL(raw);
    scoped.searchParams.set("options", `-c search_path=${schema},public`);
    const env = {
      DATABASE_URL: scoped.href,
      TEST_BOOKING_DATABASE_URL: scoped.href,
      TEST_DINING_DATABASE_URL: scoped.href,
      NODE_ENV: "test",
      ALLOW_GUEST_BOOKING_MIGRATION: "yes",
      HOSTESS_BFF_KEY: "b".repeat(43),
      WHATSAPP_SERVICE_KEY: "w".repeat(43),
      COMMAND_CENTER_SERVICE_KEY: "s".repeat(43),
      EXCHANGE_API_ORIGIN: "http://127.0.0.1:19092",
      COMMAND_CENTER_ORIGIN: "https://command.test",
      DINE_IN_ENABLED: suite === "dine-in" ? "yes" : "no",
      DINE_IN_PILOT_ASSUMED_PAID: "yes",
      DINE_IN_OUTBOX_ENABLED: "no",
    };
    try {
      if (suite === "migrations") {
        run(process.execPath, ["scripts/migrate.mjs"], env);
        const a = await pool.query(`SELECT token FROM ${schema}.table_qr_codes ORDER BY token`);
        run(process.execPath, ["scripts/migrate.mjs"], env);
        const b = await pool.query(`SELECT token FROM ${schema}.table_qr_codes ORDER BY token`);
        if (a.rowCount !== 17 || JSON.stringify(a.rows) !== JSON.stringify(b.rows))
          throw new Error("Migration replay changed QR tokens");
        console.log("PASS migration runner clean schema and replay; 17 unchanged QR tokens");
      } else
        run(
          process.env.BUN_BINARY || "bun",
          [
            "test",
            `tests/${suite === "booking" ? "booking.integration" : "dine-in.integration"}.test.ts`,
            "--timeout",
            "20000",
          ],
          env,
        );
    } catch (error) {
      failed = true;
      console.error(error.message);
    } finally {
      await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    }
  }
} finally {
  await pool.end();
}
if (failed) process.exitCode = 1;
