import pg from "pg";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const raw = process.env.TEST_DATABASE_URL;
const url = new URL(raw ?? "http://invalid");
if (!raw || !["127.0.0.1", "localhost"].includes(url.hostname) || url.username !== "hostess_test")
  throw new Error("Only isolated local hostess_test PostgreSQL is permitted");
const schema = "hostess_test_" + randomUUID().replaceAll("-", "");
const pool = new pg.Pool({ connectionString: raw });
const source = new URL("../tests/.audit-dining-source.ts", import.meta.url);
const bundle = new URL("../tests/.audit-dining.node.mjs", import.meta.url);
try {
  await pool.query(`CREATE SCHEMA ${schema}`);
  url.searchParams.set("options", `-c search_path=${schema},public`);
  const env = {
    ...process.env,
    NODE_ENV: "test",
    DATABASE_URL: url.href,
    TEST_DINING_DATABASE_URL: url.href,
    HOSTESS_BFF_KEY: "b".repeat(43),
    WHATSAPP_SERVICE_KEY: "w".repeat(43),
    COMMAND_CENTER_SERVICE_KEY: "s".repeat(43),
    EXCHANGE_API_ORIGIN: "http://127.0.0.1:19092",
    COMMAND_CENTER_ORIGIN: "https://command.test",
    HOSTESS_PUBLIC_ORIGIN: "https://hostes.online",
    DINE_IN_ENABLED: "yes",
    DINE_IN_PILOT_ASSUMED_PAID: "yes",
    DINE_IN_OUTBOX_ENABLED: "no",
  };
  writeFileSync(
    source,
    readFileSync(new URL("../tests/dine-in.integration.test.ts", import.meta.url), "utf8").replace(
      '"bun:test"',
      '"./node-test-adapter"',
    ),
  );
  const build = spawnSync(
    process.env.BUN_BINARY || "bun",
    [
      "build",
      fileURLToPath(source),
      "--target=node",
      "--packages=external",
      `--outfile=${fileURLToPath(bundle)}`,
    ],
    { cwd: root, env, stdio: "inherit", timeout: 30000 },
  );
  if (build.error || build.status !== 0) throw build.error || new Error("Test build failed");
  const result = spawnSync(process.execPath, ["--test", fileURLToPath(bundle)], {
    cwd: root,
    env,
    stdio: "inherit",
    timeout: 120000,
  });
  if (result.error || result.status !== 0)
    throw result.error || new Error("Node fixture tests failed");
} finally {
  await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await pool.end();
  rmSync(source, { force: true });
  rmSync(bundle, { force: true });
}
