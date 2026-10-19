import { beforeAll, afterAll, expect, test } from "bun:test";
import * as consumerFixture from "./contracts/hostess-schema";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
// Optional sibling checkout: validate the real current consumer, not just a copied schema.
const consumer = process.env.HOSTESS_CONSUMER_ROOT
  ? await import(
      pathToFileURL(resolve(process.env.HOSTESS_CONSUMER_ROOT, "src/lib/dine-in-api.ts")).href
    )
  : consumerFixture;
const { tableSchema, quoteSchema, orderSchema, walletSchema, transactionSchema } = consumer;
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { pool } from "../src/server/db/pool";
import { transaction, newSession } from "../src/server/guest/auth";
import { hash, randomToken } from "../src/server/guest/security";
import { handleBookingApi } from "../src/server/guest/api";
import { createQuote, checkout, changeStatus, type Owner } from "../src/server/dine-in/service";
import { wallets, walletView, loyaltyLock, mergeDiningGuest } from "../src/server/dine-in/loyalty";
import { drainOutbox } from "../src/server/dine-in/outbox";
import { saveMenuItem } from "../src/server/dine-in/menu";
import { claimAccess, issueAccess } from "../src/server/dine-in/access";
import { requestBooking, resolveBookingRequest } from "../src/server/dine-in/booking-requests";

if (
  !process.env.TEST_DINING_DATABASE_URL?.includes("127.0.0.1") ||
  process.env.DATABASE_URL !== process.env.TEST_DINING_DATABASE_URL
)
  throw new Error("Isolated local PostgreSQL required");
const productId = randomUUID(),
  roundId = randomUUID(),
  originalFetch = globalThis.fetch;
let table: { token: string; resource_id: string },
  venueId: string,
  legacy: string,
  counter = 0,
  unavailable = false,
  available = true,
  price = 1590,
  seconds = 600,
  outboxFail = false;
let invalidAck = false,
  permanentFailure = false,
  retryStatus = 0;
const staff: Record<string, string> = {},
  delivered: string[] = [];
let historicalOrderId: string;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (String(input).endsWith("/api/v1/public/snapshot")) {
    if (unavailable) throw new Error("offline");
    return Response.json({
      status: "ok",
      generatedAt: new Date().toISOString(),
      currentRound: { id: roundId, endsAt: new Date(Date.now() + seconds * 1000).toISOString() },
      products: [
        { id: productId, name: "Test drink", price, currency: "KZT", isAvailable: available },
      ],
    });
  }
  if (String(input).endsWith("/order-events")) {
    const payload = JSON.parse(String(init?.body));
    expect(Object.keys(payload).sort()).toEqual(
      [
        "eventId",
        "eventType",
        "orderId",
        "orderItemId",
        "exchangeProductId",
        "roundId",
        "quantity",
        "unitPrice",
        "occurredAt",
        "venueCode",
      ].sort(),
    );
    expect(payload.unitPrice).toBe("1590.00");
    expect(payload.roundId).toBe(roundId);
    delivered.push(payload.eventId);
    return Response.json(
      { accepted: !outboxFail && !invalidAck, eventId: payload.eventId },
      { status: retryStatus || (permanentFailure ? 400 : outboxFail ? 503 : 200) },
    );
  }
  return originalFetch(input, init);
}) as typeof fetch;
async function guest() {
  const id = (
    await pool.query(
      "INSERT INTO hostess_guests(name,phone,provisional) VALUES($1,$2,false) RETURNING id",
      ["Test " + ++counter, "+7701" + String(counter).padStart(7, "0")],
    )
  ).rows[0].id;
  return {
    id,
    cookie: (await transaction((c) => newSession(c, id))).split(";")[0],
    owner: { guestId: id, hash: hash("guest:" + id) } as Owner,
  };
}
const anon = (): Owner => ({ guestId: null, hash: hash(randomToken()) });
const quote = (owner: Owner, redeemMinor = 0) =>
  createQuote(owner, { qrToken: table.token, items: [{ productId, quantity: 3 }], redeemMinor });
const submit = async (owner: Owner, redeemMinor = 0) =>
  checkout(owner, { quoteId: (await quote(owner, redeemMinor)).id, idempotencyKey: randomToken() });
const balance = (id: string) =>
  transaction(async (c) => {
    await loyaltyLock(c);
    return walletView(c, venueId, id);
  });
