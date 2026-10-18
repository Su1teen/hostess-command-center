import type { PoolClient } from "pg";
import { z } from "zod";
import { pool } from "../db/pool";
import { actor, transaction } from "../guest/auth";
import { ApiError, hash } from "../guest/security";
import { tableUrl } from "../dine-in/qr";
import { normalizePhone } from "../dine-in/domain";
import { orderDetail } from "../dine-in/service";
import { expireUnconfirmedSessions, floorLock, sessionEvent } from "./lifecycle";
import { almatyDateKey, almatyTimeKey, addDaysToDateKey } from "../../lib/formatters/time";
import { layoutOverlaps } from "../../lib/hall/operations";
import type {
  FloorSnapshot,
  FloorSession,
  FloorReservation,
  FloorFolio,
  FloorResource,
  FloorZone,
  FloorLayoutInput,
  SeatInput,
  ReleaseInput,
  FloorReservationInput,
  FloorReservationChange,
} from "../../lib/floor-operations";

const uuid = z.string().uuid();
const key = z.string().min(12).max(200);
const instant = z.string().datetime({ offset: true });
export const floorQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  at: instant.optional(),
  endsAt: instant.optional(),
});
export const seatSchema = z
  .object({
    resourceId: uuid,
    reservationId: uuid.optional(),
    guestId: uuid.optional(),
    guests: z.number().int().min(1).max(100),
    expectedEndAt: instant,
    idempotencyKey: key,
  })
  .strict();
export const releaseSchema = z
  .object({
    reason: z.string().trim().min(3).max(500),
    version: z.number().int().positive(),
    idempotencyKey: key,
  })
  .strict();
export const reservationSchema = z
  .object({
    resourceId: uuid,
    guestName: z.string().trim().min(1).max(100),
    phone: z
      .string()
      .trim()
      .max(30)
      .regex(/^(?:\+?[\d ()-]{5,30})?$/)
      .optional(),
    guests: z.number().int().min(1).max(100),
    startsAt: instant,
    endsAt: instant,
    source: z.enum(["whatsapp", "instagram", "phone", "website", "manual", "other"]),
    comment: z.string().trim().max(2000).optional(),
    idempotencyKey: key,
  })
  .strict();
export const reservationChangeSchema = z
  .object({
    version: z.number().int().positive(),
    status: z.enum(["confirmed", "expected", "cancelled", "no_show"]).optional(),
    reason: z.string().trim().min(3).max(500),
    startsAt: instant.optional(),
    endsAt: instant.optional(),
    resourceId: uuid.optional(),
    idempotencyKey: key,
  })
  .strict()
  .refine((x) => x.status || x.startsAt || x.endsAt || x.resourceId, "Укажите изменение");
