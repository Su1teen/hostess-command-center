import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("[migrate] DATABASE_URL is required; refusing to skip migrations.");
  process.exit(1);
}

const connectionString = new URL(databaseUrl);
const pool = new Pool({
  connectionString: databaseUrl,
  ...(connectionString.searchParams.get("sslmode") === "require"
    ? { ssl: { rejectUnauthorized: false } }
    : {}),
});

try {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS command_center_migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      )
    `);
    await client.query("SELECT pg_advisory_lock(728411000)");

    const migrationsDir = join(
      dirname(fileURLToPath(import.meta.url)),
      "../src/server/db/migrations",
    );
    const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
    const applied = await client.query("SELECT name FROM command_center_migrations");
    const appliedNames = new Set(applied.rows.map((row) => row.name));

    for (const file of files) {
      if (appliedNames.has(file)) continue;
      if (
        ["0003_guest_booking.sql", "0004_venue_inventory.sql"].includes(file) &&
        process.env.ALLOW_GUEST_BOOKING_MIGRATION !== "yes"
      ) {
        throw new Error(
          `[migrate] ${file} is pending. Set ALLOW_GUEST_BOOKING_MIGRATION=yes after schema review. Refusing to silently skip prerequisites.`,
        );
      }
      const sql = await readFile(join(migrationsDir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO command_center_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
      console.log(`[migrate] applied ${file}`);
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(728411000)");
    client.release();
  }
} catch (error) {
  const errorCode =
    error && typeof error === "object" && "code" in error ? String(error.code) : "unknown";
  const unavailableCodes = new Set([
    "ECONNREFUSED",
    "ENOTFOUND",
    "ETIMEDOUT",
    "ECONNRESET",
    "EAI_AGAIN",
    "EHOSTUNREACH",
    "28P01",
    "28000",
    "3D000",
    "57P03",
  ]);

  if (unavailableCodes.has(errorCode)) {
    console.warn(`[migrate] database unavailable (${errorCode}); migration not applied.`);
    process.exitCode = 1;
  } else {
    console.error(`[migrate] migration failed (${errorCode})`);
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