async function lot(id: string, amount: number, days = 5) {
  return transaction(async (c) => {
    await loyaltyLock(c);
    const w = (await wallets(c, venueId, id))[0];
    const l = (
      await c.query(
        "INSERT INTO loyalty_lots(venue_id,wallet_id,earned_minor,remaining_minor,expires_at) VALUES($1,$2,$3,$3,now()+$4*interval '1 day') RETURNING id",
        [venueId, w.id, amount, days],
      )
    ).rows[0];
    await c.query(
      "INSERT INTO loyalty_transactions(venue_id,wallet_id,lot_id,type,amount_minor,operation_key) VALUES($1,$2,$3,'adjustment',$4,$5)",
      [venueId, w.id, l.id, amount, randomToken()],
    );
    return l.id;
  });
}
async function api(
  path: string,
  data?: unknown,
  opts: { method?: string; cookie?: string; receipt?: string; origin?: string } = {},
) {
  return (await handleBookingApi(
    new Request("https://command.test" + path, {
      method: opts.method ?? (data ? "POST" : "GET"),
      headers: {
        ...(path.startsWith("/api/guest/")
          ? {
              "x-hostess-service-key": process.env.HOSTESS_BFF_KEY!,
              "x-hostess-client-id": randomToken(),
            }
          : {}),
        ...(data
          ? { "content-type": "application/json", origin: opts.origin ?? "https://command.test" }
          : {}),
        ...(opts.cookie ? { cookie: opts.cookie } : {}),
        ...(opts.receipt ? { "x-hostess-receipt-token": opts.receipt } : {}),
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    }),
  ))!;
}
beforeAll(async () => {
  for (const file of [
    "0001_reservations.sql",
    "0002_reservation_tables.sql",
    "0003_guest_booking.sql",
    "0004_venue_inventory.sql",
    "0005_fix_normalized_resource_links.sql",
  ])
    await pool.query(
      readFileSync(new URL("../src/server/db/migrations/" + file, import.meta.url), "utf8"),
    );
  legacy = (
    await pool.query(
      "INSERT INTO command_center_reservations(guest_name,phone,guests,starts_at,table_id) VALUES('Legacy','+77010000000',2,now()+interval '30 days','A1') RETURNING id",
    )
  ).rows[0].id;
  await pool.query(
    readFileSync(new URL("../src/server/db/migrations/0006_dine_in.sql", import.meta.url), "utf8"),
  );
  table = (await pool.query("SELECT * FROM table_qr_codes LIMIT 1")).rows[0];
  await pool.query(
    readFileSync(
      new URL("../src/server/db/migrations/0007_physical_inventory_mapping.sql", import.meta.url),
      "utf8",
    ),
  );
  for (const file of readdirSync(new URL("../src/server/db/migrations/", import.meta.url))
    .filter((name) => name.endsWith(".sql") && name > "0007_physical_inventory_mapping.sql")
    .sort()) {
    if (file === "0010_regular_menu.sql") {
      const historic = await pool.query(
        `WITH visit AS (
        INSERT INTO dining_sessions(venue_id,resource_id,opened_at,closed_at,visit_status)
        SELECT venue_id,resource_id,now()-interval '2 days',now()-interval '1 day','released' FROM table_qr_codes LIMIT 1 RETURNING id,venue_id,resource_id
      ), quote AS (
        INSERT INTO dine_in_quotes(venue_id,qr_id,qr_generation,owner_hash,lines,round_id,subtotal_minor,discount_minor,payable_minor,cashback_minor,expires_at)
        SELECT venue_id,id,generation,'historical-owner','[]',$1,159000,0,159000,0,now()+interval '1 minute' FROM table_qr_codes LIMIT 1 RETURNING id,venue_id
      ), saved AS (
        INSERT INTO dine_in_orders(venue_id,table_resource_id,dining_session_id,quote_id,owner_hash,receipt_hash,idempotency_key,subtotal_minor,discount_minor,payable_minor,cashback_minor,payment_status,status)
        SELECT visit.venue_id,visit.resource_id,visit.id,quote.id,'historical-owner','historical-receipt','historical-key',159000,0,159000,0,'assumed_paid','closed' FROM visit JOIN quote ON quote.venue_id=visit.venue_id RETURNING id,venue_id
      ) INSERT INTO dine_in_order_items(venue_id,order_id,exchange_product_id,round_id,name,quantity,unit_price_minor,total_minor)
        SELECT venue_id,id,$2,$1,'Historical published drink',1,159000,159000 FROM saved RETURNING order_id`,
        [roundId, productId],
      );
      historicalOrderId = historic.rows[0].order_id;
    }
    await pool.query(
      readFileSync(new URL("../src/server/db/migrations/" + file, import.meta.url), "utf8"),
    );
  }
  venueId = (await pool.query("SELECT id FROM hostess_venues WHERE slug='xoxo'")).rows[0].id;
  for (const role of ["viewer", "operator", "manager"])
    staff[role] = (await transaction((c) => newSession(c, null, role, role))).split(";")[0];
});
afterAll(async () => {
  globalThis.fetch = originalFetch;
  await pool.end();
});

test("upgrade preserves legacy bookings and geometry", async () => {
  expect(
    (await pool.query("SELECT table_id FROM command_center_reservations WHERE id=$1", [legacy]))
      .rows[0].table_id,
  ).toBe("A1");
  expect((await pool.query("SELECT count(*)::int AS n FROM venue_layout")).rows[0].n).toBe(3);
});
test("17 independent resources, permanent bootstrap and real table API", async () => {
  const before = (await pool.query("SELECT token,resource_id FROM table_qr_codes ORDER BY token"))
    .rows;
  expect(before.length).toBe(17);
  expect(new Set(before.map((r) => r.resource_id)).size).toBe(17);
  await pool.query("SELECT hostess_bootstrap_qr()");
  expect(
    (await pool.query("SELECT token,resource_id FROM table_qr_codes ORDER BY token")).rows,
  ).toEqual(before);
  for (const row of before) {
    const r = await api("/api/guest/v1/dine-in/tables/" + row.token);
    expect(r.status).toBe(200);
    expect((await r.json()).resourceId).toBe(row.resource_id);
  }
});
test("anonymous owner cookie and per-order receipt capability", async () => {
  const r = await api("/api/guest/v1/dine-in/quotes", {
    qrToken: table.token,
    items: [{ productId, quantity: 1 }],
  });
  expect(r.status).toBe(201);
  const id = (await r.json()).id,
    cookie = r.headers.get("set-cookie")!.split(";")[0];
  expect(
    (await api("/api/guest/v1/dine-in/orders", { quoteId: id, idempotencyKey: randomToken() }))
      .status,
  ).toBe(401);
  const saved = await api(
    "/api/guest/v1/dine-in/orders",
    { quoteId: id, idempotencyKey: randomToken() },
    { cookie },
  );
  expect(saved.status).toBe(201);
  const result = await saved.json();
  expect(Number(result.order.cashbackMinor)).toBe(0);
  expect(result.order.guestPhone).toBeUndefined();
  expect((await api("/api/guest/v1/dine-in/orders/" + result.order.id)).status).toBe(404);
  expect(
    (
      await api("/api/guest/v1/dine-in/orders/" + result.order.id, undefined, {
        receipt: result.receiptToken,
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await api("/api/guest/v1/dine-in/orders/" + randomUUID(), undefined, {
        receipt: result.receiptToken,
      })
    ).status,
  ).toBe(404);
});
test("authenticated 3 percent earning lasts exactly 14 days", async () => {
  const g = await guest(),
    o = await submit(g.owner);
  expect(Number(o.order.cashbackMinor)).toBe(14300);
  expect((await balance(g.id)).balanceMinor).toBe(14300);
  expect(
    (
      await pool.query(
        "SELECT extract(epoch FROM expires_at-created_at)::int AS ttl FROM loyalty_lots WHERE order_id=$1",
        [o.order.id],
      )
    ).rows[0].ttl,
  ).toBe(14 * 86400);
  expect((await api("/api/guest/v1/loyalty/wallet", undefined, { cookie: g.cookie })).status).toBe(
    200,
  );
});
test("FIFO partial redemption across lots and post-discount cashback", async () => {
  const g = await guest(),
    a = await lot(g.id, 60000, 2),
    b = await lot(g.id, 80000, 4),
    o = await submit(g.owner, 100000);
  expect(Number(o.order.payableMinor)).toBe(377000);
  expect(Number(o.order.cashbackMinor)).toBe(11300);
  expect(
    Number(
      (await pool.query("SELECT remaining_minor FROM loyalty_lots WHERE id=$1", [a])).rows[0]
        .remaining_minor,
    ),
  ).toBe(0);
  expect(
    Number(
      (await pool.query("SELECT remaining_minor FROM loyalty_lots WHERE id=$1", [b])).rows[0]
        .remaining_minor,
    ),
  ).toBe(40000);
});
test("expired balance excluded without cron; fully redeemed earns zero", async () => {
  const g = await guest();
  await lot(g.id, 50000, -1);
  expect((await balance(g.id)).balanceMinor).toBe(0);
  await lot(g.id, 477000);
  const o = await submit(g.owner, 477000);
  expect(Number(o.order.payableMinor)).toBe(0);
  expect(Number(o.order.cashbackMinor)).toBe(0);
});
test("two devices cannot double-spend", async () => {
  const g = await guest();
  await lot(g.id, 477000);
  const a = await quote(g.owner, 477000),
    b = await quote(g.owner, 477000);
  const r = await Promise.allSettled([
    checkout(g.owner, { quoteId: a.id, idempotencyKey: randomToken() }),
    checkout(g.owner, { quoteId: b.id, idempotencyKey: randomToken() }),
  ]);
  expect(r.filter((x) => x.status === "fulfilled").length).toBe(1);
  expect((await balance(g.id)).balanceMinor).toBe(0);
});
test("parallel repeat submit creates one order, one earn; key scope enforced", async () => {
  const g = await guest(),
    q = await quote(g.owner),
    input = { quoteId: q.id, idempotencyKey: randomToken() },
    r = await Promise.all([checkout(g.owner, input), checkout(g.owner, input)]);
  expect(r[0].order.id).toBe(r[1].order.id);
  expect(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM loyalty_transactions WHERE order_id=$1 AND type='earn'",
        [r[0].order.id],
      )
    ).rows[0].n,
  ).toBe(1);
  const conflictingQuote = await quote(g.owner);
  await expect(
    checkout(g.owner, { quoteId: conflictingQuote.id, idempotencyKey: input.idempotencyKey }),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
});
test("expired quote requires requote; foreign owner cannot consume", async () => {
  const owner = anon(),
    q = await quote(owner);
  await expect(
    checkout(anon(), { quoteId: q.id, idempotencyKey: randomToken() }),
  ).rejects.toMatchObject({ code: "QUOTE_NOT_FOUND" });
  await pool.query(
    "UPDATE dine_in_quotes SET created_at=now()-interval '5 minutes',expires_at=now()-interval '1 second' WHERE id=$1",
    [q.id],
  );
  await expect(
    checkout(owner, { quoteId: q.id, idempotencyKey: randomToken() }),
  ).rejects.toMatchObject({ code: "REQUOTE" });
});
test("exchange failure, round boundary and disabled product fail closed", async () => {
  unavailable = true;
  await expect(quote(anon())).rejects.toMatchObject({ code: "EXCHANGE_UNAVAILABLE" });
  unavailable = false;
  seconds = 3;
  await expect(quote(anon())).rejects.toMatchObject({ code: "REQUOTE" });
  seconds = 600;
  available = false;
  await expect(quote(anon())).rejects.toMatchObject({ code: "PRODUCT_UNAVAILABLE" });
  available = true;
});
test("accepted snapshot immutable and never repriced", async () => {
  const owner = anon(),
    q = await quote(owner);
  price = 990;
  const o = await checkout(owner, { quoteId: q.id, idempotencyKey: randomToken() });
  price = 1590;
  expect(Number(o.order.subtotalMinor)).toBe(477000);
  await expect(
    pool.query(
      "UPDATE dine_in_orders SET payable_minor=1,discount_minor=subtotal_minor-1 WHERE id=$1",
      [o.order.id],
    ),
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    pool.query("UPDATE dine_in_order_items SET name='changed' WHERE order_id=$1", [o.order.id]),
  ).rejects.toMatchObject({ code: "23514" });
});
test("failure after wallet writes rolls back whole checkout", async () => {
  const g = await guest();
  await lot(g.id, 100000);
  const q = await quote(g.owner, 100000);
  await pool.query("UPDATE dine_in_quotes SET lines=lines||lines WHERE id=$1", [q.id]);
  await expect(
    checkout(g.owner, { quoteId: q.id, idempotencyKey: randomToken() }),
  ).rejects.toBeDefined();
  expect((await balance(g.id)).balanceMinor).toBe(100000);
  expect(
    (await pool.query("SELECT count(*)::int AS n FROM dine_in_orders WHERE quote_id=$1", [q.id]))
      .rows[0].n,
  ).toBe(0);
});
test("cancellation compensates once, preserves original expiry and outbox uniqueness", async () => {
  const g = await guest(),
    a = await lot(g.id, 100000),
    o = await submit(g.owner, 100000),
    expiry = (await pool.query("SELECT expires_at FROM loyalty_lots WHERE id=$1", [a])).rows[0]
      .expires_at;
  await changeStatus(o.order.id, venueId, "manager", undefined, "Cancel once");
  await changeStatus(o.order.id, venueId, "manager", undefined, "Cancel twice");
  expect((await balance(g.id)).balanceMinor).toBe(100000);
  expect(
    (await pool.query("SELECT expires_at FROM loyalty_lots WHERE id=$1", [a])).rows[0].expires_at,
  ).toEqual(expiry);
  expect(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM integration_outbox WHERE order_id=$1 AND event_type='ORDER_CANCELLED'",
        [o.order.id],
      )
    ).rows[0].n,
  ).toBe(1);
});
test("restored expired redemption cannot receive a new lifetime", async () => {
  const g = await guest(),
    a = await lot(g.id, 100000),
    o = await submit(g.owner, 100000);
  await pool.query("UPDATE loyalty_lots SET expires_at=now()-interval '1 day' WHERE id=$1", [a]);
  await changeStatus(o.order.id, venueId, "manager", undefined, "Expired redemption");
  expect((await balance(g.id)).balanceMinor).toBe(0);
});
test("spent cashback source cancellation creates debt; dependent cancellation compensates", async () => {
  const g = await guest(),
    a = await submit(g.owner),
    b = await submit(g.owner, 14300);
  await changeStatus(a.order.id, venueId, "manager", undefined, "Cancel source");
  expect((await balance(g.id)).debtMinor).toBe(14300);
  await changeStatus(b.order.id, venueId, "manager", undefined, "Cancel dependent");
  expect((await balance(g.id)).debtMinor).toBe(0);
  expect((await balance(g.id)).balanceMinor).toBe(0);
});
test("naturally expired cashback produces no debt on cancellation", async () => {
  const g = await guest(),
    o = await submit(g.owner);
  await pool.query("UPDATE loyalty_lots SET expires_at=now()-interval '1 day' WHERE order_id=$1", [
    o.order.id,
  ]);
  await submit(g.owner);
  await changeStatus(o.order.id, venueId, "manager", undefined, "Expired source");
  expect((await balance(g.id)).debtMinor).toBe(0);
});
test("immutable ledger rejects deletion", async () => {
  const row = (await pool.query("SELECT id FROM loyalty_transactions LIMIT 1")).rows[0];
  await expect(
    pool.query("DELETE FROM loyalty_transactions WHERE id=$1", [row.id]),
  ).rejects.toMatchObject({ code: "23514" });
});
test("staff guest CRUD normalizes KZ phone, provisional state and duplicate protection", async () => {
  const r = await api(
    "/api/staff/v1/guests",
    { name: "Manual", phone: "8 (701) 987-65-43" },
    { cookie: staff.operator },
  );
  expect(r.status).toBe(201);
  const g = (await r.json()).guest;
  expect(g.phone).toBe("+77019876543");
  expect(g.provisional).toBe(true);
  expect(g.source).toBe("staff");
  expect(
    (
      await api(
        "/api/staff/v1/guests",
        { name: "Duplicate", phone: g.phone },
        { cookie: staff.manager },
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await api(
        "/api/staff/v1/guests/" + g.id,
        { name: "Edited", phone: g.phone },
        { method: "PATCH", cookie: staff.operator },
      )
    ).status,
  ).toBe(200);
});
test("typed phone cannot claim existing wallet", async () => {
  const g = (
    await pool.query(
      "INSERT INTO hostess_guests(name,phone,source) VALUES('Staff','+77015554433','staff') RETURNING id",
    )
  ).rows[0];
  await lot(g.id, 99900);
  const r = await api("/api/guest/v1/bootstrap", {
      name: "Someone",
      phone: "+77015554433",
      consent: true,
    }),
    cookie = r.headers.get("set-cookie")!.split(";")[0];
  expect(
    (await (await api("/api/guest/v1/loyalty/wallet", undefined, { cookie })).json()).balanceMinor,
  ).toBe(0);
});
test("staff RBAC and exact origin are preserved", async () => {
  const o = await submit(anon());
  for (const cookie of [staff.viewer, staff.operator])
    expect(
      (
        await api(
          "/api/staff/v1/tables/" + table.resource_id + "/qr/rotate",
          { confirm: true },
          { cookie },
        )
      ).status,
    ).toBe(403);
  expect(
    (
      await api(
        "/api/staff/v1/guests",
        { name: "Blocked", phone: "+77019990000" },
        { cookie: staff.viewer },
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await api(
        "/api/staff/v1/dine-in/orders/" + o.order.id + "/cancel",
        { reason: "No rights" },
        { cookie: staff.operator },
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await api(
        "/api/staff/v1/dine-in/orders/" + o.order.id + "/status",
        { status: "accepted" },
        { cookie: staff.operator, origin: "https://evil.test", method: "PATCH" },
      )
    ).status,
  ).toBe(403);
});
test("service sequence, manual payment and guest linking", async () => {
  const o = await submit(anon()),
    g = await guest();
  await changeStatus(o.order.id, venueId, "operator", undefined, undefined, undefined, g.id);
  expect((await balance(g.id)).balanceMinor).toBe(0);
  for (const state of ["accepted", "preparing", "delivered", "closed"] as const)
    await changeStatus(o.order.id, venueId, "operator", state);
  const r = await changeStatus(o.order.id, venueId, "operator", undefined, undefined, true);
  expect(r.manualPaymentAt).not.toBeNull();
  expect(r.paymentStatus).toBe("assumed_paid");
  await expect(changeStatus(o.order.id, venueId, "operator", "accepted")).rejects.toMatchObject({
    code: "INVALID_TRANSITION",
  });
});
test("canonical merge preserves lots, immutable ledger and order references", async () => {
  const p = await guest(),
    c = await guest();
  await pool.query("UPDATE hostess_guests SET provisional=true WHERE id=$1", [p.id]);
  await lot(p.id, 50000);
  await lot(c.id, 60000);
  const o = await submit(p.owner),
    count = (await pool.query("SELECT count(*)::int AS n FROM loyalty_transactions")).rows[0].n;
  await transaction((db) => mergeDiningGuest(db, p.id, c.id));
  expect((await balance(c.id)).balanceMinor).toBe(124300);
  expect(
    (await pool.query("SELECT guest_id FROM dine_in_orders WHERE id=$1", [o.order.id])).rows[0]
      .guest_id,
  ).toBe(c.id);
  expect((await pool.query("SELECT count(*)::int AS n FROM loyalty_transactions")).rows[0].n).toBe(
    count,
  );
});
test("cross-venue resource link violates composite foreign key", async () => {
  const v = (
    await pool.query(
      "INSERT INTO hostess_venues(slug,display_name) VALUES('other','Other') RETURNING id",
    )
  ).rows[0];
  await expect(
    pool.query("INSERT INTO table_qr_codes(venue_id,resource_id,token) VALUES($1,$2,$3)", [
      v.id,
      table.resource_id,
      randomToken(),
    ]),
  ).rejects.toMatchObject({ code: "23503" });
});
test("rotation invalidates old link/quote; SVG, PNG, ZIP and print are downloadable", async () => {
  const old = table.token,
    owner = anon(),
    q = await quote(owner);
  expect(
    (
      await api(
        "/api/staff/v1/tables/" + table.resource_id + "/qr/rotate",
        { confirm: true },
        { cookie: staff.manager },
      )
    ).status,
  ).toBe(200);
  expect((await api("/api/guest/v1/dine-in/tables/" + old)).status).toBe(404);
  await expect(
    checkout(owner, { quoteId: q.id, idempotencyKey: randomToken() }),
  ).rejects.toMatchObject({ code: "TABLE_DISABLED" });
  table.token = (
    await pool.query("SELECT token FROM table_qr_codes WHERE resource_id=$1", [table.resource_id])
  ).rows[0].token;
  for (const [path, type] of [
    ["/tables/" + table.resource_id + "/qr.svg", "image/svg+xml"],
    ["/tables/" + table.resource_id + "/qr.png", "image/png"],
    ["/tables/qr/export.zip", "application/zip"],
    ["/tables/qr/print", "text/html; charset=utf-8"],
  ]) {
    const r = await api("/api/staff/v1" + path, undefined, { cookie: staff.viewer });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe(type);
  }
});
test("disabled QR rejects new quotes", async () => {
  await pool.query("UPDATE table_qr_codes SET enabled=false WHERE resource_id=$1", [
    table.resource_id,
  ]);
  await expect(quote(anon())).rejects.toMatchObject({ code: "TABLE_DISABLED" });
  await pool.query("UPDATE table_qr_codes SET enabled=true WHERE resource_id=$1", [
    table.resource_id,
  ]);
});
test("outbox retries stable IDs and orders acceptance before cancellation", async () => {
  const o = await submit(anon());
  await changeStatus(o.order.id, venueId, "manager", undefined, "Outbox fixture");
  process.env.DINE_IN_OUTBOX_ENABLED = "yes";
  outboxFail = true;
  for (let i = 0; i < 20; i++) await drainOutbox();
  const row = (
    await pool.query(
      "SELECT id,status FROM integration_outbox WHERE order_id=$1 AND event_type='ORDER_ACCEPTED'",
      [o.order.id],
    )
  ).rows[0];
  expect(row.status).toBe("failed");
  await pool.query("UPDATE integration_outbox SET next_attempt_at=now() WHERE status='failed'");
  outboxFail = false;
  for (let i = 0; i < 20; i++) await drainOutbox();
  expect(
    (
      await pool.query("SELECT status FROM integration_outbox WHERE order_id=$1", [o.order.id])
    ).rows.every((r) => r.status === "delivered"),
  ).toBe(true);
  expect(delivered.filter((id) => id === row.id).length).toBeGreaterThanOrEqual(2);
  process.env.DINE_IN_OUTBOX_ENABLED = "no";
});

test("verified WhatsApp unifies staff-created profile without a typed-phone claim", async () => {
  const phone = "+77016660011",
    jid = "77016660011@c.us";
  const response = await api(
    "/api/staff/v1/guests",
    { name: "Staff verified merge", phone },
    { cookie: staff.manager },
  );
  expect(response.status).toBe(201);
  const manual = (await response.json()).guest;
  await lot(manual.id, 50000);
  const order = await submit(anon());
  await changeStatus(
    order.order.id,
    venueId,
    "manager",
    undefined,
    undefined,
    undefined,
    manual.id,
  );
  const wa = () =>
    handleBookingApi(
      new Request("https://command.test/api/guest/v1/identity", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hostess-service-key": process.env.WHATSAPP_SERVICE_KEY!,
          "x-whatsapp-sender-jid": jid,
        },
        body: JSON.stringify({ name: "Verified owner", jid, consent: true }),
      }),
    );
  const verified = (await (await wa())!.json()).guestId;
  expect((await balance(verified)).balanceMinor).toBe(50000);
  expect(
    (await pool.query("SELECT merged_into FROM hostess_guests WHERE id=$1", [manual.id])).rows[0]
      .merged_into,
  ).toBe(verified);
  expect(
    (await pool.query("SELECT guest_id FROM dine_in_orders WHERE id=$1", [order.order.id])).rows[0]
      .guest_id,
  ).toBe(verified);
  expect((await (await wa())!.json()).guestId).toBe(verified);
  expect((await balance(verified)).balanceMinor).toBe(50000);
});
test("outbox requires accepted ACK and retains permanent failures until manager retry", async () => {
  const o = await submit(anon());
  process.env.DINE_IN_OUTBOX_ENABLED = "yes";
  invalidAck = true;
  for (let i = 0; i < 20; i++) await drainOutbox();
  let row = (await pool.query("SELECT * FROM integration_outbox WHERE order_id=$1", [o.order.id]))
    .rows[0];
  expect(row.status).toBe("failed");
  expect(row.last_error).toBe("INVALID_ACK");
  expect(row.terminal).toBe(false);
  invalidAck = false;
  permanentFailure = true;
  await pool.query("UPDATE integration_outbox SET next_attempt_at=now() WHERE order_id=$1", [
    o.order.id,
  ]);
  await drainOutbox();
  row = (await pool.query("SELECT * FROM integration_outbox WHERE order_id=$1", [o.order.id]))
    .rows[0];
  expect(row.terminal).toBe(true);
  expect(
    (
      await api(
        "/api/staff/v1/dine-in/outbox/retry",
        { reason: "Retry fixture" },
        { cookie: staff.operator },
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await api(
        "/api/staff/v1/dine-in/outbox/retry",
        { reason: "Corrected receiver" },
        { cookie: staff.manager },
      )
    ).status,
  ).toBe(200);
  permanentFailure = false;
  for (let i = 0; i < 20; i++) await drainOutbox();
  expect(
    (await pool.query("SELECT status FROM integration_outbox WHERE order_id=$1", [o.order.id]))
      .rows[0].status,
  ).toBe("delivered");
  process.env.DINE_IN_OUTBOX_ENABLED = "no";
});

test("actual Hostess frontend schema accepts table, quote, order, receipt, wallet and history", async () => {
  const g = await guest();
  await lot(g.id, 100000);
  const tableResult = await (await api("/api/guest/v1/dine-in/tables/" + table.token)).json();
  expect(tableSchema.parse(tableResult).table.resourceId).toBe(table.resource_id);
  const qResponse = await api(
    "/api/guest/v1/dine-in/quotes",
    { qrToken: table.token, items: [{ productId, quantity: 3 }], redeemAmount: 1000 },
    { cookie: g.cookie },
  );
  expect(qResponse.status).toBe(201);
  const q = quoteSchema.parse(await qResponse.json());
  expect(q.subtotal).toBe(4770);
  expect(q.discount).toBe(1000);
  expect(q.payable).toBe(3770);
  expect(q.cashback).toBe(113);
  const response = await api(
    "/api/guest/v1/dine-in/orders",
    { quoteId: q.id, idempotencyKey: randomToken() },
    { cookie: g.cookie },
  );
  expect(response.status).toBe(201);
  const o = orderSchema.parse((await response.json()).order);
  expect(o.venueCode).toBe("xoxo");
  expect(o.lines[0].unitPrice).toBe(1590);
  expect(o.cashback).toBe(113);
  expect(o.receiptToken).toBeDefined();
  const receipt = await api(
    "/api/guest/v1/dine-in/orders/" + o.id + "?receiptToken=" + o.receiptToken,
  );
  expect(receipt.status).toBe(200);
  expect(orderSchema.parse((await receipt.json()).order).id).toBe(o.id);
  const wallet = walletSchema.parse(
    await (await api("/api/guest/v1/loyalty/wallet", undefined, { cookie: g.cookie })).json(),
  );
  expect(wallet.balance).toBe(113);
  expect(wallet.lots.length).toBe(1);
  const transactions = (
    await (await api("/api/guest/v1/loyalty/transactions", undefined, { cookie: g.cookie })).json()
  ).transactions;
  expect(transactions.every((t: unknown) => transactionSchema.safeParse(t).success)).toBe(true);
  const history = await (
    await api("/api/guest/v1/dine-in/orders", undefined, { cookie: g.cookie })
  ).json();
  expect(history.orders.some((item: unknown) => orderSchema.parse(item).id === o.id)).toBe(true);
});

test("staff CRM writes preserve authorization with QR feature disabled", async () => {
  process.env.DINE_IN_ENABLED = "no";
  try {
    const data = { name: "CRM without QR", phone: "+77017778890" };
    expect((await api("/api/staff/v1/guests", data)).status).toBe(401);
    expect((await api("/api/staff/v1/guests", data, { cookie: staff.viewer })).status).toBe(403);
    expect(
      (
        await api("/api/staff/v1/guests", data, {
          cookie: staff.operator,
          origin: "https://foreign.test",
        })
      ).status,
    ).toBe(403);
    const created = await api("/api/staff/v1/guests", data, { cookie: staff.operator });
    expect(created.status).toBe(201);
    const id = (await created.json()).guest.id;
    expect(
      (
        await api(
          "/api/staff/v1/guests/" + id,
          { ...data, name: "Edited without QR" },
          { method: "PATCH", cookie: staff.operator },
        )
      ).status,
    ).toBe(200);
    expect((await api("/api/guest/v1/dine-in/tables/" + table.token)).status).toBe(503);
  } finally {
    process.env.DINE_IN_ENABLED = "yes";
  }
});

test("terminal orders retain visit and idle unconfirmed session expires before a new visit", async () => {
  const a = await submit(anon()),
    b = await submit(anon());
  const sessionId = async (id: string) =>
    (await pool.query("SELECT dining_session_id AS id FROM dine_in_orders WHERE id=$1", [id]))
      .rows[0].id;
  const first = await sessionId(a.order.id);
  expect(await sessionId(b.order.id)).toBe(first);
  const open = (
    await pool.query(
      "SELECT id FROM dine_in_orders WHERE dining_session_id=$1 AND status NOT IN('closed','cancelled')",
      [first],
    )
  ).rows;
  for (const row of open.filter((r) => r.id !== b.order.id))
    await changeStatus(row.id, venueId, "manager", undefined, "Finish test visit");
  expect(
    (await pool.query("SELECT closed_at FROM dining_sessions WHERE id=$1", [first])).rows[0]
      .closed_at,
  ).toBeNull();
  const last = b.order.id;
  for (const target of ["accepted", "preparing", "delivered", "closed"] as const)
    await changeStatus(last, venueId, "manager", target);
  expect(
    (await pool.query("SELECT closed_at FROM dining_sessions WHERE id=$1", [first])).rows[0]
      .closed_at,
  ).toBeNull();
  await pool.query(
    "UPDATE dining_sessions SET last_activity_at=now()-interval '31 minutes' WHERE id=$1",
    [first],
  );
  const next = await submit(anon());
  expect(await sessionId(next.order.id)).not.toBe(first);
  expect(
    (await pool.query("SELECT visit_status FROM dining_sessions WHERE id=$1", [first])).rows[0]
      .visit_status,
  ).toBe("expired");
});

test("cancel and manual payment in one service operation cannot mark a cancelled order paid", async () => {
  const o = await submit(anon());
  const result = await changeStatus(
    o.order.id,
    venueId,
    "manager",
    undefined,
    "Cancellation wins",
    true,
  );
  expect(result.status).toBe("cancelled");
  expect(result.manualPaymentAt).toBeNull();
});

test("verified physical alias protects legacy, WhatsApp and normalized competing bookings while QR ordering remains independent", async () => {
  const resource = table.resource_id;
  // Prior checkout fixtures may leave an open visit. End those fixture visits
  // before testing a new physical relationship; production reconfiguration
  // correctly refuses to detach an active visit from its physical aliases.
  await pool.query(
    "UPDATE dining_sessions SET closed_at=now(),visit_status='released' WHERE resource_id=$1 AND closed_at IS NULL",
    [resource],
  );
  await expect(
    pool.query("UPDATE venue_resources SET is_reservable=true,capacity=6 WHERE id=$1", [resource]),
  ).rejects.toMatchObject({ code: "23514" });
  const config = { legacyCode: "A1", verified: true, reason: "Isolated fixture owner survey" };
  const path = "/api/staff/v1/tables/" + resource + "/mapping";
  expect((await api(path, config, { method: "PATCH", cookie: staff.operator })).status).toBe(403);
  expect((await api(path, config, { method: "PATCH", cookie: staff.manager })).status).toBe(409);
  await pool.query("UPDATE command_center_reservations SET status='cancelled' WHERE id=$1", [
    legacy,
  ]);
  expect((await api(path, config, { method: "PATCH", cookie: staff.manager })).status).toBe(200);
  await pool.query("UPDATE venue_resources SET is_reservable=true,capacity=6 WHERE id=$1", [
    resource,
  ]);
  const bookingDay = new Date(Date.now() + 86400000 * 20);
  const bookingStart = Date.UTC(
    bookingDay.getUTCFullYear(),
    bookingDay.getUTCMonth(),
    bookingDay.getUTCDate(),
    14,
  );
  const startsAt = new Date(bookingStart).toISOString(),
    endsAt = new Date(bookingStart + 7200000).toISOString();
  const jid = "77015550066@c.us";
  const wa = async (suffix: string, data?: unknown) =>
    (await handleBookingApi(
      new Request("https://command.test/api/guest/v1" + suffix, {
        method: data ? "POST" : "GET",
        headers: {
          "content-type": "application/json",
          "x-hostess-service-key": process.env.WHATSAPP_SERVICE_KEY!,
          "x-whatsapp-sender-jid": jid,
        },
        ...(data ? { body: JSON.stringify(data) } : {}),
      }),
    ))!;
  const identity = await (
    await wa("/identity", { name: "Physical fixture", jid, consent: true })
  ).json();
  const results = await Promise.all([
    wa("/reservations", {
      guestId: identity.guestId,
      selection: { startsAt, endsAt, guests: 2, resourceId: resource },
      idempotencyKey: randomToken(),
    }),
    wa("/reservations", {
      guestId: identity.guestId,
      selection: { startsAt, endsAt, guests: 2, tableIds: ["A1"] },
      idempotencyKey: randomToken(),
    }),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  const availability = await (
    await wa(
      `/availability?startsAt=${encodeURIComponent(startsAt)}&endsAt=${encodeURIComponent(endsAt)}&guests=2`,
    )
  ).json();
  expect(availability.tables.find((t: { id: string }) => t.id === "A1").available).toBe(false);
  expect(availability.resources.find((r: { id: string }) => r.id === resource).available).toBe(
    false,
  );
  // QR checkout never creates/reschedules a reservation, including for an occupied resource.
  await pool.query(
    "UPDATE command_center_reservations SET starts_at=now()-interval '30 minutes',ends_at=now()+interval '1 hour' WHERE guest_id=$1",
    [identity.guestId],
  );
  expect((await submit(anon())).order.tableCode).toBeDefined();
  expect(
    (
      await api(
        path,
        { legacyCode: null, verified: false, reason: "Attempt reconfiguration" },
        { method: "PATCH", cookie: staff.manager },
      )
    ).status,
  ).toBe(409);
});

test.skipIf(!process.env.HOSTESS_REPOSITORY || !process.env.XOXO_REPOSITORY)(
  "real sibling main schemas and Hostess BFF complete anonymous checkout with cookie and receipt isolation",
  async () => {
    const hostessRoot = process.env.HOSTESS_REPOSITORY!;
    const xoxoRoot = process.env.XOXO_REPOSITORY!;
    const consumer = await import(
      pathToFileURL(resolve(hostessRoot, "src/lib/dine-in-api.ts")).href
    );
    const { proxyHostessApi } = await import(
      pathToFileURL(resolve(hostessRoot, "src/lib/server/guest-proxy.ts")).href
    );
    const receiver = await import(
      pathToFileURL(resolve(xoxoRoot, "src/modules/command-center/order-events.service.ts")).href
    );
    const backendFetch = globalThis.fetch;
    const runtime = {
      BOOKING_API_ORIGIN: "https://command.test",
      HOSTESS_BFF_KEY: process.env.HOSTESS_BFF_KEY,
    };
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith("https://command.test/")) {
        expect(new Headers(init?.headers).get("cookie") ?? "").not.toContain("hostess-staff");
        return (await handleBookingApi(new Request(input, init)))!;
      }
      return backendFetch(input, init);
    }) as typeof fetch;
    const bff = (path: string, data?: unknown, cookie?: string) =>
      proxyHostessApi(
        new Request("https://hostes.online/api/guest/v1" + path, {
          method: data ? "POST" : "GET",
          headers: {
            ...(data
              ? { "content-type": "application/json", origin: "https://hostes.online" }
              : {}),
            ...(cookie ? { cookie } : {}),
          },
          ...(data ? { body: JSON.stringify(data) } : {}),
        }),
        runtime,
      );
    try {
      consumer.tableSchema.parse(await (await bff("/dine-in/tables/" + table.token))!.json());
      const qr = await bff("/dine-in/quotes", {
        qrToken: table.token,
        items: [{ productId, quantity: 3 }],
        redeemAmount: 0,
      });
      expect(qr!.status).toBe(201);
      const cookie = qr!.headers.get("set-cookie")!.split(";")[0];
      expect(qr!.headers.get("set-cookie")).toContain("HttpOnly");
      const q = consumer.quoteSchema.parse(await qr!.json());
      const saved = await bff(
        "/dine-in/orders",
        { quoteId: q.id, idempotencyKey: randomToken() },
        cookie + "; __Host-hostess-staff=" + randomToken(),
      );
      expect(saved!.status).toBe(201);
      const order = consumer.orderSchema.parse((await saved!.json()).order);
      const receipt = await bff(`/dine-in/orders/${order.id}?receiptToken=${order.receiptToken}`);
      expect(receipt!.status).toBe(200);
      expect((await receipt!.json()).order.guestPhone).toBeUndefined();
      expect((await bff("/dine-in/orders/" + order.id))!.status).toBe(404);
      const rows = (
        await pool.query("SELECT id,payload FROM integration_outbox WHERE order_id=$1", [order.id])
      ).rows;
      const { orderEventPayload } = await import("../src/server/dine-in/outbox");
      for (const row of rows)
        expect(
          receiver.orderEventSchema.parse(orderEventPayload(row.id, row.payload)).unitPrice,
        ).toBe("1590.00");
    } finally {
      globalThis.fetch = backendFetch;
    }
  },
);

test("outbox retains 429/5xx for retry and recovers an expired delivery lease", async () => {
  const o = await submit(anon());
  const id = (await pool.query("SELECT id FROM integration_outbox WHERE order_id=$1", [o.order.id]))
    .rows[0].id;
  process.env.DINE_IN_OUTBOX_ENABLED = "yes";
  try {
    for (const status of [429, 500, 503]) {
      retryStatus = status;
      await pool.query("UPDATE integration_outbox SET next_attempt_at=now() WHERE id=$1", [id]);
      await drainOutbox();
      const row = (
        await pool.query(
          "SELECT status,terminal,last_error,next_attempt_at>now() AS backoff FROM integration_outbox WHERE id=$1",
          [id],
        )
      ).rows[0];
      expect(row).toMatchObject({
        status: "failed",
        terminal: false,
        last_error: `HTTP_${status}`,
        backoff: true,
      });
    }
    retryStatus = 0;
    await pool.query(
      "UPDATE integration_outbox SET status='delivering',locked_until=now()-interval '1 second',lease_token=$2 WHERE id=$1",
      [id, randomUUID()],
    );
    await drainOutbox();
    expect(
      (await pool.query("SELECT status FROM integration_outbox WHERE id=$1", [id])).rows[0].status,
    ).toBe("delivered");
    expect(delivered.filter((eventId) => eventId === id).length).toBe(4);
  } finally {
    retryStatus = 0;
    process.env.DINE_IN_OUTBOX_ENABLED = "no";
  }
});

test("regular menu migration preserves historical exchange identity and prices", async () => {
  const row = (
    await pool.query(
      "SELECT source,item_type,exchange_product_id,round_id,unit_price_minor::text,menu_item_id FROM dine_in_order_items WHERE order_id=$1",
      [historicalOrderId],
    )
  ).rows[0];
  expect(row).toMatchObject({
    source: "exchange",
    item_type: "EXCHANGE",
    exchange_product_id: productId,
    round_id: roundId,
    unit_price_minor: "159000",
    menu_item_id: null,
  });
});

const managerSession = { guest_id: null, staff_id: "manager", role: "manager" as const };
const dishInput = {
  name: "Verified test dish",
  description: "Real fixture ingredients",
  category: "Kitchen",
  priceMinor: 245050,
  isAvailable: true,
  published: true,
  imageUrl: "https://example.test/dish.webp",
  portion: "250 g",
  allergens: ["Milk"],
};
const dish = () => saveMenuItem(venueId, managerSession, dishInput);

test("published menu survives API reload, rejects stale edits and enforces manager plus exact origin", async () => {
  const path = "/api/staff/v1/dine-in/menu-items";
  expect((await api(path, dishInput, { cookie: staff.viewer })).status).toBe(403);
  expect((await api(path, dishInput, { cookie: staff.operator })).status).toBe(403);
  expect(
    (await api(path, dishInput, { cookie: staff.manager, origin: "https://foreign.test" })).status,
  ).toBe(403);
  const saved = await api(path, { ...dishInput, published: false }, { cookie: staff.manager });
  expect(saved.status).toBe(201);
  const item = (await saved.json()).item;
  const publicCatalog = async () =>
    await (await api("/api/guest/v1/dine-in/regular-menu?venue=xoxo")).json();
  expect((await publicCatalog()).items.some((row: { id: string }) => row.id === item.id)).toBe(
    false,
  );
  expect(
    (
      await api(
        `${path}/${item.id}`,
        { ...dishInput, version: 1 },
        { cookie: staff.manager, method: "PATCH" },
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await api(
        `${path}/${item.id}`,
        { ...dishInput, version: 1 },
        { cookie: staff.manager, method: "PATCH" },
      )
    ).status,
  ).toBe(409);
  expect(
    (await publicCatalog()).items.find((row: { id: string }) => row.id === item.id),
  ).toMatchObject({
    price: 2450.5,
    priceMinor: "245050",
    version: 2,
    portion: "250 g",
    allergens: ["Milk"],
  });
  expect((await api(path, undefined, { cookie: staff.viewer })).status).toBe(200);
});

test("regular-only anonymous checkout stays available while exchange is offline and creates no market demand", async () => {
  const item = await dish(),
    owner = anon();
  unavailable = true;
  try {
    const q = await createQuote(owner, {
      qrToken: table.token,
      items: [{ productId: item.id, quantity: 2, itemType: "REGULAR_MENU" }],
    });
    expect(q.roundId).toBeNull();
    expect(q.subtotalMinor).toBe(490100);
    const saved = await checkout(owner, { quoteId: q.id, idempotencyKey: randomToken() });
    expect(saved.order.cashbackMinor).toBe("0");
    expect(saved.order.items[0]).toMatchObject({
      productId: item.id,
      itemType: "REGULAR_MENU",
      roundId: null,
      menuVersion: 1,
      totalMinor: "490100",
    });
    expect(
      (await pool.query("SELECT id FROM integration_outbox WHERE order_id=$1", [saved.order.id]))
        .rowCount,
    ).toBe(0);
  } finally {
    unavailable = false;
  }
});

test("mixed checkout has one authoritative order, earns once and only exchange lines emit accepted/cancelled events", async () => {
  const item = await dish(),
    g = await guest();
  const q = await createQuote(g.owner, {
    qrToken: table.token,
    items: [
      { productId: item.id, quantity: 2, itemType: "REGULAR_MENU" },
      { productId, quantity: 1 },
    ],
  });
  expect(q.subtotalMinor).toBe(649100);
  expect(q.cashbackMinor).toBe(19400);
  const input = { quoteId: q.id, idempotencyKey: randomToken() };
  const [a, b] = await Promise.all([checkout(g.owner, input), checkout(g.owner, input)]);
  expect(a.order.id).toBe(b.order.id);
  expect(a.order.items.length).toBe(2);
  expect(
    (await pool.query("SELECT id FROM integration_outbox WHERE order_id=$1", [a.order.id]))
      .rowCount,
  ).toBe(1);
  expect((await balance(g.id)).balanceMinor).toBe(19400);
  await changeStatus(a.order.id, venueId, "manager", undefined, "Mixed test cancellation");
  await changeStatus(a.order.id, venueId, "manager", undefined, "Mixed test cancellation");
  expect((await balance(g.id)).balanceMinor).toBe(0);
  expect(
    (await pool.query("SELECT id FROM integration_outbox WHERE order_id=$1", [a.order.id]))
      .rowCount,
  ).toBe(2);
});

test("menu revision and availability changes require a fresh quote without partial financial writes", async () => {
  const item = await dish(),
    owner = anon();
  const q = await createQuote(owner, {
    qrToken: table.token,
    items: [{ productId: item.id, quantity: 1, itemType: "REGULAR_MENU" }],
  });
  await saveMenuItem(
    venueId,
    managerSession,
    { ...dishInput, priceMinor: 260000, version: 1 },
    item.id,
  );
  await expect(
    checkout(owner, { quoteId: q.id, idempotencyKey: randomToken() }),
  ).rejects.toMatchObject({ code: "REQUOTE" });
  expect(
    (await pool.query("SELECT id FROM dine_in_orders WHERE quote_id=$1", [q.id])).rowCount,
  ).toBe(0);
  const next = await createQuote(owner, {
    qrToken: table.token,
    items: [{ productId: item.id, quantity: 1, itemType: "REGULAR_MENU" }],
  });
  await saveMenuItem(
    venueId,
    managerSession,
    { ...dishInput, isAvailable: false, version: 2 },
    item.id,
  );
  await expect(
    checkout(owner, { quoteId: next.id, idempotencyKey: randomToken() }),
  ).rejects.toMatchObject({ code: "PRODUCT_UNAVAILABLE" });
  await expect(
    createQuote(owner, { qrToken: table.token, items: [{ productId: item.id, quantity: 1 }] }),
  ).rejects.toMatchObject({ code: "PRODUCT_UNAVAILABLE" });
});

test("XOXO staff read contract returns canonical menu and mixed orders only with service key", async () => {
  const path = "https://command.test/api/service/v1/dine-in/orders?scope=recent";
  expect((await handleBookingApi(new Request(path)))?.status).toBe(401);
  const headers = { "x-command-center-key": process.env.COMMAND_CENTER_SERVICE_KEY! };
  const response = (await handleBookingApi(new Request(path, { headers })))!;
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const read = await response.json();
  expect(read.source).toBe("command_center");
  const mixedId = (
    await pool.query(`SELECT o.id FROM dine_in_orders o JOIN dine_in_order_items i
    ON i.order_id=o.id GROUP BY o.id HAVING count(DISTINCT i.item_type)=2 LIMIT 1`)
  ).rows[0]?.id;
  expect(read.orders.find((order: { id: string }) => order.id === mixedId)?.items.length).toBe(2);
  const menuResponse = (await handleBookingApi(
    new Request("https://command.test/api/service/v1/dine-in/menu", { headers }),
  ))!;
  const menu = await menuResponse.json();
  expect(menu.source).toBe("command_center");
  expect(menu.items.length).toBeGreaterThanOrEqual(1);
});

async function serviceVisit() {
  const qr = (
    await pool.query(
      `SELECT q.* FROM table_qr_codes q WHERE q.enabled AND NOT EXISTS(SELECT 1 FROM dining_sessions s WHERE s.resource_id=q.resource_id AND s.closed_at IS NULL) LIMIT 1`,
    )
  ).rows[0];
  const visit = (
    await pool.query(
      `INSERT INTO dining_sessions(venue_id,resource_id,seated_at,visit_status,expected_end_at) VALUES($1,$2,now(),'seated',now()+interval '1 hour') RETURNING id`,
      [venueId, qr.resource_id],
    )
  ).rows[0];
  return { qr, visit };
}
test("staff mixed checkout is canonical, actor-bound, idempotent and emits only exchange demand", async () => {
  const { qr, visit } = await serviceVisit(),
    item = await dish();
  const input = {
    sessionId: visit.id,
    items: [
      { productId, quantity: 2 },
      { productId: item.id, quantity: 1, itemType: "REGULAR_MENU" },
    ],
  };
  expect(
    (await api("/api/staff/v1/dine-in/staff-quotes", input, { cookie: staff.viewer })).status,
  ).toBe(403);
  expect(
    (
      await api("/api/staff/v1/dine-in/staff-quotes", input, {
        cookie: staff.operator,
        origin: "https://evil.test",
      })
    ).status,
  ).toBe(403);
  const response = await api("/api/staff/v1/dine-in/staff-quotes", input, {
    cookie: staff.operator,
  });
  expect(response.status).toBe(201);
  const q = await response.json(),
    body = { quoteId: q.id, idempotencyKey: randomToken() };
  expect(
    (await api("/api/staff/v1/dine-in/staff-orders", body, { cookie: staff.manager })).status,
  ).toBe(404);
  const [a, b] = await Promise.all([
    api("/api/staff/v1/dine-in/staff-orders", body, { cookie: staff.operator }),
    api("/api/staff/v1/dine-in/staff-orders", body, { cookie: staff.operator }),
  ]);
  const first = await a.json(),
    second = await b.json();
  expect(first.order.id).toBe(second.order.id);
  expect(first.order.items.length).toBe(2);
  expect(first.order.cashbackMinor).toBe("0");
  expect(first.order.events.find((e: { type: string }) => e.type === "created").actor).toBe(
    "staff:operator",
  );
  expect(
    (await pool.query("SELECT id FROM integration_outbox WHERE order_id=$1", [first.order.id]))
      .rowCount,
  ).toBe(1);
  expect(
    (
      await pool.query(
        "SELECT dining_session_id,table_resource_id FROM dine_in_orders WHERE id=$1",
        [first.order.id],
      )
    ).rows[0],
  ).toEqual({ dining_session_id: visit.id, table_resource_id: qr.resource_id });
  const stale = await api("/api/staff/v1/dine-in/staff-quotes", input, { cookie: staff.operator }),
    staleQuote = await stale.json();
  await pool.query(
    "UPDATE dining_sessions SET closed_at=now(),visit_status='released' WHERE id=$1",
    [visit.id],
  );
  expect(
    (
      await api(
        "/api/staff/v1/dine-in/staff-orders",
        { quoteId: staleQuote.id, idempotencyKey: randomToken() },
        { cookie: staff.operator },
      )
    ).status,
  ).toBe(409);
  expect(
    (await api("/api/staff/v1/dine-in/staff-orders", body, { cookie: staff.operator })).status,
  ).toBe(200);
});
test("no-QR code binds one owner, never leaks permanent token, expires and cannot cross visits", async () => {
  const { qr, visit } = await serviceVisit(),
    owner = anon();
  const issued = await issueAccess(venueId, "operator", { sessionId: visit.id });
  const [a, b] = await Promise.all([
    claimAccess(owner, { code: issued.code }),
    claimAccess(owner, { code: issued.code }),
  ]);
  expect(a.accessToken).toBe(b.accessToken);
  expect(a.accessToken).not.toBe(qr.token);
  await expect(claimAccess(anon(), { code: issued.code })).rejects.toMatchObject({
    code: "ACCESS_INVALID",
  });
  const q = await createQuote(owner, {
    qrToken: a.accessToken,
    items: [{ productId, quantity: 1 }],
  });
  const order = await checkout(owner, { quoteId: q.id, idempotencyKey: randomToken() });
  expect(order.order.tableCode).toBe(
    (await pool.query("SELECT code FROM venue_resources WHERE id=$1", [qr.resource_id])).rows[0]
      .code,
  );
  const next = await createQuote(owner, {
    qrToken: a.accessToken,
    items: [{ productId, quantity: 1 }],
  });
  await pool.query(
    "UPDATE dining_access_grants SET expires_at=now()-interval '1 second' WHERE session_id=$1",
    [visit.id],
  );
  await expect(
    checkout(owner, { quoteId: next.id, idempotencyKey: randomToken() }),
  ).rejects.toMatchObject({ code: "ACCESS_INVALID" });
  const fresh = await issueAccess(venueId, "operator", { sessionId: visit.id }),
    grant = await claimAccess(owner, { code: fresh.code });
  const last = await createQuote(owner, {
    qrToken: grant.accessToken,
    items: [{ productId, quantity: 1 }],
  });
  await pool.query(
    "UPDATE dining_sessions SET closed_at=now(),visit_status='released' WHERE id=$1",
    [visit.id],
  );
  await expect(
    checkout(owner, { quoteId: last.id, idempotencyKey: randomToken() }),
  ).rejects.toMatchObject({ code: "SESSION_CHANGED" });
  expect(
    (await pool.query("SELECT id FROM dine_in_orders WHERE quote_id IN($1,$2)", [next.id, last.id]))
      .rowCount,
  ).toBe(0);
});
test("no-QR transport sets owner cookie, claims idempotently and rejects a second phone", async () => {
  const { visit } = await serviceVisit();
  const issued = await issueAccess(venueId, "operator", { sessionId: visit.id });
  const claimed = await api("/api/guest/v1/dine-in/access/claim", { code: issued.code });
  expect(claimed.status).toBe(200);
  const cookie = claimed.headers.get("set-cookie")!.split(";")[0],
    data = await claimed.json();
  const tableResponse = await api("/api/guest/v1/dine-in/tables/" + data.accessToken, undefined, {
    cookie,
  });
  expect(tableResponse.status).toBe(200);
  expect(JSON.stringify(await tableResponse.json())).not.toContain("visit_");
  expect((await api("/api/guest/v1/dine-in/tables/" + data.accessToken)).status).toBe(401);
  expect((await api("/api/guest/v1/dine-in/access/claim", { code: issued.code })).status).toBe(409);
  expect(
    (await api("/api/guest/v1/dine-in/access/claim", { code: issued.code }, { cookie })).status,
  ).toBe(200);
});
test("two employees accepting and marking payment produce one event for each operation", async () => {
  const o = await submit(anon());
  await Promise.all([
    changeStatus(o.order.id, venueId, "operator", "accepted"),
    changeStatus(o.order.id, venueId, "manager", "accepted"),
  ]);
  await Promise.all([
    changeStatus(o.order.id, venueId, "operator", undefined, undefined, true),
    changeStatus(o.order.id, venueId, "manager", undefined, undefined, true),
  ]);
  const events = (
    await pool.query(
      "SELECT type,count(*)::int AS n FROM dine_in_order_events WHERE order_id=$1 GROUP BY type",
      [o.order.id],
    )
  ).rows;
  expect(events.find((e) => e.type === "accepted").n).toBe(1);
  expect(events.find((e) => e.type === "manual_payment_received").n).toBe(1);
  const ops = await api("/api/staff/v1/dine-in/operations", undefined, { cookie: staff.operator });
  expect(ops.status).toBe(200);
  expect((await ops.json()).orders.some((r: { id: string }) => r.id === o.order.id)).toBe(true);
});
test("booking request allocates nothing until manager confirms a verified resource, retries create one reservation", async () => {
  const g = await guest(),
    start = new Date(Date.now() + 86400000 * 3);
  start.setUTCHours(14, 0, 0, 0);
  const input = {
    startsAt: start.toISOString(),
    endsAt: new Date(+start + 7200000).toISOString(),
    guests: 2,
    idempotencyKey: randomToken(),
  };
  const [a, b] = await Promise.all([
    requestBooking(venueId, g.id, input),
    requestBooking(venueId, g.id, input),
  ]);
  expect(a.id).toBe(b.id);
  expect(
    (await pool.query("SELECT id FROM command_center_reservations WHERE guest_id=$1", [g.id]))
      .rowCount,
  ).toBe(0);
  expect(
    (
      await api(
        `/api/staff/v1/dine-in/booking-requests/${a.id}`,
        { action: "reject", reason: "No space" },
        { cookie: staff.operator, method: "PATCH" },
      )
    ).status,
  ).toBe(403);
  const resource = (
    await pool.query("SELECT id FROM venue_resources WHERE code='VIP3' AND venue_id=$1", [venueId])
  ).rows[0];
  const [x, y] = await Promise.all([
    resolveBookingRequest(venueId, "manager", a.id, { action: "confirm", resourceId: resource.id }),
    resolveBookingRequest(venueId, "manager", a.id, { action: "confirm", resourceId: resource.id }),
  ]);
  expect(x.reservationId).toBe(y.reservationId);
  expect(x.status).toBe("confirmed");
  expect(
    (
      await pool.query("SELECT guest_id FROM command_center_reservations WHERE id=$1", [
        x.reservationId,
      ])
    ).rows[0].guest_id,
  ).toBe(g.id);
});
test("regular-only booking preorder has no invented exchange round or market demand", async () => {
  const g = await guest(),
    item = await dish();
  const response = await api(
    "/api/guest/v1/quotes",
    { items: [{ productId: item.id, quantity: 2, itemType: "REGULAR_MENU" }] },
    { cookie: g.cookie },
  );
  expect(response.status).toBe(201);
  const q = await response.json();
  expect(q.roundId).toBe(null);
  expect(q.lines[0].itemType).toBe("REGULAR_MENU");
  expect(q.lines[0].total).toBe(4901);
});

test("staff wallet requires verified arrived reservation context and preserves 3 percent/FIFO invariants", async () => {
  const g = await guest(),
    { visit } = await serviceVisit();
  await pool.query("UPDATE dining_sessions SET guest_id=$2 WHERE id=$1", [visit.id, g.id]);
  const input = { sessionId: visit.id, useVisitGuest: true, items: [{ productId, quantity: 1 }] };
  expect(
    (await api("/api/staff/v1/dine-in/staff-quotes", input, { cookie: staff.operator })).status,
  ).toBe(409);
  const qr = (
    await pool.query(
      "SELECT q.*,r.code FROM dining_sessions s JOIN table_qr_codes q ON q.resource_id=s.resource_id JOIN venue_resources r ON r.id=q.resource_id WHERE s.id=$1",
      [visit.id],
    )
  ).rows[0];
  await pool.query(
    "UPDATE dining_sessions SET closed_at=now(),visit_status='released' WHERE id=$1",
    [visit.id],
  );
  await pool.query(
    "UPDATE venue_resource_mappings SET relationship='independent',linked_resource_id=NULL,legacy_code=NULL,note='Isolated verified table',verified_at=now(),verified_by='manager' WHERE resource_id=$1",
    [qr.resource_id],
  );
  await pool.query("UPDATE venue_resources SET capacity=4,is_reservable=true WHERE id=$1", [
    qr.resource_id,
  ]);
  const booking = await transaction(async (c) => {
    const b = (
      await c.query(
        `INSERT INTO command_center_reservations(guest_id,guest_name,phone,guests,starts_at,ends_at,table_id,table_ids,status) VALUES($1,'Verified guest','+77010000000',2,now()-interval '5 minutes',now()+interval '1 hour',$2,ARRAY[$2::text],'arrived') RETURNING id`,
        [g.id, qr.code],
      )
    ).rows[0];
    await c.query(
      "INSERT INTO command_center_reservation_resources(reservation_id,resource_id) VALUES($1,$2)",
      [b.id, qr.resource_id],
    );
    return b;
  });
  const s = (
    await pool.query(
      "INSERT INTO dining_sessions(venue_id,resource_id,seated_at,visit_status,guest_id,reservation_id) VALUES($1,$2,now(),'seated',$3,$4) RETURNING id",
      [venueId, qr.resource_id, g.id, booking.id],
    )
  ).rows[0];
  await pool.query(
    "INSERT INTO hostess_guest_identities(guest_id,provider,subject) VALUES($1,'whatsapp',$2)",
    [g.id, randomToken()],
  );
  await lot(g.id, 10000);
  const response = await api(
    "/api/staff/v1/dine-in/staff-quotes",
    { ...input, sessionId: s.id, redeemMinor: 10000 },
    { cookie: staff.operator },
  );
  expect(response.status).toBe(201);
  const q = await response.json();
  expect(q.discountMinor).toBe(10000);
  expect(q.cashbackMinor).toBe(4400);
  const result = await api(
    "/api/staff/v1/dine-in/staff-orders",
    { quoteId: q.id, idempotencyKey: randomToken() },
    { cookie: staff.operator },
  );
  expect(result.status).toBe(201);
  const order = (await result.json()).order;
  expect(order.guestId).toBe(g.id);
  expect((await balance(g.id)).balanceMinor).toBe(4400);
});