export const layoutSchema = z
  .object({
    zoneId: uuid,
    resources: z
      .array(
        z
          .object({
            resourceId: uuid,
            version: z.number().int().positive(),
            x: z.number().min(0).max(1000),
            y: z.number().min(0).max(700),
            width: z.number().min(40).max(240),
            height: z.number().min(40).max(240),
            shape: z.enum(["rectangle", "round"]),
            rotation: z.number().min(-360).max(360),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    idempotencyKey: key,
  })
  .strict();

function iso(value: string | Date | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}
export function operationalDay(date?: string, now = new Date()) {
  const current = almatyDateKey(now);
  const selected = date ?? (almatyTimeKey(now) < "04:00" ? addDaysToDateKey(current, -1) : current);
  const start = new Date(`${selected}T17:00:00+05:00`);
  if (Number.isNaN(start.getTime()) || almatyDateKey(start) !== selected)
    throw new ApiError(422, "INVALID_DATE", "Проверьте дату");
  return {
    date: selected,
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + 11 * 3600000).toISOString(),
  };
}

const reservationSelect = `SELECT b.id,b.floor_version AS version,b.guest_id AS "guestId",b.guest_name AS "guestName",NULLIF(b.phone,'') AS phone,b.guests,
 b.starts_at AS "startsAt",COALESCE(b.ends_at,b.starts_at+interval '2 hours') AS "endsAt",b.status,b.source,b.comment,
 rr.resource_id AS "resourceId",COALESCE((SELECT jsonb_agg(jsonb_build_object('productName',p.product_name,'quantity',p.quantity,'comment',p.comment)) FROM command_center_reservation_preorders p WHERE p.reservation_id=b.id),'[]') AS preorders
 FROM command_center_reservations b LEFT JOIN command_center_reservation_resources rr ON rr.reservation_id=b.id`;
function reservation(row: FloorReservation): FloorReservation {
  return { ...row, startsAt: iso(row.startsAt)!, endsAt: iso(row.endsAt)! };
}
const sessionSelect = `SELECT s.id,s.resource_id AS "resourceId",s.reservation_id AS "reservationId",s.guest_id AS "guestId",
 g.name AS "guestName",g.phone AS "guestPhone",s.guests,s.opened_at AS "openedAt",s.seated_at AS "seatedAt",s.expected_end_at AS "expectedEndAt",s.closed_at AS "closedAt",s.visit_status AS status,s.version,
 count(o.id)::int AS "orderCount",count(o.id) FILTER(WHERE o.status NOT IN('closed','cancelled'))::int AS "activeOrderCount",
 COALESCE(sum(o.payable_minor) FILTER(WHERE o.status<>'cancelled'),0)::text AS "payableMinor"
 FROM dining_sessions s LEFT JOIN hostess_guests g ON g.id=s.guest_id
 LEFT JOIN dine_in_orders o ON o.dining_session_id=s.id AND o.venue_id=s.venue_id`;
function visit(row: FloorSession): FloorSession {
  return {
    ...row,
    openedAt: iso(row.openedAt)!,
    seatedAt: iso(row.seatedAt),
    expectedEndAt: iso(row.expectedEndAt),
    closedAt: iso(row.closedAt),
  };
}
export async function getSession(
  client: Pick<PoolClient, "query">,
  venueId: string,
  id: string,
): Promise<FloorSession> {
  const row = (
    await client.query(`${sessionSelect} WHERE s.id=$1 AND s.venue_id=$2 GROUP BY s.id,g.id`, [
      id,
      venueId,
    ])
  ).rows[0];
  if (!row) throw new ApiError(404, "SESSION_NOT_FOUND", "Визит не найден");
  return visit(row);
}

async function idempotent<T>(
  client: PoolClient,
  venueId: string,
  staffId: string,
  operation: string,
  raw: { idempotencyKey: string },
  fn: () => Promise<T>,
): Promise<T> {
  const signature = hash(JSON.stringify({ staffId, operation, ...raw }));
  const prior = (
    await client.query(
      "SELECT request_hash,response FROM floor_operation_idempotency WHERE venue_id=$1 AND key=$2",
      [venueId, raw.idempotencyKey],
    )
  ).rows[0];
  if (prior) {
    if (prior.request_hash !== signature)
      throw new ApiError(
        409,
        "IDEMPOTENCY_MISMATCH",
        "Ключ операции уже использован для другого запроса",
      );
    return prior.response as T;
  }
  const result = await fn();
  await client.query(
    "INSERT INTO floor_operation_idempotency(venue_id,key,request_hash,response) VALUES($1,$2,$3,$4)",
    [venueId, raw.idempotencyKey, signature, JSON.stringify(result)],
  );
  return result;
}

async function physical(client: PoolClient, venueId: string, resourceId: string) {
  const row = (
    await client.query(
      `SELECT r.*,q.enabled,z.is_active, m.relationship,m.linked_resource_id,m.verified_at,
   CASE WHEN m.verified_at IS NOT NULL AND m.relationship IN('linked','independent') THEN COALESCE(m.linked_resource_id,r.id)
        ELSE NULL END AS booking_resource_id
   FROM venue_resources r JOIN table_qr_codes q ON q.resource_id=r.id AND q.venue_id=r.venue_id
   JOIN venue_zones z ON z.id=r.zone_id LEFT JOIN venue_resource_mappings m ON m.resource_id=r.id
   WHERE r.id=$1 AND r.venue_id=$2 FOR UPDATE OF r`,
      [resourceId, venueId],
    )
  ).rows[0];
  if (!row) throw new ApiError(404, "TABLE_NOT_FOUND", "Физический стол не найден");
  return row;
}

export async function floorSnapshot(venueId: string, raw: unknown): Promise<FloorSnapshot> {
  const input = floorQuerySchema.parse(raw);
  let now = new Date();
  let day = operationalDay(input.date, now);
  let at = input.at ? iso(input.at)! : now.toISOString();
  let intervalEndsAt = input.endsAt
    ? iso(input.endsAt)!
    : new Date(new Date(at).getTime() + 2 * 3600000).toISOString();
  if (
    new Date(intervalEndsAt) <= new Date(at) ||
    new Date(intervalEndsAt).getTime() - new Date(at).getTime() > 86400000
  )
    throw new ApiError(422, "INVALID_INTERVAL", "Выберите интервал до 24 часов");
  return transaction(async (client) => {
    await floorLock(client);
    await expireUnconfirmedSessions(client, venueId);
    now = new Date();
    day = operationalDay(input.date, now);
    if (!input.at) {
      at = now.toISOString();
      if (!input.endsAt)
        intervalEndsAt = new Date(new Date(at).getTime() + 2 * 3600000).toISOString();
    }
    const resources = await client.query(
      `SELECT r.id,r.code,r.name,r.zone_id,r.capacity,r.resource_type,r.status,r.is_reservable,
     z.code AS zone_code,z.name AS zone_name,z.is_active,q.enabled,q.token,m.relationship,m.verified_at,m.linked_resource_id,
     br.id AS booking_resource_id,br.is_reservable AS booking_reservable,br.capacity AS booking_capacity,br.status AS booking_status,
     l.layout_version,l.x,l.y,l.width,l.height,l.shape,l.rotation,
     NOT EXISTS(SELECT 1 FROM command_center_reservations b WHERE b.status NOT IN('cancelled','no_show')
       AND hostess_inventory_conflicts(COALESCE(b.table_ids,ARRAY[b.table_id]),ARRAY[r.code])
       AND b.starts_at<$4 AND COALESCE(b.ends_at,b.starts_at+interval '2 hours')>$3)
     AND NOT EXISTS(SELECT 1 FROM hostess_holds h WHERE h.consumed_at IS NULL AND h.expires_at>now()
       AND hostess_inventory_conflicts(h.table_ids,ARRAY[r.code]) AND h.starts_at<$4 AND h.ends_at>$3) AS schedule_available
     FROM table_qr_codes q JOIN venue_resources r ON r.id=q.resource_id AND r.venue_id=q.venue_id
     JOIN venue_zones z ON z.id=r.zone_id LEFT JOIN venue_resource_mappings m ON m.resource_id=r.id
     LEFT JOIN venue_resources br ON br.id=COALESCE(m.linked_resource_id,r.id)
     LEFT JOIN venue_layout l ON l.resource_id=r.id WHERE q.venue_id=$1 AND r.venue_code=$2 ORDER BY z.display_order,r.code`,
      [venueId, "xoxo", at, intervalEndsAt],
    );
    const bookings = await client.query(
      `${reservationSelect} JOIN LATERAL(
     SELECT q.resource_id FROM table_qr_codes q WHERE q.venue_id=$1
      AND COALESCE(b.table_ids,ARRAY[b.table_id]) && hostess_physical_alias_codes(q.resource_id)) p ON true
     WHERE (b.starts_at<$3 AND COALESCE(b.ends_at,b.starts_at+interval '2 hours')>$2)
        OR (COALESCE(b.ends_at,b.starts_at+interval '2 hours')>$4 AND b.starts_at<$4::timestamptz+interval '24 hours') ORDER BY b.starts_at`,
      [venueId, day.startsAt, day.endsAt, at],
    );
    // Add physical id separately because normalized reservation resource can be a linked VIP room.
    const matchedBookings = await client.query(
      `SELECT b.id,q.resource_id FROM command_center_reservations b JOIN table_qr_codes q ON q.venue_id=$1
      AND COALESCE(b.table_ids,ARRAY[b.table_id]) && hostess_physical_alias_codes(q.resource_id)
      WHERE b.starts_at<$3 AND COALESCE(b.ends_at,b.starts_at+interval '2 hours')>$2
        OR (q.venue_id=$1 AND COALESCE(b.ends_at,b.starts_at+interval '2 hours')>$4 AND b.starts_at<$4::timestamptz+interval '24 hours')`,
      [venueId, day.startsAt, day.endsAt, at],
    );
    const sessions = await client.query(
      `${sessionSelect.replace("AND o.venue_id=s.venue_id", "AND o.venue_id=s.venue_id AND o.accepted_at<=$4::timestamptz")} WHERE s.venue_id=$1 AND s.opened_at<GREATEST($3::timestamptz,$5::timestamptz)
      AND COALESCE(s.closed_at,'infinity'::timestamptz)>LEAST($2::timestamptz,$4::timestamptz) GROUP BY s.id,g.id ORDER BY s.opened_at`,
      [venueId, day.startsAt, day.endsAt, at, intervalEndsAt],
    );
    const holds = await client.query(
      `SELECT h.id,h.starts_at,h.ends_at,q.resource_id FROM hostess_holds h JOIN table_qr_codes q ON q.venue_id=$1
      AND h.table_ids && hostess_physical_alias_codes(q.resource_id) WHERE h.consumed_at IS NULL AND h.expires_at>now()
      AND h.starts_at<$3 AND h.ends_at>$2`,
      [venueId, day.startsAt, day.endsAt],
    );
    const zones = new Map<string, FloorZone>();
    const bookingById = new Map(bookings.rows.map((row) => [row.id, reservation(row)]));
    for (const row of resources.rows) {
      if (!zones.has(row.zone_id))
        zones.set(row.zone_id, {
          id: row.zone_id,
          code: row.zone_code,
          name: row.zone_name,
          resources: [],
          counts: {
            total: 0,
            seated: 0,
            available: 0,
            reservations: 0,
            activeOrders: 0,
            attention: 0,
          },
        });
      const reservations = [
        ...new Set(matchedBookings.rows.filter((b) => b.resource_id === row.id).map((b) => b.id)),
      ].flatMap((id) => (bookingById.has(id) ? [bookingById.get(id)!] : []));
      const activeReservations = reservations.filter(
        (b) => !["cancelled", "no_show"].includes(b.status),
      );
      const visits = sessions.rows.filter((s) => s.resourceId === row.id).map(visit);
      const projectedEnd = (s: FloorSession) =>
        s.closedAt ??
        (at > now.toISOString() && s.expectedEndAt && s.expectedEndAt > now.toISOString()
          ? s.expectedEndAt
          : null);
      const matchingSession =
        visits.find((s) => s.openedAt <= at && (!projectedEnd(s) || projectedEnd(s)! > at)) ?? null;
      const currentSession = matchingSession
        ? {
            ...matchingSession,
            seatedAt:
              matchingSession.seatedAt && matchingSession.seatedAt <= at
                ? matchingSession.seatedAt
                : null,
            status:
              matchingSession.seatedAt && matchingSession.seatedAt <= at
                ? ("seated" as const)
                : ("qr_activity" as const),
          }
        : null;
      const projectedSession =
        !currentSession && at > now.toISOString()
          ? (visits.find(
              (s) =>
                s.seatedAt &&
                s.seatedAt <= now.toISOString() &&
                !s.closedAt &&
                s.expectedEndAt &&
                s.expectedEndAt > now.toISOString() &&
                s.expectedEndAt <= at,
            ) ?? null)
          : null;
      const currentReservation =
        activeReservations.find((b) => b.startsAt <= at && b.endsAt > at) ?? null;
      const nextReservation = activeReservations.find((b) => b.startsAt > at) ?? null;
      const bookable =
        !!row.verified_at &&
        !!row.booking_reservable &&
        row.booking_status === "active" &&
        row.booking_capacity !== null;
      const visitConflict = visits.some(
        (s) =>
          s.seatedAt && s.seatedAt < intervalEndsAt && (!projectedEnd(s) || projectedEnd(s)! > at),
      );
      const available =
        bookable &&
        row.status === "active" &&
        row.is_active &&
        row.schedule_available &&
        !visitConflict;
      const warnings: string[] = [];
      if (projectedSession)
        warnings.push(
          "Прогноз использует ожидаемое завершение; фактическое освобождение стола ещё не подтверждено",
        );
      if (
        currentSession &&
        !currentSession.seatedAt &&
        new Date(at).getTime() - new Date(currentSession.openedAt).getTime() > 12 * 3600000
      )
        warnings.push(
          "QR-активность длится более 12 часов; проверьте незавершённые заказы и подтвердите состояние стола",
        );
      if (!row.verified_at) warnings.push("Требуется подтверждение физического соответствия");
      if (
        !row.schedule_available &&
        !activeReservations.some((b) => b.startsAt < intervalEndsAt && b.endsAt > at)
      )
        warnings.push("Интервал заблокирован удержанием или непроверенным legacy соответствием");
      if (
        currentSession?.seatedAt &&
        currentSession.expectedEndAt &&
        currentSession.expectedEndAt < at
      )
        warnings.push("Ожидаемое время визита превышено; подтвердите освобождение вручную");
      if (
        currentSession?.seatedAt &&
        nextReservation &&
        (!currentSession.expectedEndAt ||
          currentSession.expectedEndAt > nextReservation.startsAt ||
          new Date(nextReservation.startsAt).getTime() - new Date(at).getTime() < 1800000)
      )
        warnings.push("Текущий визит может пересечь следующую бронь");
      if (
        currentSession?.seatedAt &&
        currentReservation &&
        currentSession.reservationId !== currentReservation.id
      )
        warnings.push("Текущие гости пересекают бронь другой компании");
      const resource: FloorResource = {
        id: row.id,
        code: row.code,
        name: row.name,
        zoneId: row.zone_id,
        capacity: row.capacity,
        resourceType: row.resource_type,
        enabled: row.enabled,
        qrUrl: tableUrl(row.code, row.token),
        bookingResourceId: bookable ? row.booking_resource_id : null,
        bookable,
        available,
        relationship: row.relationship ?? "pending",
        warnings,
        state:
          row.status !== "active" || !row.is_active
            ? "blocked"
            : currentSession?.seatedAt
              ? warnings.some((w) => w.includes("превышено") || w.includes("пересекают"))
                ? "overdue"
                : "seated"
              : currentSession?.activeOrderCount
                ? "qr_activity"
                : currentReservation
                  ? "reserved"
                  : !bookable
                    ? "unconfigured"
                    : !row.schedule_available
                      ? "reserved"
                      : "free",
        layout: {
          version: row.layout_version ?? 1,
          x: row.x === null ? null : Number(row.x),
          y: row.y === null ? null : Number(row.y),
          width: row.width === null ? null : Number(row.width),
          height: row.height === null ? null : Number(row.height),
          shape: row.shape ?? null,
          rotation: row.rotation === null ? null : Number(row.rotation),
        },
        currentSession,
        projectedSession,
        currentReservation,
        nextReservation,
        reservations,
        sessions: visits,
        events: [
          ...reservations
            .filter((b) => b.startsAt < day.endsAt && b.endsAt > day.startsAt)
            .map((b) => ({
              id: b.id,
              source: "reservation" as const,
              startsAt: b.startsAt,
              endsAt: b.endsAt,
              label: b.guestName,
              status: b.status,
              reservationId: b.id,
            })),
          ...visits.flatMap((s) => [
            ...(s.seatedAt && s.seatedAt > s.openedAt
              ? [
                  {
                    id: `qr:${s.id}`,
                    source: "session" as const,
                    startsAt: s.openedAt,
                    endsAt: s.seatedAt,
                    label: "QR-активность до посадки",
                    status: "qr_activity",
                    sessionId: s.id,
                  },
                ]
              : []),
            {
              id: s.id,
              source: "session" as const,
              startsAt: s.seatedAt ?? s.openedAt,
              endsAt:
                s.closedAt ??
                (s.expectedEndAt && s.expectedEndAt > now.toISOString()
                  ? s.expectedEndAt
                  : now.toISOString()),
              label: s.seatedAt ? "Посадка" : "QR-активность",
              status: s.status,
              sessionId: s.id,
            },
          ]),
          ...holds.rows
            .filter((h) => h.resource_id === row.id)
            .map((h) => ({
              id: h.id,
              source: "hold" as const,
              startsAt: iso(h.starts_at)!,
              endsAt: iso(h.ends_at)!,
              label: "Временное удержание",
              status: "held",
            })),
        ],
      };
      const zone = zones.get(row.zone_id)!;
      zone.resources.push(resource);
      zone.counts.total++;
      if (currentSession?.seatedAt) zone.counts.seated++;
      if (available) zone.counts.available++;
      zone.counts.reservations += activeReservations.filter((b) => b.startsAt >= at).length;
      if (currentSession?.activeOrderCount) zone.counts.activeOrders++;
      if (warnings.length || resource.state === "blocked") zone.counts.attention++;
    }
    return {
      ...day,
      at,
      intervalEndsAt,
      now: now.toISOString(),
      timezone: "Asia/Almaty",
      zones: [...zones.values()],
    };
  });
}

export async function seatGuests(
  venueId: string,
  staffId: string,
  raw: SeatInput,
): Promise<{ session: FloorSession }> {
  const input = seatSchema.parse(raw);
  return transaction(async (client) => {
    await floorLock(client);
    return idempotent(client, venueId, staffId, "seat", input, async () => {
      const resource = await physical(client, venueId, input.resourceId);
      if (resource.status !== "active" || !resource.is_active)
        throw new ApiError(409, "TABLE_BLOCKED", "Стол вне обслуживания");
      if (resource.capacity !== null && input.guests > resource.capacity)
        throw new ApiError(422, "CAPACITY", "Количество гостей превышает вместимость");
      const expectedEnd = new Date(input.expectedEndAt),
        now = new Date();
      if (expectedEnd <= now || expectedEnd.getTime() - now.getTime() > 24 * 3600000)
        throw new ApiError(
          422,
          "INVALID_INTERVAL",
          "Ожидаемое завершение должно быть в ближайшие 24 часа",
        );
      await expireUnconfirmedSessions(client, venueId, input.resourceId);
      let linked: { id: string; guest_id: string | null; guests: number } | null = null;
      if (input.reservationId) {
        linked = (
          await client.query(
            `SELECT b.* FROM command_center_reservations b WHERE b.id=$1
          AND b.status NOT IN('cancelled','no_show') AND COALESCE(b.table_ids,ARRAY[b.table_id]) && hostess_physical_alias_codes($2)
          FOR UPDATE`,
            [input.reservationId, input.resourceId],
          )
        ).rows[0];
        if (!linked)
          throw new ApiError(
            409,
            "RESERVATION_MISMATCH",
            "Бронь недоступна или относится к другому столу",
          );
        const r = linked as typeof linked & { starts_at: Date; ends_at: Date };
        if (r.starts_at.getTime() > now.getTime() + 30 * 60000 || r.ends_at <= now)
          throw new ApiError(
            409,
            "RESERVATION_TIME",
            "Приход можно подтвердить за 30 минут до брони и во время её интервала",
          );
        if (input.guestId && linked.guest_id && input.guestId !== linked.guest_id)
          throw new ApiError(409, "GUEST_MISMATCH", "Гость не соответствует бронированию");
      }
      const guestId = linked?.guest_id ?? input.guestId ?? null;
      if (
        guestId &&
        !(
          await client.query("SELECT id FROM hostess_guests WHERE id=$1 AND merged_into IS NULL", [
            guestId,
          ])
        ).rowCount
      )
        throw new ApiError(404, "GUEST_NOT_FOUND", "Профиль гостя не найден");
      // The whole requested visit interval is protected, including legacy and VIP aliases.
      const conflict = (
        await client.query(
          `SELECT id FROM command_center_reservations b WHERE b.status NOT IN('cancelled','no_show')
        AND b.id IS DISTINCT FROM $4::uuid AND hostess_inventory_conflicts(COALESCE(b.table_ids,ARRAY[b.table_id]),ARRAY[$1::text])
        AND b.starts_at<$3 AND COALESCE(b.ends_at,b.starts_at+interval '2 hours')>$2 LIMIT 1`,
          [resource.code, now, expectedEnd, input.reservationId ?? null],
        )
      ).rowCount;
      const hold = (
        await client.query(
          `SELECT id FROM hostess_holds h WHERE consumed_at IS NULL AND expires_at>now()
        AND hostess_inventory_conflicts(table_ids,ARRAY[$1::text]) AND starts_at<$3 AND ends_at>$2 LIMIT 1`,
          [resource.code, now, expectedEnd],
        )
      ).rowCount;
      if (conflict || hold)
        throw new ApiError(
          409,
          "OCCUPANCY_CONFLICT",
          "Интервал посадки пересекает бронь или удержание. Сократите время визита или выберите другой стол",
        );
      const active = (
        await client.query(
          "SELECT * FROM dining_sessions WHERE venue_id=$1 AND resource_id=$2 AND closed_at IS NULL FOR UPDATE",
          [venueId, input.resourceId],
        )
      ).rows[0];
      if (active?.seated_at)
        throw new ApiError(
          409,
          "ALREADY_SEATED",
          "Другой сотрудник уже подтвердил посадку. Обновите карту",
        );
      let sessionId: string;
      if (active) {
        sessionId = active.id;
        await client.query(
          `UPDATE dining_sessions SET seated_at=clock_timestamp(),seated_by=$2,expected_end_at=$3,
          reservation_id=$4,guest_id=$5,guests=$6,visit_status='seated',last_activity_at=clock_timestamp(),version=version+1 WHERE id=$1`,
          [sessionId, staffId, expectedEnd, input.reservationId ?? null, guestId, input.guests],
        );
      } else
        sessionId = (
          await client.query(
            `INSERT INTO dining_sessions(venue_id,resource_id,seated_at,seated_by,expected_end_at,reservation_id,guest_id,guests,visit_status)
        VALUES($1,$2,clock_timestamp(),$3,$4,$5,$6,$7,'seated') RETURNING id`,
            [
              venueId,
              input.resourceId,
              staffId,
              expectedEnd,
              input.reservationId ?? null,
              guestId,
              input.guests,
            ],
          )
        ).rows[0].id;
      await actor(client, `staff:${staffId}`);
      if (linked)
        await client.query(
          "UPDATE command_center_reservations SET status='arrived',updated_at=now() WHERE id=$1",
          [linked.id],
        );
      await sessionEvent(client, venueId, sessionId, `staff:${staffId}`, "seated", {
        resourceId: input.resourceId,
        reservationId: input.reservationId ?? null,
        guests: input.guests,
        expectedEndAt: input.expectedEndAt,
      });
      return { session: await getSession(client, venueId, sessionId) };
    });
  });
}

export async function releaseGuests(
  venueId: string,
  staffId: string,
  sessionId: string,
  raw: ReleaseInput,
): Promise<{ session: FloorSession }> {
  const input = releaseSchema.parse(raw);
  uuid.parse(sessionId);
  return transaction(async (client) => {
    await floorLock(client);
    return idempotent(client, venueId, staffId, `release:${sessionId}`, input, async () => {
      const active = (
        await client.query("SELECT * FROM dining_sessions WHERE id=$1 AND venue_id=$2 FOR UPDATE", [
          sessionId,
          venueId,
        ])
      ).rows[0];
      if (!active) throw new ApiError(404, "SESSION_NOT_FOUND", "Визит не найден");
      if (active.version !== input.version || active.closed_at)
        throw new ApiError(409, "STALE_VISIT", "Визит изменён другим сотрудником. Обновите карту");
      await client.query(
        "UPDATE dining_sessions SET closed_at=clock_timestamp(),visit_status='released',version=version+1 WHERE id=$1",
        [sessionId],
      );
      await sessionEvent(client, venueId, sessionId, `staff:${staffId}`, "released", {
        reason: input.reason,
      });
      return { session: await getSession(client, venueId, sessionId) };
    });
  });
}

export async function createFloorReservation(
  venueId: string,
  staffId: string,
  raw: FloorReservationInput,
): Promise<{ reservation: FloorReservation }> {
  const input = reservationSchema.parse(raw);
  const normalizedPhone = input.phone?.trim() ? normalizePhone(input.phone.trim()) : null;
  const start = new Date(input.startsAt),
    end = new Date(input.endsAt);
  if (end <= start || end.getTime() - start.getTime() > 24 * 3600000)
    throw new ApiError(422, "INVALID_INTERVAL", "Выберите корректный интервал до 24 часов");
  return transaction(async (client) => {
    await floorLock(client);
    return idempotent(client, venueId, staffId, "reservation", input, async () => {
      const resource = await physical(client, venueId, input.resourceId);
      if (!resource.booking_resource_id)
        throw new ApiError(
          422,
          "INVENTORY_UNVERIFIED",
          "Сначала подтвердите физическое соответствие стола",
        );
      const target = (
        await client.query(
          `SELECT r.* FROM venue_resources r JOIN venue_zones z ON z.id=r.zone_id
        WHERE r.id=$1 AND r.venue_id=$2 AND r.is_reservable AND r.status='active' AND z.is_active FOR UPDATE OF r`,
          [resource.booking_resource_id, venueId],
        )
      ).rows[0];
      if (!target?.capacity || input.guests > target.capacity)
        throw new ApiError(422, "CAPACITY", "Место недоступно для указанного количества гостей");
      const seated = (
        await client.query(
          `SELECT s.id FROM dining_sessions s WHERE s.venue_id=$1 AND s.resource_id=$2 AND s.seated_at IS NOT NULL
        AND s.closed_at IS NULL AND s.seated_at<$4 AND CASE WHEN s.expected_end_at>clock_timestamp() THEN s.expected_end_at ELSE 'infinity'::timestamptz END>$3`,
          [venueId, input.resourceId, start, end],
        )
      ).rowCount;
      if (seated)
        throw new ApiError(
          409,
          "OCCUPANCY_CONFLICT",
          "Интервал пересекает текущую посадку. Подтвердите освобождение или выберите другое время",
        );
      let guestId = normalizedPhone
        ? (
            await client.query(
              "SELECT id FROM hostess_guests WHERE phone=$1 AND merged_into IS NULL ORDER BY provisional,created_at LIMIT 1",
              [normalizedPhone],
            )
          ).rows[0]?.id
        : null;
      if (!guestId)
        guestId = (
          await client.query(
            "INSERT INTO hostess_guests(name,phone,source) VALUES($1,$2,'staff') RETURNING id",
            [input.guestName, normalizedPhone],
          )
        ).rows[0].id;
      await actor(client, `staff:${staffId}`);
      // Canonical reservation table, normalized resource link and occupancy trigger are shared with Dayan.
      const row = (
        await client.query(
          `INSERT INTO command_center_reservations(table_id,table_label,table_ids,guest_id,guest_name,phone,guests,starts_at,ends_at,source,comment)
        VALUES($1,$2,ARRAY[$1::text],$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [
            target.code,
            target.name,
            guestId,
            input.guestName,
            normalizedPhone ?? "",
            input.guests,
            start,
            end,
            input.source,
            input.comment ?? null,
          ],
        )
      ).rows[0];
      await client.query(
        "INSERT INTO command_center_reservation_resources(reservation_id,resource_id) VALUES($1,$2)",
        [row.id, target.id],
      );
      return {
        reservation: reservation(
          (await client.query(`${reservationSelect} WHERE b.id=$1`, [row.id])).rows[0],
        ),
      };
    });
  });
}

export async function saveFloorLayout(
  venueId: string,
  staffId: string,
  raw: FloorLayoutInput,
): Promise<{ saved: true }> {
  const input = layoutSchema.parse(raw);
  if (new Set(input.resources.map((r) => r.resourceId)).size !== input.resources.length)
    throw new ApiError(422, "DUPLICATE_RESOURCE", "Стол указан дважды");
  for (const r of input.resources) {
    const radians = (r.rotation * Math.PI) / 180,
      width = Math.abs(r.width * Math.cos(radians)) + Math.abs(r.height * Math.sin(radians)),
      height = Math.abs(r.width * Math.sin(radians)) + Math.abs(r.height * Math.cos(radians));
    const x = r.x + (r.width - width) / 2,
      y = r.y + (r.height - height) / 2;
    if (x < 0 || y < 0 || x + width > 1000 || y + height > 700)
      throw new ApiError(422, "LAYOUT_BOUNDS", "Стол выходит за пределы схемы");
  }
  if (layoutOverlaps(input.resources.map((r) => ({ id: r.resourceId, layout: r }))).length)
    throw new ApiError(422, "LAYOUT_OVERLAP", "Столы на схеме пересекаются");
  return transaction(async (client) => {
    await floorLock(client);
    return idempotent(client, venueId, staffId, "layout", input, async () => {
      const rows = await client.query(
        `SELECT r.id,COALESCE(l.layout_version,1) AS version FROM venue_resources r
        JOIN table_qr_codes q ON q.resource_id=r.id AND q.venue_id=r.venue_id LEFT JOIN venue_layout l ON l.resource_id=r.id
        WHERE r.venue_id=$1 AND r.zone_id=$2 ORDER BY r.id FOR UPDATE OF r`,
        [venueId, input.zoneId],
      );
      if (
        !rows.rowCount ||
        rows.rowCount !== input.resources.length ||
        !rows.rows.every((r) => input.resources.some((x) => x.resourceId === r.id))
      )
        throw new ApiError(422, "LAYOUT_SCOPE", "Сохраните полный план выбранной зоны");
      for (const change of input.resources) {
        if (rows.rows.find((r) => r.id === change.resourceId)?.version !== change.version)
          throw new ApiError(
            409,
            "STALE_LAYOUT",
            "План изменён другим сотрудником. Загрузите последнюю сохранённую версию",
          );
        await client.query(
          `INSERT INTO venue_layout(resource_id,layout_version,x,y,width,height,shape,rotation,display_properties)
          VALUES($1,$2+1,$3,$4,$5,$6,$7,$8,'{"positionVerified":true}')
          ON CONFLICT(resource_id) DO UPDATE SET layout_version=EXCLUDED.layout_version,x=EXCLUDED.x,y=EXCLUDED.y,width=EXCLUDED.width,height=EXCLUDED.height,shape=EXCLUDED.shape,rotation=EXCLUDED.rotation,display_properties=venue_layout.display_properties||EXCLUDED.display_properties`,
          [
            change.resourceId,
            change.version,
            change.x,
            change.y,
            change.width,
            change.height,
            change.shape,
            change.rotation,
          ],
        );
      }
      await client.query(
        "INSERT INTO hostess_audit(actor,action,entity_id,details) VALUES($1,'floor_layout_saved',$2,$3)",
        [`staff:${staffId}`, input.zoneId, JSON.stringify({ resources: input.resources })],
      );
      return { saved: true as const };
    });
  });
}

export async function updateFloorReservation(
  venueId: string,
  staffId: string,
  reservationId: string,
  raw: FloorReservationChange,
): Promise<{ reservation: FloorReservation }> {
  const input = reservationChangeSchema.parse(raw);
  uuid.parse(reservationId);
  return transaction(async (client) => {
    await floorLock(client);
    return idempotent(client, venueId, staffId, `reservation:${reservationId}`, input, async () => {
      const previous = (
        await client.query(
          `SELECT b.*,rr.resource_id FROM command_center_reservations b
        LEFT JOIN command_center_reservation_resources rr ON rr.reservation_id=b.id
        WHERE b.id=$1 AND EXISTS(SELECT 1 FROM table_qr_codes q WHERE q.venue_id=$2
          AND COALESCE(b.table_ids,ARRAY[b.table_id]) && hostess_physical_alias_codes(q.resource_id)) FOR UPDATE OF b`,
          [reservationId, venueId],
        )
      ).rows[0];
      if (!previous) throw new ApiError(404, "RESERVATION_NOT_FOUND", "Бронь не найдена");
      if (previous.floor_version !== input.version)
        throw new ApiError(
          409,
          "STALE_RESERVATION",
          "Бронь изменена другим сотрудником. Обновите данные",
        );
      if (
        (input.startsAt || input.endsAt || input.resourceId) &&
        (
          await client.query(
            "SELECT id FROM dining_sessions WHERE reservation_id=$1 AND closed_at IS NULL AND seated_at IS NOT NULL",
            [reservationId],
          )
        ).rowCount
      )
        throw new ApiError(
          409,
          "GUESTS_ALREADY_SEATED",
          "Сначала завершите текущий визит перед переносом брони",
        );
      const startsAt = input.startsAt ?? iso(previous.starts_at)!,
        endsAt = input.endsAt ?? iso(previous.ends_at)!,
        status = input.status ?? previous.status;
      if (
        new Date(endsAt) <= new Date(startsAt) ||
        new Date(endsAt).getTime() - new Date(startsAt).getTime() > 86400000
      )
        throw new ApiError(422, "INVALID_INTERVAL", "Проверьте интервал брони");
      let targetId = previous.resource_id,
        tableCode = previous.table_id,
        tableName = previous.table_label;
      if (input.resourceId) {
        const resource = await physical(client, venueId, input.resourceId);
        const target = (
          await client.query(
            "SELECT * FROM venue_resources WHERE id=$1 AND venue_id=$2 AND is_reservable AND status='active'",
            [resource.booking_resource_id, venueId],
          )
        ).rows[0];
        if (!target?.capacity || previous.guests > target.capacity)
          throw new ApiError(422, "INVENTORY_UNVERIFIED", "Выбранный стол недоступен для переноса");
        targetId = target.id;
        tableCode = target.code;
        tableName = target.name;
      }
      await actor(client, `staff:${staffId}`);
      await client.query(
        "DELETE FROM command_center_reservation_resources WHERE reservation_id=$1",
        [reservationId],
      );
      await client.query(
        `UPDATE command_center_reservations SET starts_at=$2,ends_at=$3,status=$4,table_id=$5,table_ids=$6::text[],table_label=$7,updated_at=now() WHERE id=$1`,
        [
          reservationId,
          startsAt,
          endsAt,
          status,
          tableCode,
          input.resourceId ? [tableCode] : (previous.table_ids ?? [tableCode]),
          tableName,
        ],
      );
      if (targetId)
        await client.query(
          "INSERT INTO command_center_reservation_resources(reservation_id,resource_id) VALUES($1,$2)",
          [reservationId, targetId],
        );
      await client.query(
        "INSERT INTO hostess_audit(actor,action,entity_id,details) VALUES($1,'floor_reservation_changed',$2,$3)",
        [
          `staff:${staffId}`,
          reservationId,
          JSON.stringify({
            reason: input.reason,
            before: {
              startsAt: iso(previous.starts_at),
              endsAt: iso(previous.ends_at),
              status: previous.status,
              resourceId: previous.resource_id,
            },
            after: { startsAt, endsAt, status, resourceId: targetId },
          }),
        ],
      );
      return {
        reservation: reservation(
          (await client.query(`${reservationSelect} WHERE b.id=$1`, [reservationId])).rows[0],
        ),
      };
    });
  });
}

export async function sessionFolio(venueId: string, sessionId: string): Promise<FloorFolio> {
  uuid.parse(sessionId);
  const client = await pool.connect();
  try {
    // One consistent folio even when another staff member changes an order mid-request.
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const session = await getSession(client, venueId, sessionId);
    const table = (
      await client.query(
        `SELECT r.id AS "resourceId",r.code,r.name,z.name AS "zoneName" FROM venue_resources r JOIN venue_zones z ON z.id=r.zone_id WHERE r.id=$1 AND r.venue_id=$2`,
        [session.resourceId, venueId],
      )
    ).rows[0];
    const linked = session.reservationId
      ? (await client.query(`${reservationSelect} WHERE b.id=$1`, [session.reservationId])).rows[0]
      : null;
    const ids = (
      await client.query(
        "SELECT id FROM dine_in_orders WHERE venue_id=$1 AND dining_session_id=$2 ORDER BY accepted_at,id",
        [venueId, sessionId],
      )
    ).rows;
    const orders = await Promise.all(ids.map((row) => orderDetail(client, row.id, venueId)));
    const totals = {
      subtotalMinor: 0n,
      discountMinor: 0n,
      payableMinor: 0n,
      cashbackMinor: 0n,
      cancelledMinor: 0n,
      manualReceivedMinor: 0n,
      withoutManualReceiptMinor: 0n,
    };
    for (const order of orders) {
      if (order.status === "cancelled") {
        totals.cancelledMinor += BigInt(order.payableMinor);
        continue;
      }
      totals.subtotalMinor += BigInt(order.subtotalMinor);
      totals.discountMinor += BigInt(order.discountMinor);
      totals.payableMinor += BigInt(order.payableMinor);
      totals.cashbackMinor += BigInt(order.cashbackMinor);
      if (order.manualPaymentAt) totals.manualReceivedMinor += BigInt(order.payableMinor);
      else totals.withoutManualReceiptMinor += BigInt(order.payableMinor);
    }
    const events = (
      await client.query(
        `SELECT id,type,actor,details,created_at AS "createdAt" FROM dining_session_events WHERE venue_id=$1 AND session_id=$2 ORDER BY created_at,id`,
        [venueId, sessionId],
      )
    ).rows.map((row) => ({ ...row, createdAt: iso(row.createdAt)! }));
    await client.query("COMMIT");
    return {
      session,
      table,
      reservation: linked ? reservation(linked) : null,
      orders,
      totals: Object.fromEntries(
        Object.entries(totals).map(([k, v]) => [k, v.toString()]),
      ) as FloorFolio["totals"],
      events,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
