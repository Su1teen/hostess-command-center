import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createServer, type Server } from "node:http";
import { guestBrowserCheckout } from "./cross-guest-browser";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
const runFile = promisify(execFile);

import { createRequire } from "node:module";
const xoxoRoot = process.env.XOXO_SOURCE_ROOT;
assert.ok(xoxoRoot, "Set XOXO_SOURCE_ROOT to the existing XOXO checkout");
const xoxoRequire = createRequire(pathToFileURL(xoxoRoot + "/package.json"));
const fastify = xoxoRequire("fastify");
const { PrismaClient } = xoxoRequire("@prisma/client");
const loadXoxo = async (path: string) => import(pathToFileURL(xoxoRoot + "/" + path).href);
const { parseEnv } = await loadXoxo("src/config/env.js");
const { orderEventsRoutes } = await loadXoxo("src/modules/command-center/order-events.routes.js");
const { publicRoutes } = await loadXoxo("src/modules/public-api/public.routes.js");
const { commandCenterRoutes } = await loadXoxo("src/modules/command-center/command.routes.js");
const { RoundsService } = await loadXoxo("src/modules/rounds/rounds.service.js");
const { ExchangeService } = await loadXoxo("src/modules/exchange/exchange.service.js");
const { AuditService } = await loadXoxo("src/services/audit.service.js");
const { DiningReadService } = await loadXoxo("src/modules/bartender/dining-read.service.js");
const { CommandCenterReadClient } = await loadXoxo(
  "src/modules/bartender/command-center-read.client.js",
);

