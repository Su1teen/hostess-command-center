import { randomBytes } from "node:crypto";
import { z } from "zod";
import { pool } from "../db/pool";
import { transaction, rateLimit } from "../guest/auth";
import { ApiError, hash } from "../guest/security";
import { floorLock, sessionEvent } from "../floor/lifecycle";
import type { Owner } from "./service";

export async function issueAccess(venueId: string, staffId: string, raw: unknown) {
  const { sessionId } = z.object({ sessionId: z.string().uuid() }).strict().parse(raw);
  await rateLimit(`dining-code-issue:${staffId}`, 20);
  return transaction(async (client) => {
    await floorLock(client);
    const visit = (
      await client.query(
        "SELECT id FROM dining_sessions WHERE id=$1 AND venue_id=$2 AND seated_at IS NOT NULL AND closed_at IS NULL FOR UPDATE",
        [sessionId, venueId],
      )
    ).rows[0];
    if (!visit)
      throw new ApiError(409, "SESSION_CHANGED", "Сначала подтвердите посадку на карте зала");
    // One unused code per visit. Already claimed grants remain isolated per guest.
    await client.query(
      "UPDATE dining_access_grants SET revoked_at=now() WHERE session_id=$1 AND owner_hash IS NULL AND revoked_at IS NULL",
      [sessionId],
    );
    const code = randomBytes(5).toString("hex").toUpperCase();
    const grant = (
      await client.query(
        'INSERT INTO dining_access_grants(venue_id,session_id,code_hash,issued_by) VALUES($1,$2,$3,$4) RETURNING expires_at AS "expiresAt"',
        [venueId, sessionId, hash(code), staffId],
      )
    ).rows[0];
    await sessionEvent(client, venueId, sessionId, `staff:${staffId}`, "access_code_issued");
    return { code, ...grant };
  });
}

export async function claimAccess(owner: Owner, raw: unknown) {
  const { code } = z
    .object({
      code: z
        .string()
        .trim()
        .regex(/^[A-Fa-f0-9]{10}$/),
    })
    .strict()
    .parse(raw);
  await rateLimit(`dining-code-claim:${owner.hash}`, 5);
  // Deterministic per owner/code, so a lost response can be retried without issuing
  // another capability. The owner session is required on every later operation.
  const token = `visit_${hash(`access:${owner.hash}:${code.toUpperCase()}`).slice(0, 43)}`;
  return transaction(async (client) => {
    await floorLock(client);
    const grant = (
      await client.query(
        `SELECT a.id FROM dining_access_grants a JOIN dining_sessions s ON s.id=a.session_id AND s.venue_id=a.venue_id
       WHERE a.code_hash=$1 AND a.expires_at>clock_timestamp() AND a.revoked_at IS NULL
       AND s.closed_at IS NULL AND s.seated_at IS NOT NULL AND (a.owner_hash IS NULL OR a.owner_hash=$2) FOR UPDATE OF a`,
        [hash(code.toUpperCase()), owner.hash],
      )
    ).rows[0];
    if (!grant)
      throw new ApiError(
        409,
        "ACCESS_INVALID",
        "Код недействителен или истёк. Попросите новый код у сотрудника",
      );
    await client.query("UPDATE dining_access_grants SET owner_hash=$2,token_hash=$3 WHERE id=$1", [
      grant.id,
      owner.hash,
      hash(token),
    ]);
    return { accessToken: token };
  });
}

export async function accessTable(token: string, owner: Owner) {
  const row = (
    await pool.query(
      `SELECT q.token,a.id AS grant_id,a.session_id FROM dining_access_grants a
     JOIN dining_sessions s ON s.id=a.session_id AND s.venue_id=a.venue_id
     JOIN table_qr_codes q ON q.resource_id=s.resource_id AND q.venue_id=s.venue_id
     WHERE a.token_hash=$1 AND a.owner_hash=$2 AND a.expires_at>clock_timestamp()
     AND a.revoked_at IS NULL AND s.closed_at IS NULL AND s.seated_at IS NOT NULL`,
      [hash(token), owner.hash],
    )
  ).rows[0];
  if (!row)
    throw new ApiError(409, "ACCESS_INVALID", "Подтверждение стола истекло. Попросите новый код");
  return row as { token: string; grant_id: string; session_id: string };
}
