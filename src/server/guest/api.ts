import { getById } from "../repositories/reservations.repository";
import { handleDiningApi, guestDiningSummary } from "../dine-in/api";
import { mergeDiningGuest, mergeVerifiedStaffGuests } from "../dine-in/loyalty";
import { z } from "zod";
import { HALL_TABLES, TV_SCREENS, FLOOR_WIDTH, FLOOR_HEIGHT } from "../../lib/hall/layout";
import { pool } from "../db/pool";
import { listVenueAvailability, selectReservableResource } from "./inventory";
import {
  actor,
  checkStaffOrigin,
  newSession,
  rateLimit,
  serviceActor,
  session,
  transaction,
} from "./auth";
import {
  ApiError,
  cookie,
  hash,
  intervalSchema,
  bookingSelectionSchema,
  inventorySelectionSchema,
  validateBookingWindow,
  randomToken,
  readCookie,
  selectionSchema,
  validateSelection,
  verifyPassword,
  whatsappSubject,
} from "./security";

const prefix = "/api/guest/v1";
const uuid = z.string().uuid();
const person = z
  .object({
    name: z.string().trim().min(1).max(100),
    phone: z.string().regex(/^\+7\d{10}$/),
    consent: z.literal(true),
  })
  .strict();
const headers = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};
const json = (data: unknown, status = 200, setCookie?: string) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, ...(setCookie ? { "set-cookie": setCookie } : {}) },
  });
async function body(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new ApiError(415, "JSON_REQUIRED", "Нужен JSON");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "INVALID_BODY", "Пустой запрос");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 32_768) {
      await reader.cancel();
      throw new ApiError(413, "TOO_LARGE", "Запрос слишком большой");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ApiError(400, "INVALID_BODY", "Некорректный JSON");
  }
}
async function guestFor(request: Request, integration: boolean, input?: { guestId?: string }) {
  if (integration) {
    const id = uuid.parse(input?.guestId);
    const sender = whatsappSubject(request.headers.get("x-whatsapp-sender-jid") ?? "");
    const result = await pool.query(
      `SELECT g.id FROM hostess_guests g WHERE g.id=$1
      AND EXISTS (SELECT 1 FROM hostess_guest_identities i WHERE i.guest_id=g.id AND i.subject=$2 AND i.provider='whatsapp')`,
      [id, sender.subject],
    );
    if (!result.rows[0])
      throw new ApiError(403, "IDENTITY_UNVERIFIED", "Сначала подтвердите identity");
    return id;
  }
  const found = await session(request);
  if (!found?.guest_id)
    throw new ApiError(
      401,
      "SESSION_REQUIRED",
      "Войдите по ссылке WhatsApp или начните новую бронь",
    );
  return found.guest_id;
}
async function availability(
  startsAt: string,
  endsAt: string,
  guestId: string | null,
  guests: number | null = null,
) {
  intervalSchema.parse({ startsAt, endsAt });
  const busy = await pool.query(
    `SELECT unnest(COALESCE(table_ids,ARRAY[table_id])) AS id
    FROM command_center_reservations WHERE status NOT IN ('cancelled','no_show')
      AND starts_at<$2 AND COALESCE(ends_at,starts_at+interval '2 hours')>$1
    UNION SELECT unnest(table_ids) FROM hostess_holds WHERE consumed_at IS NULL AND expires_at>now()
      AND guest_id IS DISTINCT FROM $3::uuid AND starts_at<$2 AND ends_at>$1`,
    [startsAt, endsAt, guestId],
  );
  const occupied = new Set(busy.rows.map((r) => r.id));
  const inventory = await listVenueAvailability(pool, startsAt, endsAt, guests, guestId);
  return {
    startsAt,
    endsAt,
    timezone: "Asia/Almaty",
    width: FLOOR_WIDTH,
    height: FLOOR_HEIGHT,
    screens: TV_SCREENS,
    tables: HALL_TABLES.map((t) => ({ ...t, available: !occupied.has(t.id) })),
    zones: inventory.zones,
    resources: inventory.resources,
  };
}
async function createResourceHold(
  client: import("pg").PoolClient,
  guestId: string,
  input: z.infer<typeof inventorySelectionSchema>,
) {
  validateBookingWindow(input);
  const resource = await selectReservableResource(client, input);
  const hold = (
    await client.query(
      `INSERT INTO hostess_holds(guest_id,table_ids,starts_at,ends_at,guests)
       VALUES($1,$2,$3,$4,$5) RETURNING *, expires_at AS "expiresAt"`,
      [guestId, [resource.code], input.startsAt, input.endsAt, input.guests],
    )
  ).rows[0];
  await client.query("INSERT INTO hostess_hold_resources(hold_id,resource_id) VALUES($1,$2)", [
    hold.id,
    resource.id,
  ]);
  return {
    ...hold,
    resourceId: resource.id,
    resourceCode: resource.code,
    resourceName: resource.name,
    zoneId: resource.zone_id,
    zoneName: resource.zone_name,
    capacity: resource.capacity,
  };
}
async function reservationList(
  guestId: string,
  reservationId: string | null = null,
  before: string | null = null,
) {
  const cursor = before?.split("|") ?? [];
  const result = await pool.query(
    `SELECT r.id,r.guest_name AS "guestName",r.guests,r.starts_at AS "startsAt",
    r.ends_at AS "endsAt",r.created_at AS "createdAt",to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "paginationTime",r.status,r.table_id AS "tableId",COALESCE(r.table_ids,ARRAY[r.table_id]) AS "tableIds",
    (SELECT vr.id FROM command_center_reservation_resources rr JOIN venue_resources vr ON vr.id=rr.resource_id WHERE rr.reservation_id=r.id) AS "resourceId",
    (SELECT vr.name FROM command_center_reservation_resources rr JOIN venue_resources vr ON vr.id=rr.resource_id WHERE rr.reservation_id=r.id) AS "resourceName",
    (SELECT z.name FROM command_center_reservation_resources rr JOIN venue_resources vr ON vr.id=rr.resource_id JOIN venue_zones z ON z.id=vr.zone_id WHERE rr.reservation_id=r.id) AS "zoneName",
    r.deposit_status AS "depositStatus",r.deposit_amount AS "depositAmount",r.iiko_sync_status AS "iikoSyncStatus",
    COALESCE((SELECT jsonb_agg(jsonb_build_object('productId',p.product_id,'productName',p.product_name,
      'quantity',p.quantity,'unitPrice',p.unit_price,'total',p.total,'status',p.preorder_status,'roundId',p.round_id))
      FROM command_center_reservation_preorders p WHERE p.reservation_id=r.id),'[]') AS preorders
    FROM command_center_reservations r WHERE r.guest_id=$1 AND ($2::uuid IS NULL OR r.id=$2)
      AND ($3::timestamptz IS NULL OR (r.created_at,r.id) < ($3::timestamptz,$4::uuid)) ORDER BY r.created_at DESC,r.id DESC LIMIT 200`,
    [guestId, reservationId, cursor[0] ?? null, cursor[1] ?? null],
  );
  return result.rows;
}

