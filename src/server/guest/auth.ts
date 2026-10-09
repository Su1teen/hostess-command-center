import { getRequest } from "@tanstack/react-start/server";
import type { PoolClient } from "pg";
import { pool } from "../db/pool";
import { ApiError, cookie, hash, randomToken, readCookie, equalSecret } from "./security";

export type Session = {
  guest_id: string | null;
  staff_id: string | null;
  role: "viewer" | "operator" | "manager" | null;
};
export async function session(request: Request, staff = false): Promise<Session | null> {
  const raw = readCookie(request, staff ? "__Host-hostess-staff" : "__Host-hostess-guest");
  if (!raw || !/^[A-Za-z0-9_-]{43}$/.test(raw)) return null;
  const result = await pool.query<Session>(
    `SELECT guest_id,staff_id,role FROM hostess_sessions
    WHERE token_hash=$1 AND expires_at>now() AND revoked_at IS NULL`,
    [hash(raw)],
  );
  const found = result.rows[0];
  return found && (staff ? found.staff_id : found.guest_id) ? found : null;
}
export async function requireStaff(write = false, manager = false) {
  const request = getRequest();
  const found = await session(request, true);
  if (!found || (write && found.role === "viewer") || (manager && found.role !== "manager"))
    throw new ApiError(403, "STAFF_REQUIRED", "Требуется вход сотрудника с нужными правами");
  if (write) checkStaffOrigin(request);
  return found;
}
export function checkStaffOrigin(request: Request) {
  const expected = process.env.COMMAND_CENTER_ORIGIN;
  if (!expected || request.headers.get("origin") !== expected)
    throw new ApiError(403, "CSRF", "Недопустимый источник запроса");
}
export function serviceActor(request: Request): "bff" | "whatsapp" {
  const supplied = request.headers.get("x-hostess-service-key");
  if (equalSecret(supplied, process.env.HOSTESS_BFF_KEY)) return "bff";
  if (equalSecret(supplied, process.env.WHATSAPP_SERVICE_KEY)) return "whatsapp";
  throw new ApiError(401, "UNAUTHORIZED", "Доступ запрещён");
}
export async function newSession(
  client: PoolClient,
  guestId: string | null,
  staffId: string | null = null,
  role: string | null = null,
) {
  const token = randomToken();
  const ttl = staffId ? 8 * 3600 : 7 * 86400;
  await client.query(
    `INSERT INTO hostess_sessions(token_hash,guest_id,staff_id,role,expires_at)
    VALUES($1,$2,$3,$4,now()+$5*interval '1 second')`,
    [hash(token), guestId, staffId, role, ttl],
  );
  return cookie(staffId ? "__Host-hostess-staff" : "__Host-hostess-guest", token, ttl);
}
export async function actor(client: PoolClient, value: string) {
  await client.query("SELECT set_config('hostess.actor',$1,true)", [value]);
}
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
export async function rateLimit(key: string, max: number) {
  const result = await pool.query(
    `INSERT INTO hostess_rate_limits(key,bucket_at)
    VALUES($1,date_trunc('minute',now())) ON CONFLICT(key,bucket_at)
    DO UPDATE SET count=hostess_rate_limits.count+1 RETURNING count`,
    [hash(key)],
  );
  if (result.rows[0].count > max) throw new ApiError(429, "RATE_LIMITED", "Повторите через минуту");
}
