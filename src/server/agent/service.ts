import { z } from "zod";
import type { PoolClient } from "pg";
import { pool } from "../db/pool";
import { actor, transaction } from "../guest/auth";
import { ApiError, validateBookingWindow, whatsappSubject } from "../guest/security";
import { listVenueAvailability, selectReservableResource } from "../guest/inventory";
import { mergeVerifiedStaffGuests } from "../dine-in/loyalty";
import { venue } from "../dine-in/service";
import { agentKnowledge, astanaDate } from "./knowledge";

const chatKey = z.string().min(3).max(160);
const phone = z.string().regex(/^\+7\d{10}$/);
const bookingDuration = 120;

export const inboundSchema = z
  .object({
    session: z.string().min(1).max(60),
    chatId: z.string().min(3).max(120),
    messageId: z.string().min(1).max(200),
    text: z.string().trim().min(1).max(3500),
    phone: phone.nullable().optional(),
    pushName: z.string().max(100).nullable().optional(),
  })
  .strict();

/**
 * Records one guest message (idempotent by WAHA message ID) and returns everything the
 * agent needs for its turn: whether the chat is paused, recent history and venue knowledge.
 */
export async function recordInbound(raw: unknown) {
  const input = inboundSchema.parse(raw);
  const key = `${input.session}:${input.chatId}`;
  const result = await transaction(async (client) => {
    const conversation = (
      await client.query(
        `INSERT INTO dayan_conversations(chat_key,chat_id,phone,guest_name,last_message_at)
         VALUES($1,$2,$3,$4,now())
         ON CONFLICT(chat_key) DO UPDATE SET phone=COALESCE(EXCLUDED.phone,dayan_conversations.phone),
           guest_name=COALESCE(dayan_conversations.guest_name,EXCLUDED.guest_name),
           last_message_at=now(),updated_at=now()
         RETURNING agent_paused,paused_reason,phone,guest_name`,
        [key, input.chatId, input.phone ?? null, input.pushName?.trim() || null],
      )
    ).rows[0];
    const fresh = await client.query(
      `INSERT INTO dayan_inbound(message_key,chat_key,body) VALUES($1,$2,$3)
       ON CONFLICT(message_key) DO NOTHING RETURNING message_key`,
      [`${input.session}:${input.messageId}`, key, input.text],
    );
    if (!fresh.rowCount) return { duplicate: true as const, conversation, history: [] };
    const history = (
      await client.query(
        `SELECT role,body AS text,created_at AS at FROM (
           SELECT role,body,created_at,id FROM dayan_messages WHERE chat_key=$1 ORDER BY id DESC LIMIT 24
         ) recent ORDER BY id`,
        [key],
      )
    ).rows;
    await client.query("INSERT INTO dayan_messages(chat_key,role,body) VALUES($1,'guest',$2)", [
      key,
      input.text,
    ]);
    return { duplicate: false as const, conversation, history };
  });
  const upcoming = input.phone
    ? (
        await pool.query(
          `SELECT to_char(starts_at AT TIME ZONE 'Asia/Almaty','YYYY-MM-DD HH24:MI') AS "startsAt",guests,
             table_label AS "table",status FROM command_center_reservations
           WHERE phone=$1 AND status IN ('expected','confirmed') AND starts_at>now()-interval '2 hours'
           ORDER BY starts_at LIMIT 3`,
          [input.phone],
        )
      ).rows
    : [];
  return {
    chatKey: key,
    accepted: !result.duplicate,
    duplicate: result.duplicate,
    paused: result.conversation.agent_paused === true,
    pausedReason: result.conversation.paused_reason,
    guest: {
      verifiedPhone: input.phone ?? null,
      whatsappName: result.conversation.guest_name,
      upcomingReservations: upcoming,
    },
    history: result.history,
    knowledge: result.duplicate ? null : await agentKnowledge(),
  };
}

export async function recordReply(raw: unknown) {
  const input = z
    .object({ chatKey, text: z.string().trim().min(1).max(4000) })
    .strict()
    .parse(raw);
  const saved = await pool.query(
    `INSERT INTO dayan_messages(chat_key,role,body)
     SELECT $1,'agent',$2 WHERE EXISTS(SELECT 1 FROM dayan_conversations WHERE chat_key=$1) RETURNING id`,
    [input.chatKey, input.text],
  );
  if (!saved.rowCount) throw new ApiError(404, "NOT_FOUND", "Диалог не найден");
  return { ok: true };
}

