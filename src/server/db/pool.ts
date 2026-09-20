import pg from "pg";

const { Pool } = pg;

const globalForPool = globalThis as typeof globalThis & {
  __commandCenterPool?: pg.Pool;
};

const databaseUrl = process.env.DATABASE_URL;
const ssl =
  databaseUrl && new URL(databaseUrl).searchParams.get("sslmode") === "require"
    ? { rejectUnauthorized: false }
    : undefined;

export const pool =
  globalForPool.__commandCenterPool ??
  new Pool({
    connectionString: databaseUrl,
    max: 5,
    connectionTimeoutMillis: 5000,
    ...(ssl ? { ssl } : {}),
  });

if (process.env.NODE_ENV !== "production") {
  globalForPool.__commandCenterPool = pool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params);
}

export async function pingDb(): Promise<boolean> {
  if (!databaseUrl) return false;
  try {
    await Promise.race([
      pool.query("SELECT 1"),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
    ]);
    return true;
  } catch {
    return false;
  }
}
