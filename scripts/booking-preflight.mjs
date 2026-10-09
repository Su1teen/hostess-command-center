import pg from "pg";
const required = [
  "hostess_guests",
  "hostess_sessions",
  "hostess_holds",
  "hostess_quotes",
  "hostess_rate_limits",
];
const report = { configuration: {}, missingTables: [], migrationApplied: false, ready: false };
for (const key of ["HOSTESS_PUBLIC_ORIGIN", "COMMAND_CENTER_ORIGIN", "EXCHANGE_API_ORIGIN"]) {
  try {
    const u = new URL(process.env[key] ?? "");
    report.configuration[key] =
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      u.pathname === "/" &&
      !u.search &&
      !u.hash;
  } catch {
    report.configuration[key] = false;
  }
}
for (const key of ["HOSTESS_BFF_KEY", "WHATSAPP_SERVICE_KEY", "COMMAND_CENTER_SERVICE_KEY"])
  report.configuration[key] = (process.env[key]?.length ?? 0) >= 32;
report.configuration.EXCHANGE_DATA_MODE = process.env.EXCHANGE_DATA_MODE === "api";
try {
  const users = JSON.parse(process.env.STAFF_USERS_JSON ?? "null");
  report.configuration.STAFF_USERS_JSON =
    Array.isArray(users) &&
    users.length > 0 &&
    users.every(
      (u) =>
        typeof u.id === "string" &&
        ["viewer", "operator", "manager"].includes(u.role) &&
        typeof u.passwordHash === "string" &&
        /^[a-f0-9]+:[a-f0-9]+$/i.test(u.passwordHash),
    );
} catch {
  report.configuration.STAFF_USERS_JSON = false;
}
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
  ...(process.env.DATABASE_URL &&
  new URL(process.env.DATABASE_URL).searchParams.get("sslmode") === "require"
    ? { ssl: { rejectUnauthorized: false } }
    : {}),
});
try {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_MISSING");
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    for (const table of required) {
      const r = await client.query("SELECT to_regclass($1) IS NOT NULL AS present", [
        "public." + table,
      ]);
      if (!r.rows[0].present) report.missingTables.push(table);
    }
    const history = await client.query(
      "SELECT to_regclass('public.command_center_migrations') IS NOT NULL AS present",
    );
    if (history.rows[0].present)
      report.migrationApplied = (
        await client.query(
          "SELECT EXISTS(SELECT 1 FROM command_center_migrations WHERE name='0003_guest_booking.sql') AS applied",
        )
      ).rows[0].applied;
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
  report.ready =
    report.migrationApplied &&
    report.missingTables.length === 0 &&
    Object.values(report.configuration).every(Boolean);
} catch (e) {
  report.databaseErrorCode = /^[A-Z0-9_]+$/.test(e.code ?? "") ? e.code : "CONNECTION_FAILED";
} finally {
  await pool.end();
}
console.log(JSON.stringify(report, null, 2));
if (!report.ready) process.exitCode = 1;
