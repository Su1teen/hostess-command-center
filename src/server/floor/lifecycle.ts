import type { PoolClient } from "pg";

/** Same serialization boundary as canonical reservations and physical mappings. */
export async function floorLock(client: PoolClient) {
  await client.query("SELECT pg_advisory_xact_lock(728411001)");
}

export async function sessionEvent(
  client: PoolClient,
  venueId: string,
  sessionId: string,
  actor: string,
  type: string,
  details: unknown = {},
) {
  await client.query(
    "INSERT INTO dining_session_events(venue_id,session_id,actor,type,details) VALUES($1,$2,$3,$4,$5)",
    [venueId, sessionId, actor, type, JSON.stringify(details)],
  );
  await client.query(
    "INSERT INTO hostess_audit(actor,action,entity_id,details) VALUES($1,$2,$3,$4)",
    [actor, `floor_${type}`, sessionId, JSON.stringify(details)],
  );
}

/** QR activity is not presence. Unseated sessions expire after 30 idle minutes
 * with terminal orders, or after 12 idle hours even with forgotten active orders.
 * Confirmed seated guests require staff release; an overdue visit remains occupied.
 * Persisted timestamps make recovery independent of process restarts and timers.
 */
export async function expireUnconfirmedSessions(
  client: PoolClient,
  venueId: string,
  resourceId?: string,
) {
  const expired = await client.query(
    `UPDATE dining_sessions s SET closed_at=clock_timestamp(),visit_status='expired',version=version+1
     WHERE venue_id=$1 AND ($2::uuid IS NULL OR resource_id=$2) AND closed_at IS NULL
       AND seated_at IS NULL AND (
         last_activity_at<clock_timestamp()-interval '12 hours'
         OR (last_activity_at<clock_timestamp()-interval '30 minutes'
           AND NOT EXISTS(SELECT 1 FROM dine_in_orders o WHERE o.dining_session_id=s.id
             AND o.status NOT IN('closed','cancelled'))))
       RETURNING id,CASE WHEN last_activity_at<clock_timestamp()-interval '12 hours'
         THEN 'stale_qr_activity' ELSE 'terminal_orders_idle' END AS reason`,
    [venueId, resourceId ?? null],
  );
  for (const row of expired.rows)
    await sessionEvent(client, venueId, row.id, "system", "qr_activity_expired", {
      idleMinutes: row.reason === "stale_qr_activity" ? 720 : 30,
      reason: row.reason,
      ordersPreserved: true,
    });
}

export async function acquireDiningSession(
  client: PoolClient,
  venueId: string,
  resourceId: string,
) {
  await floorLock(client);
  await expireUnconfirmedSessions(client, venueId, resourceId);
  const prior = (
    await client.query(
      "SELECT id FROM dining_sessions WHERE venue_id=$1 AND resource_id=$2 AND closed_at IS NULL FOR UPDATE",
      [venueId, resourceId],
    )
  ).rows[0];
  if (prior) {
    await client.query(
      "UPDATE dining_sessions SET last_activity_at=clock_timestamp(),version=version+1 WHERE id=$1",
      [prior.id],
    );
    return prior.id as string;
  }
  const created = (
    await client.query(
      "INSERT INTO dining_sessions(venue_id,resource_id) VALUES($1,$2) RETURNING id",
      [venueId, resourceId],
    )
  ).rows[0];
  await sessionEvent(client, venueId, created.id, "system", "qr_activity_started");
  return created.id as string;
}
