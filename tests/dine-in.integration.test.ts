import { beforeAll, afterAll, expect, test } from "bun:test";
import {tableSchema,quoteSchema,orderSchema,walletSchema,transactionSchema} from "./contracts/hostess-schema";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { pool } from "../src/server/db/pool";
import { transaction, newSession } from "../src/server/guest/auth";
import { hash, randomToken } from "../src/server/guest/security";
import { handleBookingApi } from "../src/server/guest/api";
import { createQuote, checkout, changeStatus, type Owner } from "../src/server/dine-in/service";
import { wallets, walletView, loyaltyLock, mergeDiningGuest } from "../src/server/dine-in/loyalty";
import { drainOutbox } from "../src/server/dine-in/outbox";

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
  permanentFailure = false;
const staff: Record<string, string> = {},
  delivered: string[] = [];
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
      { status: permanentFailure ? 400 : outboxFail ? 503 : 200 },
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
  await expect(
    checkout(g.owner, { quoteId: (await quote(g.owner)).id, idempotencyKey: input.idempotencyKey }),
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

test("actual Hostess frontend schema accepts table, quote, order, receipt, wallet and history",async()=>{
  const g=await guest();await lot(g.id,100000);
  const tableResult=await (await api("/api/guest/v1/dine-in/tables/"+table.token)).json();
  expect(tableSchema.parse(tableResult).table.resourceId).toBe(table.resource_id);
  const qResponse=await api("/api/guest/v1/dine-in/quotes",{qrToken:table.token,items:[{productId,quantity:3}],redeemAmount:1000},{cookie:g.cookie});expect(qResponse.status).toBe(201);
  const q=quoteSchema.parse(await qResponse.json());expect(q.subtotal).toBe(4770);expect(q.discount).toBe(1000);expect(q.payable).toBe(3770);expect(q.cashback).toBe(113);
  const response=await api("/api/guest/v1/dine-in/orders",{quoteId:q.id,idempotencyKey:randomToken()},{cookie:g.cookie});expect(response.status).toBe(201);
  const o=orderSchema.parse((await response.json()).order);expect(o.venueCode).toBe("xoxo");expect(o.lines[0].unitPrice).toBe(1590);expect(o.cashback).toBe(113);expect(o.receiptToken).toBeDefined();
  const receipt=await api("/api/guest/v1/dine-in/orders/"+o.id+"?receiptToken="+o.receiptToken);expect(receipt.status).toBe(200);expect(orderSchema.parse((await receipt.json()).order).id).toBe(o.id);
  const wallet=walletSchema.parse(await (await api("/api/guest/v1/loyalty/wallet",undefined,{cookie:g.cookie})).json());expect(wallet.balance).toBe(113);expect(wallet.lots.length).toBe(1);
  const transactions=(await (await api("/api/guest/v1/loyalty/transactions",undefined,{cookie:g.cookie})).json()).transactions;
  expect(transactions.every((t:unknown)=>transactionSchema.safeParse(t).success)).toBe(true);
  const history=await (await api("/api/guest/v1/dine-in/orders",undefined,{cookie:g.cookie})).json();expect(history.orders.some((item:unknown)=>orderSchema.parse(item).id===o.id)).toBe(true);
});
