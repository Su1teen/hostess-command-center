import { z } from "zod";
import { pool } from "../db/pool";
import { actor, rateLimit, transaction } from "../guest/auth";
import { ApiError, hash, validateBookingWindow } from "../guest/security";
import { selectReservableResource } from "../guest/inventory";
import { floorLock } from "../floor/lifecycle";

const fields = `b.id,b.starts_at AS "startsAt",b.ends_at AS "endsAt",b.guests,b.note,b.status,b.reservation_id AS "reservationId",b.created_at AS "createdAt"`;
export async function bookingRequests(venueId: string, guestId?: string) {
  return (
    await pool.query(
      `SELECT ${fields}${guestId ? "" : ',g.name AS "guestName",g.phone AS "guestPhone"'} FROM guest_booking_requests b JOIN hostess_guests g ON g.id=b.guest_id WHERE b.venue_id=$1 AND ($2::uuid IS NULL AND b.status='pending' OR b.guest_id=$2) ORDER BY b.created_at DESC LIMIT 100`,
      [venueId, guestId ?? null],
    )
  ).rows;
}
export async function requestBooking(venueId: string, guestId: string, raw: unknown) {
  const input = z
    .object({
      startsAt: z.string().datetime(),
      endsAt: z.string().datetime(),
      guests: z.number().int().min(1).max(20),
      note: z.string().trim().max(500).default(""),
      idempotencyKey: z.string().min(16).max(128),
    })
    .strict()
    .parse(raw);
  validateBookingWindow(input);
  await rateLimit(`booking-request:${guestId}`, 5);
  const digest = hash(JSON.stringify({ ...input, idempotencyKey: undefined }));
  return transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `request:${guestId}:${input.idempotencyKey}`,
    ]);
    const prior = (
      await client.query(
        "SELECT id,status,request_hash FROM guest_booking_requests WHERE guest_id=$1 AND idempotency_key=$2",
        [guestId, input.idempotencyKey],
      )
    ).rows[0];
    if (prior) {
      if (prior.request_hash !== digest)
        throw new ApiError(
          409,
          "IDEMPOTENCY_MISMATCH",
          "Запрос уже использован с другими параметрами",
        );
      return { id: prior.id, status: prior.status };
    }
    if (
      (
        await client.query(
          "SELECT id FROM guest_booking_requests WHERE guest_id=$1 AND status='pending' LIMIT 3",
          [guestId],
        )
      ).rowCount! >= 3
    )
      throw new ApiError(429, "RATE_LIMITED", "Дождитесь ответа на предыдущие заявки");
    return (
      await client.query(
        "INSERT INTO guest_booking_requests(venue_id,guest_id,starts_at,ends_at,guests,note,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,status",
        [
          venueId,
          guestId,
          input.startsAt,
          input.endsAt,
          input.guests,
          input.note,
          input.idempotencyKey,
          digest,
        ],
      )
    ).rows[0];
  });
}
export async function resolveBookingRequest(
  venueId: string,
  staffId: string,
  id: string,
  raw: unknown,
) {
  const input = z
    .discriminatedUnion("action", [
      z.object({ action: z.literal("reject"), reason: z.string().trim().min(3).max(500) }).strict(),
      z.object({ action: z.literal("confirm"), resourceId: z.string().uuid() }).strict(),
    ])
    .parse(raw);
  return transaction(async (client) => {
    await floorLock(client);
    const request = (
      await client.query(
        "SELECT b.*,g.name,g.phone FROM guest_booking_requests b JOIN hostess_guests g ON g.id=b.guest_id WHERE b.id=$1 AND b.venue_id=$2 FOR UPDATE OF b",
        [id, venueId],
      )
    ).rows[0];
    if (!request) throw new ApiError(404, "NOT_FOUND", "Заявка не найдена");
    if (request.status !== "pending")
      return { status: request.status, reservationId: request.reservation_id };
    let reservationId: string | null = null;
    if (input.action === "confirm") {
      const interval = {
        startsAt: request.starts_at.toISOString(),
        endsAt: request.ends_at.toISOString(),
        guests: request.guests,
        resourceId: input.resourceId,
      };
      validateBookingWindow(interval);
      const target = await selectReservableResource(client, interval);
      await actor(client, `staff:${staffId}`);
      reservationId = (
        await client.query(
          `INSERT INTO command_center_reservations(guest_id,guest_name,phone,guests,starts_at,ends_at,table_id,table_label,table_ids,status,source,comment) VALUES($1,$2,$3,$4,$5,$6,$7,$8,ARRAY[$7::text],'confirmed','website',$9) RETURNING id`,
          [
            request.guest_id,
            request.name,
            request.phone,
            request.guests,
            request.starts_at,
            request.ends_at,
            target.code,
            target.name,
            request.note,
          ],
        )
      ).rows[0].id;
      await client.query(
        "INSERT INTO command_center_reservation_resources(reservation_id,resource_id) VALUES($1,$2)",
        [reservationId, target.id],
      );
    }
    const status = reservationId ? "confirmed" : "rejected";
    await client.query(
      "UPDATE guest_booking_requests SET status=$2,reservation_id=$3,resolved_by=$4,resolved_at=now() WHERE id=$1",
      [id, status, reservationId, staffId],
    );
    await client.query(
      "INSERT INTO hostess_audit(actor,action,entity_id,details) VALUES($1,'booking_request_resolved',$2,$3)",
      [`staff:${staffId}`, id, JSON.stringify({ status, reservationId, ...input })],
    );
    return { status, reservationId };
  });
}