export async function handleBookingApi(request: Request): Promise<Response | null> {
  const dining = await handleDiningApi(request);
  if (dining) return dining;
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/staff/v1/")) return handleStaff(request, url);
  if (!url.pathname.startsWith(`${prefix}/`)) return null;
  try {
    const source = serviceActor(request),
      integration = source === "whatsapp";
    const path = url.pathname.slice(prefix.length),
      method = request.method;
    await rateLimit(
      `${source}:${integration ? (request.headers.get("x-whatsapp-sender-jid") ?? "integration") : (request.headers.get("x-hostess-client-id") ?? "local")}`,
      120,
    );
    const data = method === "POST" || method === "PATCH" ? await body(request) : undefined;
    if (path === "/identity" && method === "POST") {
      if (!integration) throw new ApiError(403, "FORBIDDEN", "Доступ запрещён");
      const input = z
        .object({
          name: z.string().trim().min(1).max(100),
          jid: z.string().max(100),
          consent: z.literal(true),
          claimCode: z
            .string()
            .regex(/^[A-Za-z0-9_-]{43}$/)
            .optional(),
        })
        .strict()
        .parse(data);
      const identity = whatsappSubject(input.jid);
      if (
        identity.subject !==
        whatsappSubject(request.headers.get("x-whatsapp-sender-jid") ?? "").subject
      )
        throw new ApiError(
          403,
          "IDENTITY_MISMATCH",
          "Identity не совпадает с отправителем события",
        );
      const guest = await transaction(async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [identity.subject]);
        const existing = await client.query(
          "SELECT guest_id FROM hostess_guest_identities WHERE provider='whatsapp' AND subject=$1",
          [identity.subject],
        );
        if (existing.rows[0] && !input.claimCode) {
          await mergeVerifiedStaffGuests(client, existing.rows[0].guest_id, identity.phone);
          return existing.rows[0].guest_id as string;
        }
        let provisionalId: string | undefined;
        if (input.claimCode) {
          const challenge = await client.query(
            `UPDATE hostess_ownership_challenges SET consumed_at=now()
            WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>now() RETURNING guest_id`,
            [hash(input.claimCode)],
          );
          const provisional =
            challenge.rows[0] &&
            (
              await client.query(
                "SELECT id,phone,provisional FROM hostess_guests WHERE id=$1 FOR UPDATE",
                [challenge.rows[0].guest_id],
              )
            ).rows[0];
          if (!provisional?.provisional || provisional.phone !== identity.phone)
            throw new ApiError(
              403,
              "OWNERSHIP_UNVERIFIED",
              "Подтверждение недоступно. Начните заново с сайта",
            );
          provisionalId = provisional.id;
        }
        if (existing.rows[0]) {
          const canonical = existing.rows[0].guest_id;
          if ((await client.query("SELECT to_regclass('dine_in_orders') AS name")).rows[0].name)
            await mergeDiningGuest(client, provisionalId!, canonical);
          await actor(client, `whatsapp:${canonical}`);
          await client.query(
            "UPDATE command_center_reservations SET guest_id=$1,updated_at=now() WHERE guest_id=$2",
            [canonical, provisionalId],
          );
          await client.query("UPDATE hostess_quotes SET guest_id=$1 WHERE guest_id=$2", [
            canonical,
            provisionalId,
          ]);
          await client.query("UPDATE hostess_holds SET guest_id=$1 WHERE guest_id=$2", [
            canonical,
            provisionalId,
          ]);
          await client.query("UPDATE hostess_sessions SET revoked_at=now() WHERE guest_id=$1", [
            provisionalId,
          ]);
          await client.query(
            `INSERT INTO hostess_audit(actor,action,entity_id,details) VALUES('whatsapp','provisional_merged',$1,jsonb_build_object('provisionalId',$2::text))`,
            [canonical, provisionalId],
          );
          await mergeVerifiedStaffGuests(client, canonical, identity.phone);
          return canonical as string;
        }
        if (provisionalId) {
          await client.query("UPDATE hostess_guests SET provisional=false WHERE id=$1", [
            provisionalId,
          ]);
          const identityRow = await client.query(
            `INSERT INTO hostess_guest_identities(guest_id,provider,subject) VALUES($1,'whatsapp',$2) RETURNING id`,
            [provisionalId, identity.subject],
          );
          await client.query(
            `INSERT INTO hostess_phone_verifications(guest_id,phone,identity_id) VALUES($1,$2,$3)`,
            [provisionalId, identity.phone, identityRow.rows[0].id],
          );
          await mergeVerifiedStaffGuests(client, provisionalId, identity.phone);
          return provisionalId;
        }
        const created = await client.query(
          `INSERT INTO hostess_guests(name,phone,provisional,consent_at) VALUES($1,$2,false,now()) RETURNING id`,
          [input.name, identity.phone],
        );
        const id = created.rows[0].id;
        if (process.env.DINE_IN_ENABLED === "yes")
          await client.query("UPDATE hostess_guests SET source='whatsapp' WHERE id=$1", [id]);
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
        return id as string;
      });
      return json({ guestId: guest });
    }
    if (path === "/bootstrap" && method === "POST" && !integration) {
      const input = person.parse(data);
      await rateLimit(`bootstrap:${request.headers.get("x-hostess-client-id")}`, 5);
      const existing = await session(request);
      if (existing?.guest_id) return json({ guestId: existing.guest_id });
      const result = await transaction(async (client) => {
        const created = await client.query(
          "INSERT INTO hostess_guests(name,phone,consent_at) VALUES($1,$2,now()) RETURNING id",
          [input.name, input.phone],
        );
        return {
          guestId: created.rows[0].id,
          setCookie: await newSession(client, created.rows[0].id),
        };
      });
      return json({ guestId: result.guestId }, 201, result.setCookie);
    }
    if (path === "/claims" && method === "POST" && !integration) {
      await rateLimit(`claim:${request.headers.get("x-hostess-client-id")}`, 10);
      const input = z
        .object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
        .strict()
        .parse(data);
      const result = await transaction(async (client) => {
        const claimed = await client.query(
          `UPDATE hostess_magic_links SET consumed_at=now()
          WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>now() RETURNING guest_id,reservation_id`,
          [hash(input.token)],
        );
        if (!claimed.rows[0])
          throw new ApiError(
            410,
            "LINK_UNAVAILABLE",
            "Ссылка недоступна. Запросите новую в WhatsApp",
          );
        // Rotate and revoke any existing browser session to prevent fixation.
        const previous = readCookie(request, "__Host-hostess-guest");
        if (previous)
          await client.query("UPDATE hostess_sessions SET revoked_at=now() WHERE token_hash=$1", [
            hash(previous),
          ]);
        await client.query(
          `INSERT INTO hostess_audit(actor,action,entity_id) VALUES($1,'link_redeemed',$2)`,
          [`guest:${claimed.rows[0].guest_id}`, claimed.rows[0].guest_id],
        );
        return {
          setCookie: await newSession(client, claimed.rows[0].guest_id),
          reservationId: claimed.rows[0].reservation_id,
        };
      });
      return json(
        { redirect: "/guest", reservationId: result.reservationId },
        200,
        result.setCookie,
      );
    }
    if (path === "/availability" && method === "GET") {
      const input = intervalSchema.parse({
        startsAt: url.searchParams.get("startsAt"),
        endsAt: url.searchParams.get("endsAt"),
      });
      const guestsParam = url.searchParams.get("guests");
      const guests =
        guestsParam === null ? null : z.coerce.number().int().min(1).max(20).parse(guestsParam);
      const result = await availability(
        input.startsAt,
        input.endsAt,
        (await session(request))?.guest_id ?? null,
        guests,
      );
      const requestedZone = url.searchParams.get("zoneId");
      const requestedResource = url.searchParams.get("resourceId");
      if (requestedZone) uuid.parse(requestedZone);
      if (requestedResource) uuid.parse(requestedResource);
      if (requestedZone || requestedResource) {
        result.resources = result.resources.filter(
          (r) =>
            (requestedZone ? r.zoneId === requestedZone : true) &&
            (requestedResource ? r.id === requestedResource : true),
        );
        result.zones = result.zones
          .map((zone) => ({
            ...zone,
            resources: zone.resources.filter(
              (r) => !requestedResource || r.id === requestedResource,
            ),
          }))
          .filter(
            (zone) =>
              (!requestedZone || zone.id === requestedZone) &&
              (!requestedResource || zone.resources.length > 0),
          );
      }
      return json(result);
    }
    const guestId = await guestFor(
      request,
      integration,
      data ?? { guestId: url.searchParams.get("guestId") ?? undefined },
    );
    if (path === "/ownership" && method === "POST" && !integration) {
      await rateLimit(`ownership:${guestId}`, 3);
      const token = randomToken();
      await pool.query(
        `INSERT INTO hostess_ownership_challenges(token_hash,guest_id,expires_at) VALUES($1,$2,now()+interval '12 minutes')`,
        [hash(token), guestId],
      );
      return json({ claimCode: token, expiresIn: 720 });
    }
    if (path === "/profile" && method === "GET") {
      const guest = await pool.query("SELECT id,name,provisional FROM hostess_guests WHERE id=$1", [
        guestId,
      ]);
      const before = url.searchParams.get("before");
      if (before) {
        const [at, id] = before.split("|");
        z.string().datetime().parse(at);
        uuid.parse(id);
      }
      const reservations = await reservationList(guestId, null, before);
      return json({
        guest: guest.rows[0],
        reservations,
        nextCursor:
          reservations.length === 200
            ? `${reservations[199].paginationTime}|${reservations[199].id}`
            : null,
      });
    }
    if (path === "/logout" && method === "POST" && !integration) {
      const token = readCookie(request, "__Host-hostess-guest");
      await pool.query("UPDATE hostess_sessions SET revoked_at=now() WHERE token_hash=$1", [
        hash(token ?? ""),
      ]);
      return json({ ok: true }, 200, cookie("__Host-hostess-guest", "", 0));
    }
    if (path === "/links" && method === "POST" && integration) {
      const input = z
        .object({ guestId: uuid, reservationId: uuid.optional() })
        .strict()
        .parse(data);
      await rateLimit(`link:${guestId}`, 3);
      const origin = process.env.HOSTESS_PUBLIC_ORIGIN;
      if (!origin || new URL(origin).protocol !== "https:")
        throw new ApiError(503, "CONFIG_REQUIRED", "Домен Hostess не настроен");
      if (input.reservationId) {
        const own = await pool.query(
          "SELECT id FROM command_center_reservations WHERE id=$1 AND guest_id=$2",
          [input.reservationId, guestId],
        );
        if (!own.rows[0]) throw new ApiError(404, "NOT_FOUND", "Бронь недоступна");
      }
      const token = randomToken();
      await pool.query(
        `INSERT INTO hostess_magic_links(token_hash,guest_id,reservation_id,expires_at)
        VALUES($1,$2,$3,now()+interval '12 minutes')`,
        [hash(token), guestId, input.reservationId ?? null],
      );
      // Fragment is never sent to servers, referrers, or preview crawlers.
      return json({
        url: `${new URL(origin).origin}/auth/claim#token=${token}`,
        expiresIn: 720,
        deliverTo: whatsappSubject(request.headers.get("x-whatsapp-sender-jid") ?? "").subject,
      });
    }
    if (path === "/holds" && method === "POST") {
      const input = z
        .union([
          selectionSchema
            .extend({
              guestId: uuid.optional(),
              idempotencyKey: z.string().min(16).max(128).optional(),
            })
            .strict(),
          inventorySelectionSchema
            .extend({
              guestId: uuid.optional(),
              idempotencyKey: z.string().min(16).max(128).optional(),
            })
            .strict(),
        ])
        .parse(data);
      if ("tableIds" in input) validateSelection(input, HALL_TABLES);
      else validateBookingWindow(input);
      const hold = await transaction(async (client) => {
        const requestHash = hash(
          JSON.stringify({
            startsAt: input.startsAt,
            endsAt: input.endsAt,
            guests: input.guests,
            ...("tableIds" in input
              ? { tableIds: input.tableIds }
              : { resourceId: input.resourceId ?? null, zoneId: input.zoneId ?? null }),
          }),
        );
        if (input.idempotencyKey) {
          await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
            `hold:${guestId}:${input.idempotencyKey}`,
          ]);
          const previous = (
            await client.query<{ request_hash: string; hold_id: string }>(
              "SELECT request_hash,hold_id FROM hostess_hold_idempotency WHERE guest_id=$1 AND idempotency_key=$2 FOR UPDATE",
              [guestId, input.idempotencyKey],
            )
          ).rows[0];
          if (previous) {
            if (previous.request_hash !== requestHash)
              throw new ApiError(
                409,
                "IDEMPOTENCY_MISMATCH",
                "Ключ уже использован для другого запроса",
              );
            const existing = (
              await client.query(
                `SELECT h.id,h.expires_at AS "expiresAt",vr.id AS "resourceId",vr.code AS "resourceCode",
                   vr.name AS "resourceName",vr.capacity,z.id AS "zoneId",z.name AS "zoneName"
                 FROM hostess_holds h LEFT JOIN hostess_hold_resources hr ON hr.hold_id=h.id
                 LEFT JOIN venue_resources vr ON vr.id=hr.resource_id
                 LEFT JOIN venue_zones z ON z.id=vr.zone_id
                 WHERE h.id=$1 AND h.guest_id=$2 AND h.expires_at>now() AND h.consumed_at IS NULL`,
                [previous.hold_id, guestId],
              )
            ).rows[0];
            if (!existing)
              throw new ApiError(409, "HOLD_EXPIRED", "Удержание истекло. Создайте новое");
            return existing;
          }
        }
        await client.query("SELECT pg_advisory_xact_lock(728411001)");
        await client.query(
          "UPDATE hostess_holds SET consumed_at=now() WHERE guest_id=$1 AND consumed_at IS NULL",
          [guestId],
        );
        const created = !("tableIds" in input)
          ? await createResourceHold(client, guestId, input)
          : (
              await client.query(
                `INSERT INTO hostess_holds(guest_id,table_ids,starts_at,ends_at,guests)
          VALUES($1,$2,$3,$4,$5) RETURNING id,expires_at AS "expiresAt"`,
                [guestId, input.tableIds, input.startsAt, input.endsAt, input.guests],
              )
            ).rows[0];
        if (input.idempotencyKey)
          await client.query(
            `INSERT INTO hostess_hold_idempotency(guest_id,idempotency_key,request_hash,hold_id)
             VALUES($1,$2,$3,$4)`,
            [guestId, input.idempotencyKey, requestHash, created.id],
          );
        return created;
      });
      return json(hold, 201);
    }
    if (path === "/quotes" && method === "POST") {
      const input = z
        .object({
          guestId: uuid.optional(),
          items: z
            .array(
              z.object({ productId: uuid, quantity: z.number().int().min(1).max(20) }).strict(),
            )
            .min(1)
            .max(30),
        })
        .strict()
        .parse(data);
      if (new Set(input.items.map((i) => i.productId)).size !== input.items.length)
        throw new ApiError(422, "DUPLICATE_PRODUCT", "Повторяющиеся позиции");
      const origin = process.env.EXCHANGE_API_ORIGIN;
      if (!origin) throw new ApiError(503, "EXCHANGE_UNAVAILABLE", "Биржа недоступна");
      const response = await fetch(`${origin.replace(/\/$/, "")}/api/v1/public/snapshot`, {
        redirect: "error",
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new ApiError(503, "EXCHANGE_UNAVAILABLE", "Биржа недоступна");
      const snapshot = z
        .object({
          generatedAt: z.string().datetime(),
          status: z.literal("ok"),
          currentRound: z.object({ id: z.string(), endsAt: z.string().datetime() }),
          products: z.array(
            z.object({
              id: uuid,
              name: z.string(),
              price: z.number().finite().nonnegative(),
              currency: z.literal("KZT"),
              isAvailable: z.boolean(),
            }),
          ),
        })
        .parse(await response.json());
      const ttl = Math.min(Date.now() + 120_000, Date.parse(snapshot.currentRound.endsAt));
      if (
        ttl <= Date.now() + 5000 ||
        Math.abs(Date.now() - Date.parse(snapshot.generatedAt)) > 60_000
      )
        throw new ApiError(409, "REQUOTE", "Цены обновляются. Повторите запрос");
      const lines = input.items.map((item) => {
        const p = snapshot.products.find((p) => p.id === item.productId && p.isAvailable);
        if (!p) throw new ApiError(409, "PRODUCT_UNAVAILABLE", "Позиция недоступна");
        return {
          productId: p.id,
          productName: p.name,
          quantity: item.quantity,
          unitPrice: Math.round(p.price * 100) / 100,
          total: (Math.round(p.price * 100) * item.quantity) / 100,
        };
      });
      const quote = await pool.query(
        `INSERT INTO hostess_quotes(guest_id,round_id,lines,expires_at)
        VALUES($1,$2,$3,$4) RETURNING id,expires_at AS "expiresAt"`,
        [guestId, snapshot.currentRound.id, JSON.stringify(lines), new Date(ttl)],
      );
      return json(
        {
          ...quote.rows[0],
          roundId: snapshot.currentRound.id,
          lines,
          paymentStatus: "unpaid",
          policy: "pending_preorder_snapshot",
        },
        201,
      );
    }
    if (path === "/reservations" && method === "POST") {
      const input = z
        .object({
          guestId: uuid.optional(),
          holdId: uuid.optional(),
          selection: bookingSelectionSchema.optional(),
          quoteId: uuid.optional(),
          idempotencyKey: z.string().min(16).max(128),
        })
        .strict()
        .refine((v) => Boolean(v.holdId) !== Boolean(v.selection), "Нужен holdId или selection")
        .parse(data);

      const reservationId = await transaction(async (client) => {
        const scope = `${source}:${guestId}`,
          digest = hash(
            JSON.stringify({
              holdId: input.holdId ?? null,
              selection: input.selection ?? null,
              quoteId: input.quoteId ?? null,
            }),
          );
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `${scope}:${input.idempotencyKey}`,
        ]);
        const previous = await client.query(
          "SELECT * FROM hostess_idempotency WHERE scope=$1 AND key=$2",
          [scope, input.idempotencyKey],
        );
        if (previous.rows[0]) {
          if (previous.rows[0].request_hash !== digest)
            throw new ApiError(
              409,
              "IDEMPOTENCY_MISMATCH",
              "Ключ уже использован для другого запроса",
            );
          return previous.rows[0].reservation_id as string;
        }
        await client.query("SELECT pg_advisory_xact_lock(728411001)");
        let hold;
        if (input.selection) {
          await client.query(
            "UPDATE hostess_holds SET consumed_at=now() WHERE guest_id=$1 AND consumed_at IS NULL",
            [guestId],
          );
          if ("tableIds" in input.selection) {
            validateSelection(input.selection, HALL_TABLES);
            const selection = input.selection;
            hold = (
              await client.query(
                "INSERT INTO hostess_holds(guest_id,table_ids,guests,starts_at,ends_at) VALUES($1,$2,$3,$4,$5) RETURNING *",
                [
                  guestId,
                  selection.tableIds,
                  selection.guests,
                  selection.startsAt,
                  selection.endsAt,
                ],
              )
            ).rows[0];
          } else {
            hold = await createResourceHold(client, guestId, input.selection);
          }
        } else
          hold = (
            await client.query(
              "SELECT * FROM hostess_holds WHERE id=$1 AND guest_id=$2 AND expires_at>now() AND consumed_at IS NULL FOR UPDATE",
              [input.holdId, guestId],
            )
          ).rows[0];
        if (!hold)
          throw new ApiError(409, "HOLD_EXPIRED", "Выберите стол заново: удержание истекло");
        const guest = (await client.query("SELECT * FROM hostess_guests WHERE id=$1", [guestId]))
          .rows[0];
        let quote;
        if (input.quoteId) {
          quote = (
            await client.query(
              "SELECT * FROM hostess_quotes WHERE id=$1 AND guest_id=$2 AND expires_at>now() AND consumed_at IS NULL FOR UPDATE",
              [input.quoteId, guestId],
            )
          ).rows[0];
          if (!quote)
            throw new ApiError(409, "QUOTE_EXPIRED", "Обновите и подтвердите цену предзаказа");
        }
        await actor(client, `${source}:${guestId}`);
        const r = await client.query(
          `INSERT INTO command_center_reservations
          (guest_id,guest_name,phone,guests,starts_at,ends_at,table_id,table_label,table_ids,hold_id,status,source)
          VALUES($1,$2,$3,$4,$5,$6,$7,
            COALESCE((SELECT vr.name FROM hostess_hold_resources hr JOIN venue_resources vr ON vr.id=hr.resource_id WHERE hr.hold_id=$10),$8),
            $9,$10,'expected',$11) RETURNING id`,
          [
            guestId,
            guest.name,
            guest.phone,
            hold.guests,
            hold.starts_at,
            hold.ends_at,
            hold.table_ids[0],
            hold.table_ids.join(" + "),
            hold.table_ids,
            hold.id,
            integration ? "whatsapp" : "website",
          ],
        );
        const id = r.rows[0].id;
        await client.query(
          `INSERT INTO command_center_reservation_resources(reservation_id,resource_id)
           SELECT $1,resource_id FROM hostess_hold_resources WHERE hold_id=$2
           ON CONFLICT (reservation_id) DO UPDATE SET resource_id=EXCLUDED.resource_id`,
          [id, hold.id],
        );
        if (quote) {
          for (const line of quote.lines)
            await client.query(
              `INSERT INTO command_center_reservation_preorders
            (reservation_id,product_id,product_name,quantity,unit_price,total,quote_id,round_id)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
              [
                id,
                line.productId,
                line.productName,
                line.quantity,
                line.unitPrice,
                line.total,
                quote.id,
                quote.round_id,
              ],
            );
          await client.query("UPDATE hostess_quotes SET consumed_at=now() WHERE id=$1", [quote.id]);
        }
        await client.query("UPDATE hostess_holds SET consumed_at=now() WHERE id=$1", [hold.id]);
        await client.query(
          "INSERT INTO hostess_idempotency(scope,key,request_hash,reservation_id) VALUES($1,$2,$3,$4)",
          [scope, input.idempotencyKey, digest, id],
        );
        return id as string;
      });
      return json({ reservation: (await reservationList(guestId, reservationId))[0] }, 201);
    }
    const match = /^\/reservations\/([a-f0-9-]{36})$/.exec(path);
    if (match && method === "PATCH") {
      const input = z
        .object({
          guestId: uuid.optional(),
          action: z.enum(["cancel", "reschedule"]),
          holdId: uuid.optional(),
        })
        .strict()
        .parse(data);
      await transaction(async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(728411001)");
        const r = (
          await client.query(
            "SELECT * FROM command_center_reservations WHERE id=$1 AND guest_id=$2 FOR UPDATE",
            [match[1], guestId],
          )
        ).rows[0];
        if (!r) throw new ApiError(404, "NOT_FOUND", "Бронь недоступна");
        if (input.action === "cancel" && r.status === "cancelled") return;
        if (
          input.action === "reschedule" &&
          r.hold_id === input.holdId &&
          ["expected", "confirmed"].includes(r.status)
        )
          return;
        if (
          !["expected", "confirmed"].includes(r.status) ||
          new Date(r.starts_at).getTime() < Date.now() + 3600_000
        )
          throw new ApiError(409, "STAFF_REQUIRED", "Для изменения свяжитесь с заведением");
        await actor(client, `guest:${guestId}`);
        if (input.action === "cancel")
          await client.query(
            "UPDATE command_center_reservations SET status='cancelled',updated_at=now() WHERE id=$1",
            [r.id],
          );
        else {
          const h = (
            await client.query(
              "SELECT * FROM hostess_holds WHERE id=$1 AND guest_id=$2 AND expires_at>now() AND consumed_at IS NULL FOR UPDATE",
              [uuid.parse(input.holdId), guestId],
            )
          ).rows[0];
          if (!h) throw new ApiError(409, "HOLD_EXPIRED", "Выберите стол заново");
          // Explicit table_id reset then table_ids respects the compatibility trigger.
          await client.query(
            "UPDATE command_center_reservations SET status='cancelled' WHERE id=$1",
            [r.id],
          );
          await client.query(
            `UPDATE command_center_reservations SET table_id=$2,
            table_label=COALESCE((SELECT vr.name FROM hostess_hold_resources hr JOIN venue_resources vr ON vr.id=hr.resource_id WHERE hr.hold_id=$7),$3),table_ids=$4,
            starts_at=$5,ends_at=$6,hold_id=$7,guests=$8,status='expected',updated_at=now() WHERE id=$1`,
            [
              r.id,
              h.table_ids[0],
              h.table_ids.join(" + "),
              h.table_ids,
              h.starts_at,
              h.ends_at,
              h.id,
              h.guests,
            ],
          );
          await client.query(
            "DELETE FROM command_center_reservation_resources WHERE reservation_id=$1",
            [r.id],
          );
          await client.query(
            `INSERT INTO command_center_reservation_resources(reservation_id,resource_id)
             SELECT $1,resource_id FROM hostess_hold_resources WHERE hold_id=$2`,
            [r.id, h.id],
          );
          await client.query("UPDATE hostess_holds SET consumed_at=now() WHERE id=$1", [h.id]);
        }
      });
      return json({ reservation: (await reservationList(guestId, match[1]))[0] });
    }
    throw new ApiError(404, "NOT_FOUND", "Операция недоступна");
  } catch (e) {
    return apiFailure(e);
  }
}
function apiFailure(e: unknown) {
  if (e instanceof ApiError) return json({ error: { code: e.code, message: e.message } }, e.status);
  if (e instanceof z.ZodError)
    return json({ error: { code: "INVALID_INPUT", message: "Проверьте поля запроса" } }, 422);
  if ((e as { code?: string })?.code === "23P01")
    return json({ error: { code: "CONFLICT", message: "Стол уже занят. Выберите другой" } }, 409);
  if ((e as { code?: string })?.code === "23514")
    return json(
      { error: { code: "INVALID_SELECTION", message: "Проверьте выбранное место и число гостей" } },
      422,
    );
  // Do not log raw requests, tokens, PII or driver errors/connection URLs.
  console.error("[booking] request failed", e instanceof Error ? e.name : "UnknownError");
  return json(
    {
      error: { code: "UNAVAILABLE", message: "Сервис временно недоступен. Бронь не подтверждена" },
    },
    503,
  );
}
async function handleStaff(request: Request, url: URL) {
  try {
    const path = url.pathname.slice("/api/staff/v1".length);
    if (path === "/login" && request.method === "POST") {
      checkStaffOrigin(request);
      const input = z
        .object({ username: z.string().min(1).max(100), password: z.string().min(1).max(200) })
        .strict()
        .parse(await body(request));
      await rateLimit("staff-login-global", 30);
      await rateLimit(`staff-login:${input.username}`, 5);
      const users = z
        .array(
          z.object({
            id: z.string(),
            role: z.enum(["viewer", "operator", "manager"]),
            passwordHash: z.string(),
          }),
        )
        .parse(JSON.parse(process.env.STAFF_USERS_JSON ?? "[]"));
      const user = users.find((u) => u.id === input.username);
      const valid = verifyPassword(
        input.password,
        user?.passwordHash ?? `dummy:${"0".repeat(128)}`,
      );
      if (!user || !valid) throw new ApiError(401, "UNAUTHORIZED", "Неверные данные входа");
      return json(
        { staff: { id: user.id, role: user.role } },
        200,
        await transaction((client) => newSession(client, null, user.id, user.role)),
      );
    }
    const found = await session(request, true);
    if (!found) throw new ApiError(401, "UNAUTHORIZED", "Требуется вход сотрудника");
    if (path === "/me" && request.method === "GET")
      return json({ staff: { id: found.staff_id, role: found.role } });
    if (path === "/logout" && request.method === "POST") {
      checkStaffOrigin(request);
      await pool.query("UPDATE hostess_sessions SET revoked_at=now() WHERE token_hash=$1", [
        hash(readCookie(request, "__Host-hostess-staff") ?? ""),
      ]);
      return json({ ok: true }, 200, cookie("__Host-hostess-staff", "", 0));
    }
    if (path === "/guests" && request.method === "GET") {
      if (process.env.DINE_IN_ENABLED === "yes") {
        const search = z
          .string()
          .max(100)
          .parse(url.searchParams.get("q") ?? "");
        const guests = await pool.query(
          `SELECT g.id,g.name,g.phone,g.provisional,g.source,
          (SELECT count(*)::int FROM command_center_reservations r WHERE r.guest_id=g.id) AS reservations,
          (SELECT count(*)::int FROM command_center_reservations r WHERE r.guest_id=g.id AND r.status='arrived') AS visits,
          (SELECT count(*)::int FROM dine_in_orders o WHERE o.guest_id=g.id) AS orders
          FROM hostess_guests g WHERE g.merged_into IS NULL AND ($1='' OR concat_ws(' ',g.name,g.phone) ILIKE '%'||$1||'%')
          ORDER BY g.created_at DESC LIMIT 1000`,
          [search],
        );
        return json({ guests: guests.rows });
      }
      const guests =
        await pool.query(`SELECT g.id,g.name,g.phone,g.provisional,count(r.id)::int AS reservations,
        count(r.id) FILTER (WHERE r.status='arrived')::int AS visits FROM hostess_guests g
        LEFT JOIN command_center_reservations r ON r.guest_id=g.id GROUP BY g.id ORDER BY g.created_at DESC LIMIT 1000`);
      return json({ guests: guests.rows });
    }
    const guestMatch = /^\/guests\/([a-f0-9-]{36})$/.exec(path);
    if (guestMatch && request.method === "GET")
      return json({
        reservations: await reservationList(guestMatch[1]),
        ...(process.env.DINE_IN_ENABLED === "yes" ? await guestDiningSummary(guestMatch[1]) : {}),
      });
    const legacy = /^\/guests\/([a-f0-9-]{36})\/link-reservation$/.exec(path);
    if (legacy && request.method === "POST") {
      checkStaffOrigin(request);
      if (found.role !== "manager") throw new ApiError(403, "FORBIDDEN", "Нужны права менеджера");
      const input = z
        .object({ reservationId: uuid, reason: z.string().trim().min(10).max(500) })
        .strict()
        .parse(await body(request));
      await transaction(async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(728411001)");
        const candidate = await client.query(
          `SELECT r.id FROM command_center_reservations r JOIN hostess_guests g ON g.id=$2
          LEFT JOIN hostess_guests previous ON previous.id=r.guest_id
          WHERE r.id=$1 AND g.provisional=false AND (r.guest_id IS NULL OR previous.provisional=true)
          AND regexp_replace(r.phone,'[^0-9]','','g')=regexp_replace(g.phone,'[^0-9]','','g')
          AND EXISTS (SELECT 1 FROM hostess_guest_identities i WHERE i.guest_id=g.id) FOR UPDATE OF r`,
          [input.reservationId, legacy[1]],
        );
        if (!candidate.rows[0])
          throw new ApiError(
            409,
            "PROOF_REQUIRED",
            "Проверенная принадлежность записи не подтверждена",
          );
        await actor(client, `staff:${found.staff_id}`);
        await client.query(
          "UPDATE command_center_reservations SET guest_id=$2,updated_at=now() WHERE id=$1",
          [input.reservationId, legacy[1]],
        );
        await client.query(
          "INSERT INTO hostess_audit(actor,action,entity_id,details) VALUES($1,'legacy_guest_link',$2,$3)",
          [
            `staff:${found.staff_id}`,
            input.reservationId,
            JSON.stringify({ guestId: legacy[1], reason: input.reason }),
          ],
        );
      });
      return json({ ok: true });
    }
    const move = /^\/reservations\/([a-f0-9-]{36})\/move$/.exec(path);
    if (move && request.method === "POST") {
      checkStaffOrigin(request);
      if (found.role === "viewer") throw new ApiError(403, "FORBIDDEN", "Недостаточно прав");
      const input = z
        .object({
          tableIds: z.array(z.string()).min(1).max(4).optional(),
          resourceId: uuid.optional(),
          reason: z.string().trim().min(3).max(300),
        })
        .strict()
        .refine(
          (value) => Boolean(value.tableIds) !== Boolean(value.resourceId),
          "Выберите стол или ресурс",
        )
        .parse(await body(request));
      await transaction(async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(728411001)");
        const r = (
          await client.query("SELECT * FROM command_center_reservations WHERE id=$1 FOR UPDATE", [
            move[1],
          ])
        ).rows[0];
        if (!r) throw new ApiError(404, "NOT_FOUND", "Бронь недоступна");
        const startsAt = new Date(r.starts_at).toISOString();
        const endsAt = new Date(r.ends_at).toISOString();
        if (input.tableIds) {
          validateSelection(
            { startsAt, endsAt, guests: r.guests, tableIds: input.tableIds },
            HALL_TABLES,
            true,
          );
        } else {
          validateBookingWindow({ startsAt, endsAt }, true);
          const resource = (
            await client.query<{
              code: string;
              name: string;
              capacity: number | null;
              is_reservable: boolean;
              status: string;
            }>(
              `SELECT r.code,r.name,r.capacity,r.is_reservable,r.status FROM venue_resources r
               JOIN venue_zones z ON z.id=r.zone_id WHERE r.id=$1 AND r.venue_code='xoxo' AND z.is_active`,
              [input.resourceId],
            )
          ).rows[0];
          if (!resource || !resource.is_reservable || resource.status !== "active")
            throw new ApiError(422, "INVALID_RESOURCE", "Это место пока нельзя забронировать");
          if (!resource.capacity || r.guests > resource.capacity)
            throw new ApiError(422, "CAPACITY", "В выбранной комнате недостаточно мест");
        }
        await actor(client, `staff:${found.staff_id}`);
        if (input.tableIds) {
          await client.query(
            "UPDATE command_center_reservations SET table_id=$2,table_label=$3,table_ids=$4,updated_at=now() WHERE id=$1",
            [r.id, input.tableIds[0], input.tableIds.join(" + "), input.tableIds],
          );
          await client.query(
            "DELETE FROM command_center_reservation_resources WHERE reservation_id=$1",
            [r.id],
          );
        } else {
          const resource = (
            await client.query<{ code: string; name: string }>(
              `SELECT r.code,r.name FROM venue_resources r JOIN venue_zones z ON z.id=r.zone_id
               WHERE r.id=$1 AND r.venue_code='xoxo' AND z.is_active`,
              [input.resourceId],
            )
          ).rows[0]!;
          await client.query(
            "UPDATE command_center_reservations SET table_id=$2,table_label=$3,table_ids=$4,updated_at=now() WHERE id=$1",
            [r.id, resource.code, resource.name, [resource.code]],
          );
          await client.query(
            `INSERT INTO command_center_reservation_resources(reservation_id,resource_id) VALUES($1,$2)
             ON CONFLICT (reservation_id) DO UPDATE SET resource_id=EXCLUDED.resource_id`,
            [r.id, input.resourceId],
          );
        }
        await client.query(
          "INSERT INTO hostess_audit(actor,action,entity_id,details) VALUES($1,'staff_move',$2,$3)",
          [
            `staff:${found.staff_id}`,
            r.id,
            JSON.stringify({
              reason: input.reason,
              tables: input.tableIds ?? null,
              resourceId: input.resourceId ?? null,
            }),
          ],
        );
      });
      return json({ ok: true, reservation: await getById(move[1]) });
    }
    throw new ApiError(404, "NOT_FOUND", "Операция недоступна");
  } catch (e) {
    return apiFailure(e);
  }
}