export async function setPaused(key: string, paused: boolean, reason: string | null, by: string) {
  const row = (
    await pool.query(
      `UPDATE dayan_conversations SET agent_paused=$2,paused_reason=CASE WHEN $2 THEN $3 ELSE NULL END,
         paused_at=CASE WHEN $2 THEN now() ELSE NULL END,updated_at=now()
       WHERE chat_key=$1 RETURNING chat_key AS "chatKey",chat_id AS "chatId",phone,guest_name AS "guestName",
         agent_paused AS paused,paused_reason AS "pausedReason"`,
      [chatKey.parse(key), paused, reason?.slice(0, 500) ?? null],
    )
  ).rows[0];
  if (!row) throw new ApiError(404, "NOT_FOUND", "Диалог не найден");
  await pool.query("INSERT INTO dayan_messages(chat_key,role,body) VALUES($1,'system',$2)", [
    row.chatKey,
    paused
      ? `ИИ остановлен (${by}): ${reason ?? "передано сотруднику"}`
      : `ИИ снова отвечает (${by})`,
  ]);
  return row;
}

/**
 * Turns a service-day date (the evening the visit belongs to) and a local Astana time into a
 * bookable interval: 01:30 on "Friday" is the night after Friday evening. The end is capped at
 * the 04:00 close.
 */
export function bookingInterval(date: string, time: string) {
  const [h, m] = time.split(":").map(Number);
  const afterMidnight = h * 60 + m < 17 * 60;
  const startMs = Date.parse(`${date}T${time}:00+05:00`) + (afterMidnight ? 86400_000 : 0);
  if (!Number.isFinite(startMs))
    throw new ApiError(422, "INVALID_DATE", "Некорректная дата или время");
  const serviceMinute = afterMidnight ? h * 60 + m + 1440 : h * 60 + m;
  const minutes = Math.min(bookingDuration, Math.max(30, 28 * 60 - serviceMinute));
  const interval = {
    startsAt: new Date(startMs).toISOString(),
    endsAt: new Date(startMs + minutes * 60_000).toISOString(),
  };
  validateBookingWindow(interval);
  return interval;
}

const zoneAliases: [RegExp, string[]][] = [
  [/vip|вип|кабин|комнат|прив/i, ["vip"]],
  [/ps|playstation|плей|пс|сони|приставк/i, ["ps"]],
  [/втор|second/i, ["second_hall"]],
  [/перв|основн|главн|first|экран|телевиз|трансляц/i, ["first_hall"]],
  [/бар|стойк|bar/i, ["bar"]],
];
function preferredZoneCodes(zone: string | null | undefined) {
  if (!zone?.trim()) return [];
  const direct = zone.trim().toLowerCase();
  const matched = zoneAliases
    .filter(([pattern]) => pattern.test(direct))
    .flatMap(([, codes]) => codes);
  return [...new Set([direct, ...matched])];
}

export async function checkAvailability(raw: unknown) {
  const input = z
    .object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      guests: z.coerce.number().int().min(1).max(40),
      zone: z.string().max(60).nullable().optional(),
    })
    .strict()
    .parse(raw);
  const interval = bookingInterval(input.date, input.time);
  const inventory = await listVenueAvailability(
    pool,
    interval.startsAt,
    interval.endsAt,
    input.guests,
    null,
  );
  const zones = inventory.zones
    .filter((z) => z.code !== "qr_unassigned")
    .map((z) => ({
      code: z.code,
      name: z.name,
      free: z.resources.filter((r) => r.available).length,
      total: z.resources.length,
    }))
    .filter((z) => z.total > 0);
  const wanted = preferredZoneCodes(input.zone);
  const preferred = wanted.length ? zones.filter((z) => wanted.includes(z.code)) : zones;
  return {
    ...interval,
    guests: input.guests,
    available: preferred.some((z) => z.free > 0),
    anyZoneAvailable: zones.some((z) => z.free > 0),
    zones,
  };
}

