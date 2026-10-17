import { z } from "zod";
import { guestQuote, guestOrder, pageCursor } from "./presentation";
import { pool } from "../db/pool";
import {
  transaction,
  session,
  serviceActor,
  checkStaffOrigin,
  rateLimit,
  type Session,
} from "../guest/auth";
import { ApiError, hash, randomToken, readCookie, cookie } from "../guest/security";
import { body, json, failure, responseHeaders } from "./http";
import {
  checkout,
  createQuote,
  findTable,
  snapshot,
  venue,
  orderDetail,
  changeStatus,
  type Owner,
} from "./service";
import { normalizePhone, statusNames, toMinor } from "./domain";
import { ledger, loyaltyLock, walletView } from "./loyalty";
import { printPanels, qrPng, qrSvg, zipFiles } from "./qr";
import {
  listRegistry,
  bookingTargets,
  saveRegistry,
  bulkRegistry,
  registryHistory,
  registryDistribution,
} from "../tables/registry";

const uuid = z.string().uuid();
const guestInput = z
  .object({ name: z.string().trim().min(1).max(100), phone: z.string().min(5).max(40) })
  .strict();
async function getOwner(
  request: Request,
  create = false,
): Promise<{ owner: Owner; setCookie?: string }> {
  const found = await session(request);
  if (found?.guest_id)
    return { owner: { guestId: found.guest_id, hash: hash(`guest:${found.guest_id}`) } };
  let token = readCookie(request, "__Host-hostess-dining"),
    setCookie: string | undefined;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    if (!create) throw new ApiError(401, "CONTEXT_REQUIRED", "Обновите корзину перед оформлением");
    token = randomToken();
    setCookie = cookie("__Host-hostess-dining", token, 7 * 86400);
  }
  return { owner: { guestId: null, hash: hash(`anonymous:${token}`) }, setCookie };
}
async function staffAuth(request: Request, write: boolean, manager = false): Promise<Session> {
  const staff = await session(request, true);
  if (!staff) throw new ApiError(401, "UNAUTHORIZED", "Войдите как сотрудник");
  if ((write && staff.role === "viewer") || (manager && staff.role !== "manager"))
    throw new ApiError(403, "FORBIDDEN", "Недостаточно прав");
  if (write) checkStaffOrigin(request);
  return staff;
}
export async function listQr(venueId: string) {
  return listRegistry(venueId);
}
async function selectedQr(venueId: string, url: URL) {
  const tables = await listQr(venueId);
  const ids = url.searchParams.get("ids")?.split(",").filter(Boolean);
  if (ids) ids.forEach((id) => uuid.parse(id));
  const zone = url.searchParams.get("zoneId");
  if (zone) uuid.parse(zone);
  const selected = tables.filter(
    (table) => (!ids || ids.includes(table.resourceId)) && (!zone || table.zoneId === zone),
  );
  if (!selected.length)
    throw new ApiError(
      422,
      "EMPTY_SELECTION",
      "Выберите хотя бы одну точку для печати или экспорта",
    );
  return selected;
}
async function audit(
  client: import("pg").PoolClient,
  staff: Session,
  action: string,
  id: string,
  details: unknown = {},
) {
  await client.query(
    "INSERT INTO hostess_audit(actor,action,entity_id,details) VALUES($1,$2,$3,$4)",
    [`staff:${staff.staff_id}`, action, id, JSON.stringify(details)],
  );
}
async function saveGuest(request: Request, staff: Session, id?: string) {
  const input = guestInput.parse(await body(request)),
    phone = normalizePhone(input.phone);
  return transaction(async (client) => {
    await loyaltyLock(client);
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`guest-phone:${phone}`]);
    const duplicate = (
      await client.query(
        "SELECT id FROM hostess_guests WHERE phone=$1 AND merged_into IS NULL AND ($2::uuid IS NULL OR id<>$2) LIMIT 1",
        [phone, id ?? null],
      )
    ).rows[0];
    if (duplicate)
      throw new ApiError(
        409,
        "GUEST_EXISTS",
        "Гость с таким телефоном уже существует. Найдите его в списке",
      );
    if (id) {
      const previous = (
        await client.query(
          "SELECT * FROM hostess_guests WHERE id=$1 AND merged_into IS NULL FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (!previous) throw new ApiError(404, "NOT_FOUND", "Гость не найден");
      if (!previous.provisional && previous.phone !== phone)
        throw new ApiError(
          409,
          "VERIFIED_CONTACT",
          "Подтверждённый телефон меняется только через проверку владения",
        );
      const row = (
        await client.query(
          "UPDATE hostess_guests SET name=$2,phone=$3,updated_at=now() WHERE id=$1 RETURNING id,name,phone,provisional,source",
          [id, input.name, phone],
        )
      ).rows[0];
      await audit(client, staff, "guest_updated", id, { fields: ["name", "phone"] });
      return row;
    }
    const row = (
      await client.query(
        "INSERT INTO hostess_guests(name,phone,provisional,source) VALUES($1,$2,true,'staff') RETURNING id,name,phone,provisional,source",
        [input.name, phone],
      )
    ).rows[0];
    await audit(client, staff, "guest_created", row.id);
    return row;
  });
}
export async function guestDiningSummary(id: string, slug = "xoxo") {
  return transaction(async (client) => {
    await loyaltyLock(client);
    const v = await venue(client, slug);
    return {
      wallet: await walletView(client, v.id, id),
      transactions: await ledger(client, v.id, id),
      orders: (
        await client.query(
          `SELECT id,number::text,status,accepted_at AS "acceptedAt",payable_minor::text AS "payableMinor" FROM dine_in_orders WHERE guest_id=$1 AND venue_id=$2 ORDER BY accepted_at DESC LIMIT 100`,
          [id, v.id],
        )
      ).rows,
      visits: (
        await client.query(
          `SELECT DISTINCT s.id,s.opened_at AS "openedAt",s.closed_at AS "closedAt",r.code AS "tableCode" FROM dining_sessions s
        JOIN dine_in_orders o ON o.dining_session_id=s.id JOIN venue_resources r ON r.id=s.resource_id WHERE o.guest_id=$1 AND s.venue_id=$2 ORDER BY s.opened_at DESC LIMIT 100`,
          [id, v.id],
        )
      ).rows,
      audit: (
        await client.query(
          'SELECT actor,action,created_at AS "createdAt" FROM hostess_audit WHERE entity_id=$1 ORDER BY created_at DESC LIMIT 100',
          [id],
        )
      ).rows,
    };
  });
}
export async function handleDiningApi(request: Request): Promise<Response | null> {
  const url = new URL(request.url),
    isGuest = url.pathname.startsWith("/api/guest/v1/"),
    isStaff = url.pathname.startsWith("/api/staff/v1/");
  if (!isGuest && !isStaff) return null;
  const path = url.pathname.slice((isGuest ? "/api/guest/v1" : "/api/staff/v1").length),
    method = request.method;
  const newPath = /^\/(dine-in|loyalty|tables)(\/|$)/.test(path);
  const guestWrite =
    isStaff &&
    ((path === "/guests" && method === "POST") ||
      (/^\/guests\/[a-f0-9-]{36}$/.test(path) && method === "PATCH"));
  if (!newPath && !guestWrite) return null;
  try {
    if (!guestWrite && process.env.DINE_IN_ENABLED !== "yes")
      throw new ApiError(503, "DINE_IN_DISABLED", "QR-заказы пока не включены");
    if (isGuest) {
      if (serviceActor(request) !== "bff")
        throw new ApiError(403, "BFF_REQUIRED", "Маршрут доступен через Hostess");
      await rateLimit(`dining:${request.headers.get("x-hostess-client-id") ?? "unknown"}`, 120);
      const tableMatch = /^\/dine-in\/tables\/([A-Za-z0-9_-]{43,64})$/.exec(path);
      if (tableMatch && method === "GET") {
        const t = await findTable(pool, tableMatch[1]);
        return json({
          venueCode: t.slug,
          venueName: t.display_name,
          resourceId: t.resource_id,
          code: t.code,
          name: t.name,
          zoneName: t.zone_name,
          enabled: t.enabled,
          currency: "KZT",
          venue: { id: t.venue_id, slug: t.slug, name: t.display_name, currency: "KZT" },
          table: { resourceId: t.resource_id, code: t.code, name: t.name, zoneName: t.zone_name },
        });
      }
      if (path === "/dine-in/menu" && method === "GET") {
        const v = await venue(pool, url.searchParams.get("venue") ?? "xoxo");
        if (v.slug !== "xoxo")
          throw new ApiError(422, "UNSUPPORTED_VENUE", "Меню заведения пока недоступно");
        const menu = await snapshot();
        return json({
          ...menu,
          products: menu.products.map((product) => ({
            ...product,
            price: toMinor(product.price) / 100,
          })),
        });
      }
      if (path === "/dine-in/quotes" && method === "POST") {
        const context = await getOwner(request, true);
        return json(
          guestQuote(await createQuote(context.owner, await body(request))),
          201,
          context.setCookie,
        );
      }
      if (path === "/dine-in/orders" && method === "GET") {
        const found = await session(request);
        if (!found?.guest_id)
          throw new ApiError(401, "SESSION_REQUIRED", "Войдите для просмотра заказов");
        const [at, id] = pageCursor(url.searchParams.get("before")),
          v = await venue(pool, url.searchParams.get("venue") ?? "xoxo");
        const rows = (
          await pool.query(
            'SELECT id,to_char(accepted_at AT TIME ZONE \'UTC\',\'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS "paginationTime" FROM dine_in_orders WHERE venue_id=$1 AND guest_id=$2 AND ($3::timestamptz IS NULL OR ($4::uuid IS NULL AND accepted_at<$3) OR (accepted_at,id)<($3::timestamptz,$4::uuid)) ORDER BY accepted_at DESC,id DESC LIMIT 100',
            [v.id, found.guest_id, at, id],
          )
        ).rows;
        return json({
          orders: await Promise.all(
            rows.map(async (r) => guestOrder(await orderDetail(pool, r.id, v.id))),
          ),
          nextCursor: rows.length === 100 ? rows[99].paginationTime + "|" + rows[99].id : null,
        });
      }
      if (path === "/dine-in/orders" && method === "POST") {
        const context = await getOwner(request);
        const result = await checkout(context.owner, await body(request));
        const publicOrder = guestOrder(result.order, result.receiptToken);
        return json({ ...result, order: publicOrder }, result.replayed ? 200 : 201);
      }
      const orderMatch = /^\/dine-in\/orders\/([a-f0-9-]{36})$/.exec(path);
      if (orderMatch && method === "GET") {
        uuid.parse(orderMatch[1]);
        const found = await session(request),
          anon = readCookie(request, "__Host-hostess-dining");
        const receipt =
          request.headers.get("x-hostess-receipt-token") ?? url.searchParams.get("receiptToken");
        if (receipt && !/^[A-Za-z0-9_-]{43}$/.test(receipt))
          throw new ApiError(404, "NOT_FOUND", "Заказ не найден");
        const ownerHash = found?.guest_id
          ? hash(`guest:${found.guest_id}`)
          : anon && /^[A-Za-z0-9_-]{43}$/.test(anon)
            ? hash(`anonymous:${anon}`)
            : null;
        const record = (
          await pool.query(
            "SELECT id,venue_id FROM dine_in_orders WHERE id=$1 AND (guest_id=$2 OR owner_hash=$3 OR receipt_hash=$4)",
            [orderMatch[1], found?.guest_id ?? null, ownerHash, receipt ? hash(receipt) : null],
          )
        ).rows[0];
        if (!record) throw new ApiError(404, "NOT_FOUND", "Заказ не найден");
        const order = await orderDetail(pool, record.id, record.venue_id);
        // Receipts are scoped capabilities; do not leak linked guest PII or internal staff history.
        const publicOrder = guestOrder(order);
        return json({ order: publicOrder });
      }
      if ((path === "/loyalty/wallet" || path === "/loyalty/transactions") && method === "GET") {
        const found = await session(request);
        if (!found?.guest_id)
          throw new ApiError(401, "SESSION_REQUIRED", "Войдите для просмотра бонусов");
        const before = url.searchParams.get("before") || null;
        if (before) pageCursor(before);
        return json(
          await transaction(async (client) => {
            await loyaltyLock(client);
            const v = await venue(client, url.searchParams.get("venue") ?? "xoxo");
            if (path.endsWith("wallet")) return await walletView(client, v.id, found.guest_id!);
            const transactions = await ledger(client, v.id, found.guest_id!, before);
            const last = transactions[transactions.length - 1];
            return {
              transactions,
              nextCursor: transactions.length === 200 ? last.paginationTime + "|" + last.id : null,
            };
          }),
        );
      }
    } else {
      const write = method !== "GET",
        isSensitive =
          /\/qr\/rotate$/.test(path) ||
          /\/cancel$/.test(path) ||
          path === "/tables/qr/bootstrap" ||
          path === "/tables/qr/bulk" ||
          path === "/dine-in/outbox/retry" ||
          (method === "PATCH" && path.startsWith("/tables/"));
      const staff = await staffAuth(request, write, isSensitive),
        v = await venue(pool, url.searchParams.get("venue") ?? "xoxo");
      if (guestWrite) {
        const match = /^\/guests\/([a-f0-9-]{36})$/.exec(path);
        return json({ guest: await saveGuest(request, staff, match?.[1]) }, match ? 200 : 201);
      }
      const loyaltyMatch = /^\/loyalty\/guests\/([a-f0-9-]{36})$/.exec(path);
      if (loyaltyMatch && method === "GET") {
        uuid.parse(loyaltyMatch[1]);
        return json(await guestDiningSummary(loyaltyMatch[1], v.slug));
      }
      if (path === "/dine-in/outbox/retry" && method === "POST") {
        const input = z
          .object({ reason: z.string().trim().min(3).max(300) })
          .strict()
          .parse(await body(request));
        const retried = await transaction(async (client) => {
          const result = await client.query(
            "UPDATE integration_outbox SET terminal=false,next_attempt_at=now(),last_error=NULL WHERE venue_id=$1 AND status='failed' RETURNING id",
            [v.id],
          );
          await audit(client, staff, "outbox_retry", v.id, {
            reason: input.reason,
            count: result.rowCount,
          });
          return result.rowCount;
        });
        return json({ retried });
      }
      if (path === "/tables/qr/bootstrap" && method === "POST") {
        if (v.slug !== "xoxo")
          throw new ApiError(422, "UNSUPPORTED_VENUE", "Bootstrap доступен для XOXO");
        await transaction(async (client) => {
          await client.query("SELECT hostess_bootstrap_qr()");
          await audit(client, staff, "qr_bootstrap", v.id);
        });
        return json({ tables: await listQr(v.id) });
      }
      if (path === "/tables/qr/bulk" && method === "POST")
        return json(await bulkRegistry(v.id, await body(request), staff));
      const registry = /^\/tables\/([a-f0-9-]{36})\/registry$/.exec(path);
      if (registry && method === "PATCH")
        return json(await saveRegistry(v.id, uuid.parse(registry[1]), await body(request), staff));
      const history = /^\/tables\/([a-f0-9-]{36})\/history$/.exec(path);
      if (history && method === "GET")
        return json({ history: await registryHistory(v.id, uuid.parse(history[1])) });
      const mapping = /^\/tables\/([a-f0-9-]{36})\/mapping$/.exec(path);
      if (mapping && method === "PATCH") {
        const id = uuid.parse(mapping[1]);
        const input = z
          .object({
            legacyCode: z
              .enum(["A1", "A2", "A3", "B1", "B2", "B3", "B4", "C1", "C2", "Bar"])
              .nullable(),
            verified: z.boolean(),
            reason: z.string().trim().min(3).max(500),
          })
          .strict()
          .refine((x) => x.verified || x.legacyCode === null)
          .parse(await body(request));
        await transaction(async (client) => {
          await client.query("SELECT pg_advisory_xact_lock(728411001)");
          if (
            !(
              await client.query(
                "SELECT id FROM table_qr_codes WHERE resource_id=$1 AND venue_id=$2",
                [id, v.id],
              )
            ).rowCount
          )
            throw new ApiError(404, "NOT_FOUND", "Стол не найден");
          await client.query(
            `INSERT INTO venue_resource_mappings(resource_id,venue_id,legacy_code,verified_at,verified_by,note,relationship)
            VALUES($1,$2,$3,CASE WHEN $4 THEN now() ELSE NULL END,CASE WHEN $4 THEN $5 ELSE NULL END,$6,CASE WHEN NOT $4 THEN 'pending' WHEN $3::text IS NULL THEN 'independent' ELSE 'linked' END)
            ON CONFLICT(resource_id) DO UPDATE SET legacy_code=EXCLUDED.legacy_code,verified_at=EXCLUDED.verified_at,verified_by=EXCLUDED.verified_by,note=EXCLUDED.note,relationship=EXCLUDED.relationship,linked_resource_id=NULL`,
            [id, v.id, input.legacyCode, input.verified, staff.staff_id, input.reason],
          );
          await client.query(
            "UPDATE venue_resources SET registry_version=registry_version+1 WHERE id=$1",
            [id],
          );
          await audit(client, staff, "physical_mapping_updated", id, input);
        });
        return json({ tables: await listQr(v.id) });
      }
      if (path === "/tables/qr" && method === "GET") {
        const tables = await listQr(v.id);
        return json({
          tables,
          distribution: registryDistribution(tables),
          bookingTargets: await bookingTargets(v.id),
          zones: (
            await pool.query(
              "SELECT id,name,code FROM venue_zones WHERE venue_code=$1 AND is_active ORDER BY display_order",
              [v.slug],
            )
          ).rows,
        });
      }
      if (path === "/tables/qr/print" && method === "GET")
        return new Response(printPanels(await selectedQr(v.id, url)), {
          headers: { ...responseHeaders, "content-type": "text/html; charset=utf-8" },
        });
      if (path === "/tables/qr/export.zip" && method === "GET") {
        const tables = await selectedQr(v.id, url),
          files = tables.flatMap((t) => [
            { name: `xoxo-table-${t.code}.svg`, data: Buffer.from(qrSvg(t.url)) },
            { name: `xoxo-table-${t.code}.png`, data: qrPng(t.url) },
          ]);
        files.push(
          { name: "print-panels.html", data: Buffer.from(printPanels(tables)) },
          {
            name: "urls.json",
            data: Buffer.from(
              JSON.stringify(
                tables.map(({ code, url, resourceId, enabled }) => ({
                  code,
                  url,
                  resourceId,
                  enabled,
                })),
                null,
                2,
              ),
            ),
          },
        );
        return new Response(new Uint8Array(zipFiles(files)), {
          headers: {
            ...responseHeaders,
            "content-type": "application/zip",
            "content-disposition": `attachment; filename="xoxo-${tables.length}-qr.zip"`,
          },
        });
      }
      const image = /^\/tables\/([a-f0-9-]{36})\/qr\.(svg|png)$/.exec(path);
      if (image && method === "GET") {
        const table = (await listQr(v.id)).find((t) => t.resourceId === image[1]);
        if (!table) throw new ApiError(404, "NOT_FOUND", "Стол не найден");
        return new Response(
          image[2] === "svg" ? qrSvg(table.url) : new Uint8Array(qrPng(table.url)),
          {
            headers: {
              ...responseHeaders,
              "content-type": image[2] === "svg" ? "image/svg+xml" : "image/png",
              ...(url.searchParams.has("download")
                ? {
                    "content-disposition": `attachment; filename="xoxo-table-${table.code}.${image[2]}"`,
                  }
                : {}),
            },
          },
        );
      }
      const rotate = /^\/tables\/([a-f0-9-]{36})\/qr\/rotate$/.exec(path),
        update = /^\/tables\/([a-f0-9-]{36})$/.exec(path);
      if ((rotate && method === "POST") || (update && method === "PATCH")) {
        const id = uuid.parse((rotate ?? update)![1]);
        const input = rotate
          ? z
              .object({ confirm: z.literal(true) })
              .strict()
              .parse(await body(request))
          : z
              .object({
                enabled: z.boolean().optional(),
                name: z.string().trim().min(1).max(100).optional(),
                zoneId: uuid.optional(),
              })
              .strict()
              .parse(await body(request));
        await transaction(async (client) => {
          const qr = (
            await client.query(
              "SELECT id FROM table_qr_codes WHERE resource_id=$1 AND venue_id=$2 FOR UPDATE",
              [id, v.id],
            )
          ).rows[0];
          if (!qr) throw new ApiError(404, "NOT_FOUND", "Стол не найден");
          if (rotate)
            await client.query(
              "UPDATE table_qr_codes SET token=$2,generation=generation+1,rotated_at=now() WHERE id=$1",
              [qr.id, randomToken()],
            );
          else {
            const change = input as { enabled?: boolean; name?: string; zoneId?: string };
            if (
              change.zoneId &&
              !(
                await client.query(
                  "SELECT id FROM venue_zones WHERE id=$1 AND venue_code=$2 AND is_active",
                  [change.zoneId, v.slug],
                )
              ).rowCount
            )
              throw new ApiError(422, "INVALID_ZONE", "Недопустимая зона");
            await client.query(
              "UPDATE table_qr_codes SET enabled=COALESCE($2,enabled) WHERE id=$1",
              [qr.id, change.enabled ?? null],
            );
            await client.query(
              "UPDATE venue_resources SET name=COALESCE($2,name),zone_id=COALESCE($3,zone_id),updated_at=now(),registry_version=registry_version+1 WHERE id=$1 AND venue_id=$4",
              [id, change.name ?? null, change.zoneId ?? null, v.id],
            );
          }
          await audit(client, staff, rotate ? "qr_rotated" : "qr_updated", id, {
            fields: Object.keys(input),
          });
        });
        return json({ tables: await listQr(v.id) });
      }
      if (path === "/dine-in/orders" && method === "GET") {
        const status = url.searchParams.get("status") || null;
        if (status) z.enum(statusNames).parse(status);
        const q = z
          .string()
          .max(100)
          .parse(url.searchParams.get("q") ?? "");
        const before = url.searchParams.get("before") || null;
        if (before) z.string().datetime().parse(before);
        const rows = (
          await pool.query(
            `SELECT o.id FROM dine_in_orders o JOIN venue_resources r ON r.id=o.table_resource_id LEFT JOIN hostess_guests g ON g.id=o.guest_id
          WHERE o.venue_id=$1 AND ($2::text IS NULL OR o.status=$2) AND ($3='' OR concat_ws(' ',o.number::text,r.code,r.name,g.name,g.phone) ILIKE '%'||$3||'%')
          AND ($4::timestamptz IS NULL OR o.accepted_at<$4) ORDER BY (o.status='new') DESC,o.accepted_at DESC,o.id DESC LIMIT 100`,
            [v.id, status, q, before],
          )
        ).rows;
        const orders = await Promise.all(rows.map((r) => orderDetail(pool, r.id, v.id)));
        const outbox = (
          await pool.query(
            "SELECT status,count(*)::int AS count FROM integration_outbox WHERE venue_id=$1 GROUP BY status",
            [v.id],
          )
        ).rows;
        return json({ orders, outbox, asOf: new Date().toISOString(), limit: 100 });
      }
      const orderMatch = /^\/dine-in\/orders\/([a-f0-9-]{36})(?:\/(status|cancel|guest))?$/.exec(
        path,
      );
      if (orderMatch) {
        const id = uuid.parse(orderMatch[1]);
        if (!orderMatch[2] && method === "GET")
          return json({ order: await orderDetail(pool, id, v.id) });
        if (orderMatch[2] === "cancel" && method === "POST") {
          const input = z
            .object({ reason: z.string().trim().min(3).max(500) })
            .strict()
            .parse(await body(request));
          return json({
            order: await changeStatus(id, v.id, staff.staff_id!, undefined, input.reason),
          });
        }
        if (orderMatch[2] === "status" && method === "PATCH") {
          const input = z
            .object({
              status: z.enum(statusNames).optional(),
              manualPaymentReceived: z.literal(true).optional(),
            })
            .strict()
            .refine((v) => v.status || v.manualPaymentReceived)
            .parse(await body(request));
          return json({
            order: await changeStatus(
              id,
              v.id,
              staff.staff_id!,
              input.status,
              undefined,
              input.manualPaymentReceived,
            ),
          });
        }
        if (orderMatch[2] === "guest" && method === "POST") {
          const input = z
            .object({ guestId: uuid })
            .strict()
            .parse(await body(request));
          return json({
            order: await changeStatus(
              id,
              v.id,
              staff.staff_id!,
              undefined,
              undefined,
              undefined,
              input.guestId,
            ),
          });
        }
      }
    }
    throw new ApiError(404, "NOT_FOUND", "Маршрут не найден");
  } catch (e) {
    if (isStaff && path.startsWith("/tables/") && (e as { code?: string })?.code === "23P01")
      return json(
        {
          error: {
            code: "PHYSICAL_OCCUPIED",
            message:
              "У этого физического места есть будущая бронь, активное удержание или открытый визит. Завершите связанные операции перед изменением соответствия или вместимости.",
          },
        },
        409,
      );
    return failure(e);
  }
}