// Only dedicated databases on this task's local PostgreSQL instance are used.
const receiverUrl = process.env.CROSS_RECEIVER_DATABASE_URL ?? "";
const senderUrl = process.env.CROSS_SENDER_DATABASE_URL ?? "";
for (const [raw, database] of [
  [receiverUrl, "xoxo_cross_test"],
  [senderUrl, "command_cross_test"],
]) {
  const url = new URL(raw!);
  assert.ok(
    ["127.0.0.1", "localhost"].includes(url.hostname) && url.pathname === "/" + database,
    "Use dedicated local cross-service databases only",
  );
}
process.env.DATABASE_URL = senderUrl;
process.env.NODE_ENV = "test";
process.env.DINE_IN_ENABLED = "yes";
process.env.DINE_IN_PILOT_ASSUMED_PAID = "yes";
process.env.DINE_IN_OUTBOX_ENABLED = "yes";
process.env.COMMAND_CENTER_SERVICE_KEY = "local-cross-service-credential-32-characters";
process.env.HOSTESS_PUBLIC_ORIGIN = "https://hostes.online";
process.env.HOSTESS_BFF_KEY = "b".repeat(43);
process.env.COMMAND_CENTER_ORIGIN = "https://command.test";
const senderRoot = process.env.COMMAND_CENTER_SOURCE_ROOT;
assert.ok(senderRoot, "COMMAND_CENTER_SOURCE_ROOT must identify the checked-out sender");
const load = async (path: string) => import(pathToFileURL(senderRoot + "/" + path).href);
const { pool } = await load("src/server/db/pool.ts");
const { createQuote, checkout, changeStatus } = await load("src/server/dine-in/service.ts");
const { drainOutbox } = await load("src/server/dine-in/outbox.ts");
const prisma = new PrismaClient({ datasources: { db: { url: receiverUrl } } });
const senderReadClient = new PrismaClient({ datasources: { db: { url: senderUrl } } });
const diningRead = new DiningReadService(senderReadClient);
const env = parseEnv({
  DATABASE_URL: receiverUrl,
  ADMIN_API_KEY: "local-test-admin-0123456789",
  COMMAND_CENTER_SERVICE_KEY: process.env.COMMAND_CENTER_SERVICE_KEY,
  QR_ORDER_EVENTS_ENABLED: "false",
  ROUND_SCHEDULER_ENABLED: "false",
});
const logger = { info: () => {}, warn: () => {}, error: () => {} };
const rounds = new RoundsService(prisma, env, new AuditService(prisma, logger), logger);
const exchange = new ExchangeService(prisma, rounds, logger);
const app = fastify();
let commandReadServer: Server | undefined;
app.decorate("env", env);
app.decorate("prisma", prisma);
app.decorate("services", { rounds, exchange } as never);
await app.register(orderEventsRoutes);
await app.register(publicRoutes);
await app.register(commandCenterRoutes);
try {
  assert.equal(
    await prisma.exchangeOrderEvent.count(),
    0,
    "Receiver test database must be freshly migrated",
  );
  assert.equal(await prisma.organization.count(), 0, "Receiver test database must be empty");
  for (const file of readdirSync(senderRoot + "/src/server/db/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await pool.query(readFileSync(senderRoot + "/src/server/db/migrations/" + file, "utf8"));
  }
  const table = (await pool.query("SELECT token,venue_id,resource_id FROM table_qr_codes LIMIT 1"))
    .rows[0];
  const organization = await prisma.organization.create({
    data: { iikoOrganizationId: randomUUID(), name: "Isolated E2E", isSelected: true },
  });
  const product = await prisma.exchangeProduct.create({
    data: {
      slug: "isolated-e2e",
      name: "Isolated E2E drink",
      category: "Drinks",
      originalPrice: 2000,
      startPrice: 1590,
      currentPrice: 1590,
      minPrice: 1590,
      maxPrice: 3000,
    },
  });
  const startsAt = new Date(Math.floor(Date.now() / 900000) * 900000),
    endsAt = new Date(startsAt.getTime() + 900000);
  const round = await prisma.priceRound.create({
    data: {
      organizationId: organization.id,
      roundKey: randomUUID(),
      startsAt,
      endsAt,
      timezone: "Asia/Almaty",
      status: "PUBLISHED",
      publishedAt: new Date(),
      algorithmVersion: "test",
      triggerSource: "TEST",
      prices: {
        create: {
          exchangeProductId: product.id,
          price: 1590,
          publishedPrice: 1590,
          calculatedPrice: 1590,
          minPrice: 1590,
          maxPrice: 3000,
          priceStep: 50,
          changePercent: 0,
          calculationInput: {},
          calculationResult: {},
          status: "PUBLISHED",
        },
      },
    },
  });
  process.env.EXCHANGE_API_ORIGIN = await app.listen({ host: "127.0.0.1", port: 0 });
  const { handleBookingApi } = await load("src/server/guest/api.ts");
  commandReadServer = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const payload = Buffer.concat(chunks).toString();
    const result = await handleBookingApi(
      new Request(`http://127.0.0.1${request.url}`, {
        method: request.method,
        headers: request.headers as HeadersInit,
        ...(payload ? { body: payload } : {}),
      }),
    );
    response.writeHead(result?.status ?? 404, Object.fromEntries(result?.headers ?? []));
    response.end(result ? await result.text() : "");
  });
  await new Promise<void>((resolve) => commandReadServer!.listen(0, "127.0.0.1", resolve));
  const address = commandReadServer.address();
  assert.ok(address && typeof address !== "string");
  const remoteRead = new CommandCenterReadClient({
    ...env,
    COMMAND_CENTER_READ_ORIGIN: `http://127.0.0.1:${address.port}`,
  });
  const owner = { guestId: null, hash: randomUUID() };
  const quote = await createQuote(owner, {
    qrToken: table.token,
    items: [{ productId: product.id, quantity: 3 }],
    redeemMinor: 0,
  });
  const order = await checkout(owner, { quoteId: quote.id, idempotencyKey: randomUUID() });
  const firstRead = await diningRead.orders();
  assert.equal(firstRead.orders[0]?.id, order.order.id);
  assert.equal(firstRead.orders[0]?.payableMinor, "477000");
  assert.equal(firstRead.orders[0]?.cashbackMinor, "0");
  assert.equal(firstRead.orders[0]?.guestName, null);
  assert.equal(firstRead.orders[0]?.items[0]?.itemType, "EXCHANGE");
  assert.equal(firstRead.orders[0]?.items[0]?.unitPriceMinor, "159000");
  assert.equal((await remoteRead.orders()).orders[0]?.id, order.order.id);
  assert.equal(
    (await pool.query("SELECT count(*)::int AS n FROM integration_outbox")).rows[0].n,
    1,
  );
  assert.deepEqual(await drainOutbox(), { delivered: 0, failed: 1 });
  assert.equal(await prisma.exchangeOrderEvent.count(), 0);
  assert.equal(
    (await pool.query("SELECT terminal FROM integration_outbox")).rows[0].terminal,
    false,
  );
  env.QR_ORDER_EVENTS_ENABLED = true;
  await pool.query("UPDATE integration_outbox SET next_attempt_at=now()");
  assert.deepEqual(await drainOutbox(), { delivered: 1, failed: 0 });
  const accepted = await prisma.exchangeOrderEvent.findFirstOrThrow();
  assert.equal(accepted.quantity, 3);
  assert.equal(accepted.unitPriceSnapshot.toFixed(2), "1590.00");
  assert.equal(
    (await pool.query("SELECT status FROM integration_outbox")).rows[0].status,
    "delivered",
  );
  await pool.query("UPDATE integration_outbox SET status='failed',next_attempt_at=now()");
  assert.deepEqual(await drainOutbox(), { delivered: 1, failed: 0 });
  assert.equal(await prisma.exchangeOrderEvent.count(), 1);
  await changeStatus(
    order.order.id,
    table.venue_id,
    "e2e-manager",
    undefined,
    "Isolated audit cancellation",
  );
  assert.deepEqual(await drainOutbox(), { delivered: 1, failed: 0 });
  const diagnostics = await app.inject({
    url: "/api/v1/command-center/order-events/diagnostics?roundId=" + round.id,
    headers: { "x-command-center-key": env.COMMAND_CENTER_SERVICE_KEY! },
  });
  assert.equal(diagnostics.statusCode, 200);
  assert.equal(diagnostics.json().reconciliation[0].qrQuantity, 0);
  assert.equal((await prisma.roundPrice.findFirstOrThrow()).publishedPrice!.toFixed(2), "1590.00");
  assert.equal((await diningRead.orders()).orders.length, 0);
  assert.equal((await diningRead.orders("recent")).orders[0]?.status, "cancelled");
  assert.equal((await remoteRead.orders("recent")).orders[0]?.status, "cancelled");
  // Persisted standard menu shares one authoritative order with exchange lines.
  const menuItem = (
    await pool.query(
      `INSERT INTO venue_menu_items(venue_id,name,category,price_minor,published,is_available)
    VALUES($1,'Test kitchen item','Kitchen',125050,true,true) RETURNING id`,
      [table.venue_id],
    )
  ).rows[0];
  assert.equal((await diningRead.menu()).items[0]?.priceMinor, "125050");
  assert.equal((await remoteRead.menu()).items[0]?.priceMinor, "125050");
  const mixedQuote = await createQuote(owner, {
    qrToken: table.token,
    items: [
      { productId: product.id, quantity: 2 },
      { productId: menuItem.id, itemType: "REGULAR_MENU", quantity: 1 },
    ],
    redeemMinor: 0,
  });
  const mixed = await checkout(owner, { quoteId: mixedQuote.id, idempotencyKey: randomUUID() });
  const mixedRead = (await diningRead.orders()).orders.find((o) => o.id === mixed.order.id)!;
  assert.equal(mixedRead.items.length, 2);
  assert.equal(mixedRead.payableMinor, "443050");
  assert.equal(mixedRead.items.filter((i) => i.itemType === "REGULAR_MENU").length, 1);
  assert.equal((await remoteRead.orders()).orders[0]?.id, mixed.order.id);
  assert.equal(
    (
      await pool.query("SELECT count(*)::int AS n FROM integration_outbox WHERE order_id=$1", [
        mixed.order.id,
      ])
    ).rows[0].n,
    1,
  );
  assert.deepEqual(await drainOutbox(), { delivered: 1, failed: 0 });
  assert.equal(await prisma.exchangeOrderEvent.count(), 3);
  await changeStatus(
    mixed.order.id,
    table.venue_id,
    "e2e-manager",
    undefined,
    "Isolated mixed cancellation",
  );
  assert.deepEqual(await drainOutbox(), { delivered: 1, failed: 0 });
  assert.equal(await prisma.exchangeOrderEvent.count(), 4);

  // Actual Hostess BFF -> HTTP Command Center -> PostgreSQL -> HTTP XOXO.
  const { proxyHostessApi } = await import(
    pathToFileURL(process.env.HOSTESS_SOURCE_ROOT! + "/src/lib/server/guest-proxy.ts").href
  );
  const { transaction, newSession } = await load("src/server/guest/auth.ts");
  const staffCookie = (
    await transaction((c) => newSession(c, null, "cross-operator", "operator"))
  ).split(";")[0];
  const bffOrigin = "http://127.0.0.1:19998";
  const senderOrigin = "http://127.0.0.1:" + address.port;
  const bffServer = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString();
    const reply = await proxyHostessApi(
      new Request(bffOrigin + req.url, {
        method: req.method,
        headers: req.headers as HeadersInit,
        ...(body ? { body } : {}),
      }),
      { BOOKING_API_ORIGIN: senderOrigin, HOSTESS_BFF_KEY: process.env.HOSTESS_BFF_KEY },
    );
    res.writeHead(reply?.status ?? 404, Object.fromEntries(reply?.headers ?? []));
    res.end(reply ? await reply.text() : "");
  });
  await new Promise<void>((resolve) => bffServer.listen(19998, "127.0.0.1", resolve));
  try {
    const visit = (
      await pool.query("SELECT id FROM dining_sessions WHERE closed_at IS NULL LIMIT 1")
    ).rows[0];
    await pool.query(
      "UPDATE dining_sessions SET seated_at=now(),visit_status='seated' WHERE id=$1",
      [visit.id],
    );
    const staffPost = async (path: string, data: unknown) =>
      fetch(senderOrigin + "/api/staff/v1" + path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://command.test",
          cookie: staffCookie,
        },
        body: JSON.stringify(data),
      });
    const staffQuote = await (
      await staffPost("/dine-in/staff-quotes", {
        sessionId: visit.id,
        items: [
          { productId: product.id, quantity: 1 },
          { productId: menuItem.id, quantity: 1, itemType: "REGULAR_MENU" },
        ],
      })
    ).json();
    assert.ok(staffQuote.id, JSON.stringify(staffQuote));
    const staffOrder = await (
      await staffPost("/dine-in/staff-orders", {
        quoteId: staffQuote.id,
        idempotencyKey: randomUUID(),
      })
    ).json();
    assert.ok(staffOrder.order.id);
    assert.equal(staffOrder.order.source, "staff");
    const issued = await (await staffPost("/dine-in/access", { sessionId: visit.id })).json();
    assert.ok(issued.code);
    const bffPost = async (path: string, data: unknown, cookie?: string) =>
      fetch(bffOrigin + "/api/guest/v1" + path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: bffOrigin,
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify(data),
      });
    const claim = await bffPost("/dine-in/access/claim", { code: issued.code });
    assert.equal(claim.status, 200);
    const cookie = claim.headers.get("set-cookie")!.split(";")[0],
      access = await claim.json();
    const guestQuote = await (
      await bffPost(
        "/dine-in/quotes",
        {
          qrToken: access.accessToken,
          items: [
            { productId: product.id, quantity: 1 },
            { productId: menuItem.id, quantity: 1, itemType: "REGULAR_MENU" },
          ],
        },
        cookie,
      )
    ).json();
    assert.ok(guestQuote.id, JSON.stringify(guestQuote));
    const attempt = { quoteId: guestQuote.id, idempotencyKey: randomUUID() };
    const [one, two] = await Promise.all([
      bffPost("/dine-in/orders", attempt, cookie),
      bffPost("/dine-in/orders", attempt, cookie),
    ]);
    const first = await one.json(),
      second = await two.json();
    assert.equal(first.order.id, second.order.id);
    assert.equal(first.order.source, "table_code");
    const physicalTables = await (
      await fetch(bffOrigin + "/api/guest/v1/dine-in/tables?venue=xoxo")
    ).json();
    assert.equal(physicalTables.tables.length, 17);
    assert.ok(!JSON.stringify(physicalTables).includes('"token"'));
    const official = JSON.parse(
      readFileSync(new URL("../docs/menu/official-menu.json", import.meta.url), "utf8"),
    );
    const { importMenu } = await load("src/server/dine-in/menu-import.ts");
    const priorMode = process.env.EXCHANGE_DATA_MODE;
    process.env.EXCHANGE_DATA_MODE = "api";
    try {
      const manager = { staff_id: "cross-menu-import", role: "manager", guest_id: null };
      const preview = await importMenu(table.venue_id, manager, {
        mode: "preview",
        items: official.items,
      });
      assert.equal(preview.counts.create, 119);
      const cliBuild = spawnSync(
        "bun",
        [
          "build",
          "scripts/import-menu.ts",
          "--target=node",
          "--packages=external",
          "--outfile=.output/cross-menu-cli.mjs",
        ],
        { encoding: "utf8", windowsHide: true },
      );
      assert.equal(cliBuild.status, 0, cliBuild.stderr);
      const cli = async () => {
        const result = await runFile(process.execPath, [".output/cross-menu-cli.mjs", "--apply"], {
          env: { ...process.env, DATABASE_URL: senderUrl },
          windowsHide: true,
          timeout: 30000,
          maxBuffer: 2_000_000,
        });
        return JSON.parse(result.stdout.trim().split("\n").at(-1)!);
      };
      assert.equal((await cli()).counts.create, 119);
      const secondImport = await importMenu(table.venue_id, manager, {
        mode: "preview",
        items: official.items,
      });
      assert.equal(secondImport.counts.unchanged, 119);
      for (let retry = 0; retry < 2; retry++)
        assert.deepEqual((await cli()).counts, {
          create: 0,
          update: 0,
          unchanged: 119,
          exchange: 0,
          duplicate: 0,
        });
      assert.equal(
        (
          await pool.query(
            "SELECT max(version)::int AS version FROM venue_menu_items WHERE source_key IS NOT NULL",
          )
        ).rows[0].version,
        1,
      );
      const catalog = await (
        await fetch(bffOrigin + "/api/guest/v1/dine-in/regular-menu?venue=xoxo")
      ).json();
      for (const item of official.items) {
        const actual = catalog.items.find(
          (p: { name: string; portion: string; category: string }) =>
            p.name === item.name && p.portion === item.portion && p.category === item.category,
        );
        assert.ok(actual, item.name);
        assert.equal(Number(actual.priceMinor), item.priceMinor);
      }
    } finally {
      if (priorMode === undefined) delete process.env.EXCHANGE_DATA_MODE;
      else process.env.EXCHANGE_DATA_MODE = priorMode;
    }
    const webQuoteResponse = await bffPost("/dine-in/quotes", {
      qrToken: `web_${table.resource_id}`,
      items: [
        { productId: product.id, quantity: 1 },
        { productId: menuItem.id, quantity: 2, itemType: "REGULAR_MENU" },
      ],
    });
    assert.equal(webQuoteResponse.status, 201);
    const webCookie = webQuoteResponse.headers.get("set-cookie")!.split(";")[0];
    const webQuote = await webQuoteResponse.json();
    const webAttempt = { quoteId: webQuote.id, idempotencyKey: randomUUID() };
    const [webOne, webTwo] = await Promise.all([
      bffPost("/dine-in/orders", webAttempt, webCookie),
      bffPost("/dine-in/orders", webAttempt, webCookie),
    ]);
    const webOrder = (await webOne.json()).order;
    assert.equal(webOrder.id, (await webTwo.json()).order.id);
    assert.equal(webOrder.source, "web_app");
    assert.equal(webOrder.status, "new");
    const orders = (
      await pool.query("SELECT id FROM dine_in_orders WHERE dining_session_id=$1", [visit.id])
    ).rows;
    assert.equal(orders.length, 5);
    assert.deepEqual(await drainOutbox(), { delivered: 3, failed: 0 });
    assert.equal(await prisma.exchangeOrderEvent.count(), 7);
    assert.equal(await prisma.exchangeSale.count(), 0);
    await changeStatus(first.order.id, table.venue_id, "cross-operator", "accepted");
    const receipt = await fetch(bffOrigin + "/api/guest/v1/dine-in/orders/" + first.order.id, {
      headers: { cookie },
    });
    assert.equal((await receipt.json()).order.status, "accepted");
    for (const id of [staffOrder.order.id, first.order.id, webOrder.id])
      await changeStatus(
        id,
        table.venue_id,
        "cross-manager",
        undefined,
        "Isolated cross-service compensation",
      );
    assert.deepEqual(await drainOutbox(), { delivered: 3, failed: 0 });
    assert.equal(await prisma.exchangeOrderEvent.count(), 10);
    const browserOrder = await guestBrowserCheckout({
      hostessRoot: process.env.HOSTESS_SOURCE_ROOT!,
      senderOrigin,
      exchangeOrigin: process.env.EXCHANGE_API_ORIGIN!,
      productName: product.name,
      onCreated: async (id) => {
        await changeStatus(id, table.venue_id, "cross-operator", "accepted");
      },
    });
    assert.equal(
      (
        await pool.query("SELECT dining_session_id FROM dine_in_orders WHERE id=$1", [
          browserOrder.id,
        ])
      ).rows[0].dining_session_id,
      visit.id,
    );
    assert.deepEqual(await drainOutbox(), { delivered: 1, failed: 0 });
    await changeStatus(
      browserOrder.id,
      table.venue_id,
      "cross-manager",
      undefined,
      "Controlled browser test compensation",
    );
    assert.deepEqual(await drainOutbox(), { delivered: 1, failed: 0 });
    assert.equal(await prisma.exchangeOrderEvent.count(), 12);
    console.log(
      "PASS actual Hostess BFF HTTP -> Command Center staff/no-QR checkout -> PostgreSQL -> XOXO outbox; status roundtrip; single visit; no manual sales",
    );
  } finally {
    await new Promise<void>((resolve) => bffServer.close(() => resolve()));
  }
  const next = await rounds.transitionRound(endsAt);
  assert.equal(Number(next!.prices[0]!.salesQuantity), 0);
  console.log(
    JSON.stringify({
      result: "PASS",
      senderSource: senderRoot,
      realHTTP: true,
      checkoutOrders: 6,
      guestBrowser: true,
      mixedOrderSingleAuthoritativeId: true,
      regularMenuExcludedFromDemand: true,
      staffReadMatchesAuthoritativeOrder: true,
      receiverEvents: await prisma.exchangeOrderEvent.count(),
      outbox: (
        await pool.query(
          "SELECT event_type,status,terminal FROM integration_outbox ORDER BY event_type",
        )
      ).rows,
      duplicates: diagnostics.json().duplicates,
      qrNetUnits: 0,
      quotedKzt: "1590.00",
      units: 3,
      disabledReceiverRetainedForRetry: true,
      publishedHistoryUnchanged: true,
    }),
  );
} finally {
  await new Promise<void>((resolve) => commandReadServer?.close(() => resolve()) ?? resolve());
  await app.close();
  await pool.end();
  await prisma.$disconnect();
  await senderReadClient.$disconnect();
}