export const bookingSchema = z
  .object({
    chatKey,
    idempotencyKey: z.string().min(8).max(200),
    jid: z.string().max(100).nullable().optional(),
    contactPhone: phone.nullable().optional(),
    name: z.string().trim().min(1).max(100),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    guests: z.coerce.number().int().min(1).max(40),
    zone: z.string().trim().max(60).nullable().optional(),
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

async function ensureGuest(
  client: PoolClient,
  input: { jid?: string | null; contactPhone?: string | null; name: string },
) {
  if (input.jid) {
    const identity = whatsappSubject(input.jid);
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [identity.subject]);
    const existing = (
      await client.query(
        "SELECT guest_id FROM hostess_guest_identities WHERE provider='whatsapp' AND subject=$1",
        [identity.subject],
      )
    ).rows[0];
    if (existing) {
      await mergeVerifiedStaffGuests(client, existing.guest_id, identity.phone);
      return { guestId: existing.guest_id as string, phone: identity.phone, verified: true };
    }
    const id = (
      await client.query(
        `INSERT INTO hostess_guests(name,phone,provisional,consent_at,source) VALUES($1,$2,false,now(),'whatsapp') RETURNING id`,
        [input.name, identity.phone],
      )
    ).rows[0].id as string;
    const verified = await client.query(
      `INSERT INTO hostess_guest_identities(guest_id,provider,subject) VALUES($1,'whatsapp',$2) RETURNING id`,
      [id, identity.subject],
    );
    await client.query(
      `INSERT INTO hostess_phone_verifications(guest_id,phone,identity_id) VALUES($1,$2,$3)`,
      [id, identity.phone, verified.rows[0].id],
    );
    await client.query(
      `INSERT INTO hostess_audit(actor,action,entity_id) VALUES('whatsapp','identity_verified',$1)`,
      [id],
    );
    await mergeVerifiedStaffGuests(client, id, identity.phone);
    return { guestId: id, phone: identity.phone, verified: true };
  }
  if (!input.contactPhone)
    throw new ApiError(422, "PHONE_REQUIRED", "Нужен номер телефона гостя для брони");
  // An unverified (LID) chat: keep the guest provisional so it never merges into a verified account.
  const id = (
    await client.query(
      `INSERT INTO hostess_guests(name,phone,provisional,consent_at,source) VALUES($1,$2,true,now(),'whatsapp') RETURNING id`,
      [input.name, input.contactPhone],
    )
  ).rows[0].id as string;
  return { guestId: id, phone: input.contactPhone, verified: false };
}

type AgentBooking = {
  status: "confirmed" | "requested";
  reservationId: string | null;
  requestId: string | null;
  name: string;
  phone: string;
  phoneVerified: boolean;
  guests: number;
  date: string;
  time: string;
  startsAt: string;
  endsAt: string;
  tableName: string | null;
  zoneName: string | null;
  requestedZone: string | null;
  zoneMatched: boolean;
  notes: string | null;
  replacedPrevious: boolean;
  replayed?: boolean;
};

/**
 * Books a WhatsApp guest server-side: preferred zone first, then any suitable place. When no
 * place can be assigned automatically, a pending booking request is queued for the hostess,
 * so the guest's request always lands in Command Center.
 */
export async function createAgentBooking(raw: unknown): Promise<AgentBooking> {
  const input = bookingSchema.parse(raw);
  if (input.date < astanaDate(new Date(Date.now() - 86400_000)))
    throw new ApiError(422, "INVALID_DATE", "Дата уже прошла");
  const interval = bookingInterval(input.date, input.time);
  const previous = (
    await pool.query(
      "SELECT booking,status FROM dayan_booking_attempts WHERE idempotency_key=$1 AND status IN ('recorded','requested')",
      [input.idempotencyKey],
    )
  ).rows[0];
  if (previous) return { ...(previous.booking as AgentBooking), replayed: true };
  const xoxo = await venue(pool, "xoxo");
  const result = await transaction(async (client) => {
    const guest = await ensureGuest(client, input);
    await client.query("SELECT pg_advisory_xact_lock(728411001)");
    // A guest correcting details in the same chat replaces their booking for that evening.
    const replaced = (
      await client.query(
        `UPDATE dayan_booking_attempts SET status='replaced',updated_at=now()
         WHERE chat_key=$1 AND idempotency_key<>$2 AND status IN ('recorded','requested') AND booking->>'date'=$3
         RETURNING reservation_id,request_id`,
        [input.chatKey, input.idempotencyKey, input.date],
      )
    ).rows;
    if (replaced.length) {
      await actor(client, `whatsapp:${guest.guestId}`);
      await client.query(
        `UPDATE command_center_reservations SET status='cancelled',updated_at=now()
         WHERE id=ANY($1::uuid[]) AND status IN ('expected','confirmed')`,
        [replaced.map((r) => r.reservation_id).filter(Boolean)],
      );
      await client.query(
        `UPDATE guest_booking_requests SET status='rejected',resolved_by='dayan',resolved_at=now()
         WHERE id=ANY($1::uuid[]) AND status='pending'`,
        [replaced.map((r) => r.request_id).filter(Boolean)],
      );
    }
    const zones = (
      await client.query(
        `SELECT id,code,name,zone_type FROM venue_zones WHERE venue_code='xoxo' AND is_active
         ORDER BY display_order`,
      )
    ).rows as { id: string; code: string; name: string; zone_type: string }[];
    const wanted = preferredZoneCodes(input.zone);
    const preferred = zones.filter((z) => wanted.includes(z.code) || wanted.includes(z.zone_type));
    // Without an explicit wish, VIP rooms are offered last: they are a premium upsell.
    const attempts: (string | null)[] = preferred.length
      ? [
          ...preferred.map((z) => z.id),
          ...zones.filter((z) => !preferred.includes(z) && z.zone_type !== "vip").map((z) => z.id),
        ]
      : [...zones.filter((z) => z.zone_type !== "vip").map((z) => z.id), null];
    let resource: Awaited<ReturnType<typeof selectReservableResource>> | null = null;
    for (const zoneId of attempts) {
      await client.query("SAVEPOINT pick");
      try {
        resource = await selectReservableResource(client, {
          ...interval,
          guests: input.guests,
          zoneId: zoneId ?? undefined,
        });
        await client.query("RELEASE SAVEPOINT pick");
        break;
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT pick");
        if (!(error instanceof ApiError)) throw error;
      }
    }
    const notes = [input.notes, input.zone ? `пожелание по зоне: ${input.zone}` : null]
      .filter(Boolean)
      .join("; ");
    const base = {
      name: input.name,
      phone: guest.phone,
      phoneVerified: guest.verified,
      guests: input.guests,
      date: input.date,
      time: input.time,
      ...interval,
      requestedZone: input.zone ?? null,
      notes: input.notes ?? null,
      replacedPrevious: replaced.length > 0,
    };
    await actor(client, `whatsapp:${guest.guestId}`);
    if (resource) {
      const reservationId = (
        await client.query(
          `INSERT INTO command_center_reservations(guest_id,guest_name,phone,guests,starts_at,ends_at,table_id,
             table_label,table_ids,status,source,comment)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,ARRAY[$7::text],'expected','whatsapp',$9) RETURNING id`,
          [
            guest.guestId,
            input.name,
            guest.phone,
            input.guests,
            interval.startsAt,
            interval.endsAt,
            resource.code,
            resource.name,
            ["Даян · WhatsApp", notes].filter(Boolean).join(" · "),
          ],
        )
      ).rows[0].id as string;
      await client.query(
        "INSERT INTO command_center_reservation_resources(reservation_id,resource_id) VALUES($1,$2)",
        [reservationId, resource.id],
      );
      return {
        ...base,
        status: "confirmed" as const,
        reservationId,
        requestId: null,
        tableName: resource.name,
        zoneName: resource.zone_name,
        zoneMatched: !wanted.length || preferred.some((z) => z.id === resource!.zone_id),
      };
    }
    const requestId = (
      await client.query(
        `INSERT INTO guest_booking_requests(venue_id,guest_id,starts_at,ends_at,guests,note,idempotency_key,request_hash)
         VALUES($1,$2,$3,$4,$5,$6,$7,$7)
         ON CONFLICT(guest_id,idempotency_key) DO UPDATE SET note=EXCLUDED.note RETURNING id`,
        [
          xoxo.id,
          guest.guestId,
          interval.startsAt,
          interval.endsAt,
          Math.min(input.guests, 20),
          ["Даян · WhatsApp", input.guests > 20 ? `гостей: ${input.guests}` : null, notes]
            .filter(Boolean)
            .join(" · ")
            .slice(0, 500),
          input.idempotencyKey,
        ],
      )
    ).rows[0].id as string;
    return {
      ...base,
      status: "requested" as const,
      reservationId: null,
      requestId,
      tableName: null,
      zoneName: null,
      zoneMatched: false,
    };
  });
  await pool.query(
    `INSERT INTO dayan_booking_attempts(idempotency_key,chat_key,booking,status,reservation_id,request_id)
     VALUES($1,$2,$3,$4,$5,$6)
     ON CONFLICT(idempotency_key) DO UPDATE SET booking=EXCLUDED.booking,status=EXCLUDED.status,
       reservation_id=EXCLUDED.reservation_id,request_id=EXCLUDED.request_id,updated_at=now()`,
    [
      input.idempotencyKey,
      input.chatKey,
      JSON.stringify(result),
      result.status === "confirmed" ? "recorded" : "requested",
      result.reservationId,
      result.requestId,
    ],
  );
  await pool.query(
    "UPDATE dayan_conversations SET guest_name=$2,updated_at=now() WHERE chat_key=$1",
    [input.chatKey, input.name],
  );
  return result;
}

export async function recordFailedAttempt(
  chatKeyValue: string,
  key: string,
  booking: unknown,
  error: string,
) {
  await pool.query(
    `INSERT INTO dayan_booking_attempts(idempotency_key,chat_key,booking,status,last_error)
     VALUES($1,$2,$3,'failed',$4)
     ON CONFLICT(idempotency_key) DO UPDATE SET last_error=EXCLUDED.last_error,updated_at=now()
     WHERE dayan_booking_attempts.status NOT IN ('recorded','requested')`,
    [key, chatKeyValue, JSON.stringify(booking ?? {}), error.slice(0, 500)],
  );
}

export async function searchMenu(query: string) {
  const q = z.string().trim().max(80).parse(query);
  const words = q
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 2)
    // Crude stem so plural forms like "пиццы" or "бургеры" match "Пицца" and "Бургер".
    .map((w) => (w.length >= 5 ? w.slice(0, Math.max(4, w.length - 2)) : w))
    .slice(0, 4);
  // Match in JS: PostgreSQL lower() does not fold Cyrillic under a C/POSIX collation.
  const all = (
    await pool.query<{
      name: string;
      category: string;
      description: string;
      portion: string;
      priceKzt: string;
    }>(
      `SELECT mi.name,mi.category,mi.description,mi.portion,round(mi.price_minor::numeric/100) AS "priceKzt"
       FROM venue_menu_items mi JOIN hostess_venues v ON v.id=mi.venue_id
       WHERE v.slug='xoxo' AND mi.published AND mi.is_available
       ORDER BY mi.sort_order,mi.name`,
    )
  ).rows;
  const items = words.length
    ? all.filter((item) => {
        const text = `${item.name} ${item.category} ${item.description}`.toLowerCase();
        return words.some((w) => text.includes(w));
      })
    : [];
  const categories = [...new Set(all.map((item) => item.category))].map((category) => ({
    category,
    items: all.filter((item) => item.category === category).length,
  }));
  return { query: q, items: items.slice(0, 40), categories };
}

export async function listConversations() {
  return (
    await pool.query(
      `SELECT c.chat_key AS "chatKey",c.chat_id AS "chatId",c.phone,c.guest_name AS "guestName",
         c.agent_paused AS paused,c.paused_reason AS "pausedReason",c.paused_at AS "pausedAt",
         COALESCE(c.last_message_at,c.updated_at) AS "lastMessageAt",
         (SELECT body FROM dayan_messages m WHERE m.chat_key=c.chat_key ORDER BY id DESC LIMIT 1) AS "lastMessage",
         (SELECT count(*)::int FROM dayan_booking_attempts a WHERE a.chat_key=c.chat_key AND a.status IN ('recorded','requested')) AS bookings
       FROM dayan_conversations c ORDER BY c.agent_paused DESC,COALESCE(c.last_message_at,c.updated_at) DESC LIMIT 200`,
    )
  ).rows;
}
export async function conversationMessages(key: string) {
  return (
    await pool.query(
      `SELECT id::text,role,body AS text,created_at AS at FROM (
         SELECT * FROM dayan_messages WHERE chat_key=$1 ORDER BY id DESC LIMIT 200) m ORDER BY id`,
      [chatKey.parse(key)],
    )
  ).rows;
}
