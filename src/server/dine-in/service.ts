import type { PoolClient } from "pg";
import { z } from "zod";
import { pool } from "../db/pool";
import { transaction } from "../guest/auth";
import { ApiError, hash, randomToken } from "../guest/security";
import {
  calculate,
  priceLines,
  quoteInput,
  orderInput,
  snapshotSchema,
  assertTransition,
  type OrderStatus,
  type Line,
} from "./domain";
import { earn, redeem, walletView, loyaltyLock, reverseLoyalty } from "./loyalty";
import { acquireDiningSession, floorLock } from "../floor/lifecycle";
import { regularPriceLines, validateRegularQuote } from "./menu";
import { accessTable } from "./access";

export type Owner = { guestId: string | null; hash: string };
/** Staff may use only the verified identity already bound through this visit's
 * canonical reservation. A typed phone or arbitrary session guest is insufficient. */
export async function verifiedVisitGuest(
  client: Pick<PoolClient, "query">,
  venueId: string,
  sessionId: string,
) {
  return (
    await client.query(
      `SELECT g.id,g.name FROM dining_sessions s
    JOIN command_center_reservations b ON b.id=s.reservation_id AND b.guest_id=s.guest_id
    JOIN hostess_guests g ON g.id=s.guest_id AND g.merged_into IS NULL
    WHERE s.id=$1 AND s.venue_id=$2 AND s.closed_at IS NULL AND s.seated_at IS NOT NULL
    AND b.status='arrived' AND EXISTS(SELECT 1 FROM hostess_guest_identities i WHERE i.guest_id=g.id)`,
      [sessionId, venueId],
    )
  ).rows[0] as { id: string; name: string } | undefined;
}
export function exchangeOrigin() {
  const value = process.env.EXCHANGE_API_ORIGIN;
  if (!value) throw new ApiError(503, "CONFIG_REQUIRED", "Не настроен адрес биржи");
  const url = new URL(value);
  if (
    url.protocol !== "https:" &&
    !(
      process.env.NODE_ENV !== "production" &&
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(url.hostname)
    )
  )
    throw new ApiError(503, "CONFIG_REQUIRED", "Недопустимый адрес биржи");
  return url.origin;
}
export async function snapshot() {
  try {
    const response = await fetch(`${exchangeOrigin()}/api/v1/public/snapshot`, {
      redirect: "error",
      signal: AbortSignal.timeout(8000),
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Exchange unavailable");
    const value = snapshotSchema.parse(await response.json());
    priceLines(value, []);
    return value;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(503, "EXCHANGE_UNAVAILABLE", "Биржа временно недоступна. Попробуйте снова");
  }
}
export async function findTable(
  client: Pick<PoolClient, "query">,
  token: string,
  lock = false,
  staff = false,
) {
  const row = (
    await client.query(
      `SELECT q.id,q.venue_id,q.resource_id,q.generation,q.enabled,r.code,r.name,r.zone_id,z.name AS zone_name,v.slug,v.display_name,v.active,r.status,z.is_active
    FROM table_qr_codes q JOIN venue_resources r ON r.id=q.resource_id JOIN venue_zones z ON z.id=r.zone_id JOIN hostess_venues v ON v.id=q.venue_id
    WHERE q.token=$1 OR ('web_'||r.id::text)=$1 ${lock ? "FOR UPDATE OF q" : ""}`,
      [token],
    )
  ).rows[0];
  if (!row) throw new ApiError(404, "TABLE_NOT_FOUND", "QR-код не найден или перевыпущен");
  if (
    (!row.enabled && !staff && !token.startsWith("web_")) ||
    !row.active ||
    row.status !== "active" ||
    !row.is_active
  )
    throw new ApiError(409, "TABLE_DISABLED", "Заказы по этому QR временно отключены");
  return row;
}
export async function venue(client: Pick<PoolClient, "query">, slug: string) {
  const row = (await client.query("SELECT * FROM hostess_venues WHERE slug=$1 AND active", [slug]))
    .rows[0];
  if (!row) throw new ApiError(404, "VENUE_NOT_FOUND", "Заведение недоступно");
  return row;
}
export async function createQuote(
  owner: Owner,
  raw: unknown,
  staffContext?: { actor: string; sessionId: string; preorderIds?: string[] },
) {
  const input = quoteInput.parse(raw);
  const webOrder = input.qrToken.startsWith("web_");
  const access = input.qrToken.startsWith("visit_")
    ? await accessTable(input.qrToken, owner)
    : null;
  if (access) input.qrToken = access.token;
  const table = await findTable(pool, input.qrToken, false, !!staffContext);
  const exchangeItems = input.items.filter((item) => (item.itemType ?? "EXCHANGE") === "EXCHANGE");
  const regularItems = input.items.filter((item) => item.itemType === "REGULAR_MENU");
  if (table.slug !== "xoxo" && exchangeItems.length)
    throw new ApiError(422, "UNSUPPORTED_VENUE", "Меню заведения пока недоступно");
  const exchange = exchangeItems.length ? priceLines(await snapshot(), exchangeItems) : null;
  return transaction(async (client) => {
    await loyaltyLock(client);
    await floorLock(client);
    const table = await findTable(client, input.qrToken, true, !!staffContext);
    const contextSessionId =
      staffContext?.sessionId ??
      access?.session_id ??
      (webOrder ? await acquireDiningSession(client, table.venue_id, table.resource_id) : null);
    if (
      contextSessionId &&
      !(
        await client.query(
          "SELECT id FROM dining_sessions WHERE id=$1 AND venue_id=$2 AND resource_id=$3 AND ($4 OR seated_at IS NOT NULL) AND closed_at IS NULL",
          [contextSessionId, table.venue_id, table.resource_id, webOrder],
        )
      ).rowCount
    )
      throw new ApiError(409, "SESSION_CHANGED", "Визит завершён или посадка не подтверждена");
    const regular = await regularPriceLines(client, table.venue_id, regularItems);
    const preorderIds = staffContext?.preorderIds ?? [];
    if (preorderIds.length) {
      const planned = (
        await client.query(
          `SELECT p.id,p.product_id,p.item_type,p.quantity FROM command_center_reservation_preorders p
         JOIN dining_sessions s ON s.reservation_id=p.reservation_id WHERE s.id=$1
         AND p.id=ANY($2::uuid[]) AND p.preorder_status='pending' FOR UPDATE OF p`,
          [contextSessionId, preorderIds],
        )
      ).rows;
      if (planned.length !== preorderIds.length)
        throw new ApiError(
          409,
          "PREORDER_CHANGED",
          "Предзаказ уже оформлен или изменён. Обновите визит",
        );
      const quantities = new Map<string, number>();
      for (const p of planned) {
        const key = `${p.item_type}:${p.product_id}`;
        quantities.set(key, (quantities.get(key) ?? 0) + p.quantity);
      }
      for (const [key, quantity] of quantities) {
        const item = input.items.find((i) => `${i.itemType ?? "EXCHANGE"}:${i.productId}` === key);
        if (!item || item.quantity < quantity)
          throw new ApiError(422, "PREORDER_MISMATCH", "В корзине не хватает позиций предзаказа");
      }
    }
    const priced = {
      lines: [...(exchange?.lines ?? []), ...regular],
      expiresAt: exchange?.expiresAt ?? new Date(Date.now() + 120_000).toISOString(),
    };
    const roundId = exchange?.lines[0]?.roundId ?? null;
    const program = (
      await client.query("SELECT * FROM loyalty_programs WHERE venue_id=$1", [table.venue_id])
    ).rows[0];
    if (!program) throw new ApiError(503, "CONFIG_REQUIRED", "Бонусная программа не настроена");
    const balance = owner.guestId
      ? (await walletView(client, table.venue_id, owner.guestId)).balanceMinor
      : 0;
    if (!owner.guestId && input.redeemMinor)
      throw new ApiError(401, "SESSION_REQUIRED", "Войдите для использования бонусов");
    const totals = calculate(
      priced.lines.reduce((n, l) => n + l.totalMinor, 0),
      input.redeemMinor,
      balance,
      program.cashback_bps,
      program.redeem_limit_bps,
    );
    if (!owner.guestId) totals.cashbackMinor = 0;
    const result = await client.query(
      `INSERT INTO dine_in_quotes(venue_id,qr_id,qr_generation,guest_id,owner_hash,lines,round_id,subtotal_minor,discount_minor,payable_minor,cashback_minor,expires_at,context_session_id,staff_actor,access_grant_id,order_source,preorder_ids)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id,expires_at AS "expiresAt"`,
      [
        table.venue_id,
        table.id,
        table.generation,
        owner.guestId,
        owner.hash,
        JSON.stringify(priced.lines),
        roundId,
        totals.subtotalMinor,
        totals.discountMinor,
        totals.payableMinor,
        totals.cashbackMinor,
        priced.expiresAt,
        contextSessionId,
        staffContext?.actor ?? null,
        access?.grant_id ?? null,
        staffContext ? "staff" : access ? "table_code" : webOrder ? "web_app" : "qr",
        preorderIds,
      ],
    );
    return {
      ...result.rows[0],
      currency: "KZT",
      roundId,
      table: { resourceId: table.resource_id, code: table.code },
      items: priced.lines,
      ...totals,
    };
  });
}
export async function orderDetail(client: Pick<PoolClient, "query">, id: string, venueId: string) {
  const row = (
    await client.query(
      `SELECT o.id,o.number::text,o.venue_id AS "venueId",v.slug AS "venueCode",o.guest_id AS "guestId",o.dining_session_id AS "diningSessionId",o.table_resource_id AS "tableResourceId",r.code AS "tableCode",r.name AS "tableName",z.name AS "zoneName",
    COALESCE((SELECT e.details->>'source' FROM dine_in_order_events e WHERE e.order_id=o.id AND e.type='created' ORDER BY e.created_at,e.id LIMIT 1),'qr') AS source,
    g.name AS "guestName",g.phone AS "guestPhone",o.status,o.payment_status AS "paymentStatus",o.manual_payment_at AS "manualPaymentAt",o.accepted_at AS "acceptedAt",
    (SELECT l.expires_at FROM loyalty_lots l WHERE l.order_id=o.id) AS "cashbackExpiresAt",o.subtotal_minor::text AS "subtotalMinor",o.discount_minor::text AS "discountMinor",o.payable_minor::text AS "payableMinor",o.cashback_minor::text AS "cashbackMinor",
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',i.id,'productId',COALESCE(i.exchange_product_id,i.menu_item_id::text),'itemType',i.item_type,'menuVersion',i.menu_version,'name',i.name,'quantity',i.quantity,'unitPriceMinor',i.unit_price_minor::text,'totalMinor',i.total_minor::text,'roundId',i.round_id) ORDER BY i.id),'[]') FROM dine_in_order_items i WHERE i.order_id=o.id) AS items,
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',e.id,'type',e.type,'actor',e.actor,'details',e.details,'createdAt',e.created_at) ORDER BY e.created_at,e.id),'[]') FROM dine_in_order_events e WHERE e.order_id=o.id) AS events
    FROM dine_in_orders o JOIN hostess_venues v ON v.id=o.venue_id JOIN venue_resources r ON r.id=o.table_resource_id JOIN venue_zones z ON z.id=r.zone_id
    LEFT JOIN hostess_guests g ON g.id=o.guest_id WHERE o.id=$1 AND o.venue_id=$2`,
      [id, venueId],
    )
  ).rows[0];
  if (!row) throw new ApiError(404, "NOT_FOUND", "Заказ не найден");
  return row;
}
async function event(
  client: PoolClient,
  order: { id: string; venue_id: string },
  actor: string,
  type: string,
  details: unknown = {},
) {
  await client.query(
    "INSERT INTO dine_in_order_events(venue_id,order_id,actor,type,details) VALUES($1,$2,$3,$4,$5)",
    [order.venue_id, order.id, actor, type, JSON.stringify(details)],
  );
  await client.query(
    "INSERT INTO hostess_audit(actor,action,entity_id,details) VALUES($1,$2,$3,$4)",
    [actor, `dine_in_${type}`, order.id, JSON.stringify(details)],
  );
}
export async function enqueue(
  client: PoolClient,
  order: { id: string; venue_id: string },
  type: "ORDER_ACCEPTED" | "ORDER_CANCELLED",
) {
  await client.query(
    `INSERT INTO integration_outbox(venue_id,order_id,order_item_id,event_type,payload)
    SELECT o.venue_id,o.id,i.id,$2,jsonb_build_object('orderId',o.id,'orderItemId',i.id,'exchangeProductId',i.exchange_product_id,
      'roundId',i.round_id,'quantity',i.quantity,'unitPrice',i.unit_price_minor/100.0,'unitPriceMinor',i.unit_price_minor::text,'currency','KZT',
      'occurredAt',CASE WHEN $2='ORDER_ACCEPTED' THEN o.accepted_at ELSE clock_timestamp() END,'venueCode',v.slug,'eventType',$2::text)
    FROM dine_in_orders o JOIN dine_in_order_items i ON i.order_id=o.id JOIN hostess_venues v ON v.id=o.venue_id WHERE o.id=$1 AND i.item_type='EXCHANGE'
    ON CONFLICT(order_item_id,event_type) DO NOTHING`,
    [order.id, type],
  );
}
export async function checkout(owner: Owner, raw: unknown, staffActor?: string) {
  const input = orderInput.parse(raw);
  if (process.env.DINE_IN_PILOT_ASSUMED_PAID !== "yes")
    throw new ApiError(503, "PAYMENT_MODE_REQUIRED", "Оформление заказа временно отключено");
  return transaction(async (client) => {
    await loyaltyLock(client);
    // Keep the physical mapping/visit lock before QR row locks, matching staff writers.
    await floorLock(client);
    // Key lock before quote lock prevents two requests with the same key creating different orders.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `checkout:${owner.hash}:${input.idempotencyKey}`,
    ]);
    const quote = (
      await client.query("SELECT * FROM dine_in_quotes WHERE id=$1 AND owner_hash=$2 FOR UPDATE", [
        input.quoteId,
        owner.hash,
      ])
    ).rows[0];
    if (!quote) throw new ApiError(404, "QUOTE_NOT_FOUND", "Расчёт не найден");
    const prior = (
      await client.query(
        "SELECT id,quote_id,venue_id FROM dine_in_orders WHERE venue_id=$1 AND owner_hash=$2 AND idempotency_key=$3",
        [quote.venue_id, owner.hash, input.idempotencyKey],
      )
    ).rows[0];
    if (prior) {
      if (prior.quote_id !== input.quoteId)
        throw new ApiError(409, "IDEMPOTENCY_MISMATCH", "Ключ уже использован для другого заказа");
      return { order: await orderDetail(client, prior.id, prior.venue_id), replayed: true };
    }
    if (quote.staff_actor !== (staffActor ?? null))
      throw new ApiError(403, "FORBIDDEN", "Расчёт принадлежит другому контексту");
    if (
      staffActor &&
      owner.guestId &&
      (await verifiedVisitGuest(client, quote.venue_id, quote.context_session_id))?.id !==
        owner.guestId
    )
      throw new ApiError(409, "OWNER_CHANGED", "Проверенная связь гостя с визитом изменилась");
    if (
      quote.context_session_id &&
      !(
        await client.query(
          `SELECT id FROM dining_sessions WHERE id=$1 AND venue_id=$2 AND ($3 OR seated_at IS NOT NULL) AND closed_at IS NULL`,
          [quote.context_session_id, quote.venue_id, quote.order_source === "web_app"],
        )
      ).rowCount
    )
      throw new ApiError(409, "SESSION_CHANGED", "Визит завершён. Подтвердите текущий стол заново");
    if (
      quote.access_grant_id &&
      !(
        await client.query(
          `SELECT id FROM dining_access_grants WHERE id=$1 AND owner_hash=$2 AND expires_at>clock_timestamp() AND revoked_at IS NULL`,
          [quote.access_grant_id, owner.hash],
        )
      ).rowCount
    )
      throw new ApiError(409, "ACCESS_INVALID", "Подтверждение стола истекло. Попросите новый код");
    if (quote.guest_id !== owner.guestId)
      throw new ApiError(403, "OWNER_CHANGED", "Обновите расчёт после входа");
    if (quote.consumed_at) throw new ApiError(409, "QUOTE_USED", "Расчёт уже использован");
    const valid = (
      await client.query(
        "SELECT expires_at>clock_timestamp() AS valid FROM dine_in_quotes WHERE id=$1",
        [quote.id],
      )
    ).rows[0].valid;
    if (!valid) throw new ApiError(409, "REQUOTE", "Цена истекла. Запросите новый расчёт");
    const qr = (
      await client.query(
        `SELECT q.*,r.status,z.is_active,v.active FROM table_qr_codes q JOIN venue_resources r ON r.id=q.resource_id
      JOIN venue_zones z ON z.id=r.zone_id JOIN hostess_venues v ON v.id=q.venue_id WHERE q.id=$1 AND q.venue_id=$2 FOR UPDATE OF q`,
        [quote.qr_id, quote.venue_id],
      )
    ).rows[0];
    if (
      !qr ||
      (!qr.enabled && quote.order_source !== "web_app" && !staffActor) ||
      !qr.active ||
      qr.status !== "active" ||
      !qr.is_active ||
      qr.generation !== quote.qr_generation
    )
      throw new ApiError(
        409,
        "TABLE_DISABLED",
        "QR-код отключён или перевыпущен. Отсканируйте его заново",
      );
    await validateRegularQuote(client, qr.venue_id, quote.lines as Line[]);
    if (quote.preorder_ids.length) {
      const pending = await client.query(
        "SELECT id FROM command_center_reservation_preorders WHERE id=ANY($1::uuid[]) AND preorder_status='pending' FOR UPDATE",
        [quote.preorder_ids],
      );
      if (pending.rowCount !== quote.preorder_ids.length)
        throw new ApiError(409, "PREORDER_CHANGED", "Другой сотрудник уже оформил предзаказ");
    }
    const diningSessionId = await acquireDiningSession(client, qr.venue_id, qr.resource_id);
    const receiptToken = randomToken();
    const order = (
      await client.query(
        `INSERT INTO dine_in_orders(venue_id,table_resource_id,dining_session_id,quote_id,guest_id,owner_hash,receipt_hash,idempotency_key,
      subtotal_minor,discount_minor,payable_minor,cashback_minor,payment_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'assumed_paid') RETURNING id,venue_id`,
        [
          qr.venue_id,
          qr.resource_id,
          diningSessionId,
          quote.id,
          owner.guestId,
          owner.hash,
          hash(receiptToken),
          input.idempotencyKey,
          quote.subtotal_minor,
          quote.discount_minor,
          quote.payable_minor,
          quote.cashback_minor,
        ],
      )
    ).rows[0];
    if (owner.guestId) {
      await redeem(client, qr.venue_id, owner.guestId, order.id, Number(quote.discount_minor));
      await earn(client, qr.venue_id, owner.guestId, order.id, Number(quote.cashback_minor));
    }
    if (quote.preorder_ids.length)
      await client.query(
        "UPDATE command_center_reservation_preorders SET preorder_status='ordered',execution_order_id=$2 WHERE id=ANY($1::uuid[])",
        [quote.preorder_ids, order.id],
      );
    for (const line of quote.lines as Line[])
      await client.query(
        `INSERT INTO dine_in_order_items(venue_id,order_id,exchange_product_id,round_id,name,quantity,unit_price_minor,total_minor,item_type,source,menu_item_id,menu_version)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          qr.venue_id,
          order.id,
          line.itemType === "REGULAR_MENU" ? null : line.productId,
          line.roundId,
          line.name,
          line.quantity,
          line.unitPriceMinor,
          line.totalMinor,
          line.itemType ?? "EXCHANGE",
          line.itemType === "REGULAR_MENU" ? "regular_menu" : "exchange",
          line.itemType === "REGULAR_MENU" ? line.productId : null,
          line.menuVersion ?? null,
        ],
      );
    // Validate using wall clock after all locks and writes; never accept a stale round.
    const consumed = await client.query(
      "UPDATE dine_in_quotes SET consumed_at=clock_timestamp() WHERE id=$1 AND expires_at>clock_timestamp() RETURNING id",
      [quote.id],
    );
    if (!consumed.rowCount)
      throw new ApiError(409, "REQUOTE", "Цена истекла. Запросите новый расчёт");
    await event(
      client,
      order,
      staffActor ?? (owner.guestId ? `guest:${owner.guestId}` : "anonymous"),
      "created",
      {
        source: staffActor ? "staff" : quote.access_grant_id ? "table_code" : quote.order_source,
      },
    );
    await enqueue(client, order, "ORDER_ACCEPTED");
    return {
      order: await orderDetail(client, order.id, qr.venue_id),
      receiptToken,
      replayed: false,
    };
  });
}
export async function changeStatus(
  id: string,
  venueId: string,
  staffId: string,
  target?: OrderStatus,
  cancelReason?: string,
  manualPayment?: boolean,
  guestId?: string,
  cancellationRole: string = "manager",
) {
  return transaction(async (client) => {
    await loyaltyLock(client);
    await floorLock(client);
    const order = (
      await client.query("SELECT * FROM dine_in_orders WHERE id=$1 AND venue_id=$2 FOR UPDATE", [
        id,
        venueId,
      ])
    ).rows[0];
    if (!order) throw new ApiError(404, "NOT_FOUND", "Заказ не найден");
    const actor = `staff:${staffId}`;
    if (cancelReason) {
      if (order.status === "cancelled") return orderDetail(client, id, venueId);
      if (cancellationRole !== "manager" && (order.status !== "new" || order.manual_payment_at))
        throw new ApiError(
          403,
          "MANAGER_REQUIRED",
          "После принятия заказа или отметки оплаты отмену выполняет менеджер",
        );
      await reverseLoyalty(client, venueId, id);
      await client.query(
        "UPDATE dine_in_orders SET status='cancelled',updated_at=now() WHERE id=$1",
        [id],
      );
      await event(client, order, actor, "cancelled", { reason: cancelReason });
      await enqueue(client, order, "ORDER_CANCELLED");
    } else if (target && target !== order.status) {
      assertTransition(order.status, target);
      await client.query("UPDATE dine_in_orders SET status=$2,updated_at=now() WHERE id=$1", [
        id,
        target,
      ]);
      await event(client, order, actor, target);
    }
    if (
      manualPayment &&
      !cancelReason &&
      !order.manual_payment_at &&
      order.status !== "cancelled"
    ) {
      await client.query(
        "UPDATE dine_in_orders SET manual_payment_at=now(),manual_payment_by=$2,updated_at=now() WHERE id=$1",
        [id, staffId],
      );
      await event(client, order, actor, "manual_payment_received");
    }
    if (guestId) {
      if (order.guest_id)
        throw new ApiError(409, "GUEST_ALREADY_LINKED", "У заказа уже есть гость");
      const guest = (
        await client.query("SELECT id FROM hostess_guests WHERE id=$1 AND merged_into IS NULL", [
          guestId,
        ])
      ).rows[0];
      if (!guest) throw new ApiError(404, "GUEST_NOT_FOUND", "Профиль не найден");
      await client.query("UPDATE dine_in_orders SET guest_id=$2,updated_at=now() WHERE id=$1", [
        id,
        guestId,
      ]);
      await event(client, order, actor, "guest_linked", { guestId, retroactiveCashback: false });
    }
    await client.query(
      `UPDATE dining_sessions SET last_activity_at=clock_timestamp(),version=version+1 WHERE id=$1 AND closed_at IS NULL`,
      [order.dining_session_id],
    );
    return orderDetail(client, id, venueId);
  });
}
