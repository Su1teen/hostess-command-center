import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.warn("[migrate] DATABASE_URL is not set; skipping migrations.");
  process.exit(0);
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

    const migrationsDir = join(
      dirname(fileURLToPath(import.meta.url)),
      "../src/server/db/migrations",
    );
    const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
    const applied = await client.query("SELECT name FROM command_center_migrations");
    const appliedNames = new Set(applied.rows.map((row) => row.name));

    for (const file of files) {
      if (appliedNames.has(file)) continue;
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
    client.release();
  }
} catch (error) {
  if (
    error instanceof pg.errors.ConnectionError ||
    (error &&
      typeof error === "object" &&
      "code" in error &&
      ["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT"].includes(error.code))
  ) {
    console.warn("[migrate] database unavailable; continuing without migrations.");
    process.exitCode = 0;
  } else {
    console.error("[migrate] migration failed.");
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
