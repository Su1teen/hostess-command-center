import { randomUUID } from "node:crypto";
import { pool } from "../db/pool";
import { exchangeOrigin } from "./service";
class DeliveryError extends Error {
  constructor(
    message: string,
    public retryable = true,
  ) {
    super(message);
  }
}
export function orderEventPayload(eventId: string, payload: Record<string, unknown>) {
  const minor = BigInt(String(payload.unitPriceMinor));
  return {
    eventId,
    eventType: payload.eventType,
    orderId: payload.orderId,
    orderItemId: payload.orderItemId,
    exchangeProductId: payload.exchangeProductId,
    roundId: payload.roundId,
    quantity: payload.quantity,
    unitPrice: (minor / 100n).toString() + "." + (minor % 100n).toString().padStart(2, "0"),
    occurredAt: payload.occurredAt,
    venueCode: payload.venueCode,
  };
}
export async function drainOutbox() {
  if (process.env.DINE_IN_OUTBOX_ENABLED !== "yes") return { delivered: 0, failed: 0 };
  const key = process.env.COMMAND_CENTER_SERVICE_KEY;
  if (!key || key.length < 32) throw new Error("COMMAND_CENTER_SERVICE_KEY is required");
  const origin = exchangeOrigin(),
    lease = randomUUID();
  const rows = (
    await pool.query(
      `WITH due AS (
    SELECT id FROM integration_outbox o WHERE NOT terminal AND ((status IN('pending','failed') AND next_attempt_at<=now()) OR (status='delivering' AND locked_until<=now()))
      AND (event_type='ORDER_ACCEPTED' OR NOT EXISTS(SELECT 1 FROM integration_outbox first WHERE first.order_item_id=o.order_item_id AND first.event_type='ORDER_ACCEPTED' AND first.status<>'delivered'))
    ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 20
  ) UPDATE integration_outbox o SET status='delivering',locked_until=now()+interval '60 seconds',lease_token=$1,attempts=attempts+1
    FROM due WHERE o.id=due.id RETURNING o.*`,
      [lease],
    )
  ).rows;
  let delivered = 0,
    failed = 0;
  await Promise.all(
    rows.map(async (row) => {
      try {
        const response = await fetch(`${origin}/api/v1/command-center/order-events`, {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(8000),
          headers: {
            "content-type": "application/json",
            "x-command-center-key": key,
            "idempotency-key": row.id,
          },
          body: JSON.stringify(orderEventPayload(row.id, row.payload)),
        });
        const ack = await response.json().catch(() => null);
        if (!response.ok)
          throw new DeliveryError(
            `HTTP_${response.status}`,
            response.status === 429 || response.status >= 500 || ack?.error?.retryable === true,
          );
        if (ack?.accepted !== true || ack.eventId !== row.id)
          throw new DeliveryError("INVALID_ACK");
        await pool.query(
          "UPDATE integration_outbox SET status='delivered',delivered_at=now(),locked_until=NULL,lease_token=NULL,last_error=NULL WHERE id=$1 AND lease_token=$2",
          [row.id, lease],
        );
        delivered++;
      } catch (error) {
        const delay = Math.min(3600, 2 ** Math.min(12, row.attempts) * 5);
        await pool.query(
          `UPDATE integration_outbox SET status='failed',terminal=$5,next_attempt_at=now()+$3*interval '1 second',locked_until=NULL,lease_token=NULL,last_error=$4 WHERE id=$1 AND lease_token=$2`,
          [
            row.id,
            lease,
            delay,
            error instanceof DeliveryError ? error.message : "DELIVERY_FAILED",
            error instanceof DeliveryError && !error.retryable,
          ],
        );
        failed++;
      }
    }),
  );
  return { delivered, failed };
}
let started = false,
  running = false;
export function ensureOutboxWorker() {
  if (started || process.env.DINE_IN_OUTBOX_ENABLED !== "yes") return;
  started = true;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await drainOutbox();
    } catch {
      console.error("[dine-in] outbox worker unavailable");
    } finally {
      running = false;
    }
  };
  const interval = Math.max(
    1000,
    Math.min(60000, Number(process.env.DINE_IN_OUTBOX_INTERVAL_MS) || 5000),
  );
  setInterval(() => void tick(), interval).unref();
  void tick();
}
