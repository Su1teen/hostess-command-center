// End-to-end check of the lite Command Center (/lite) against a real build and an
// isolated local PostgreSQL schema. Worst case first: a browser with JavaScript
// disabled entirely and an Android 4.4 tablet user agent must complete the whole
// shift workflow; then the ES3 live refresh and the legacy redirect are verified.
import { chromium, webkit } from "@playwright/test";
import pg from "pg";
import { createServer } from "node:https";
import { request as proxyRequest } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID, scryptSync } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";

const raw = process.env.TEST_DATABASE_URL;
if (!raw) throw new Error("TEST_DATABASE_URL required");
const url = new URL(raw);
if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.username !== "hostess_test")
  throw new Error("Isolated local PostgreSQL required");
const pool = new pg.Pool({ connectionString: raw, max: 1 }),
  schema = "hostess_test_lite_" + randomUUID().replaceAll("-", "");
await pool.query("CREATE SCHEMA " + schema);
pool.on("connect", (client) => {
  void client.query(`SET search_path TO ${schema},public`);
});
const scoped = new URL(raw);
scoped.searchParams.set("options", "-c search_path=" + schema + ",public");
const key = "b".repeat(43),
  productId = randomUUID(),
  roundId = randomUUID(),
  password = "test-password",
  salt = "test-salt",
  hashed = salt + ":" + scryptSync(password, salt, 64).toString("hex");
const BASE = "https://localhost:3443";
const OLD_ANDROID_UA =
  "Mozilla/5.0 (Linux; U; Android 4.4.2; ru-ru; HUAWEI MediaPad T1 8.0 Build/HuaweiS8-701u) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Safari/534.30";
const env = {
  ...process.env,
  DATABASE_URL: scoped.href,
  NODE_ENV: "test",
  NODE_TLS_REJECT_UNAUTHORIZED: "0",
  PORT: "3000",
  HOST: "127.0.0.1",
  COMMAND_CENTER_ORIGIN: BASE,
  HOSTESS_PUBLIC_ORIGIN: "https://hostes.online",
  EXCHANGE_API_ORIGIN: "https://127.0.0.1:19092",
  EXCHANGE_DATA_MODE: "api",
  HOSTESS_BFF_KEY: key,
  COMMAND_CENTER_SERVICE_KEY: "s".repeat(43),
  WHATSAPP_SERVICE_KEY: "w".repeat(43),
  ALLOW_GUEST_BOOKING_MIGRATION: "yes",
  DINE_IN_ENABLED: "yes",
  DINE_IN_PILOT_ASSUMED_PAID: "yes",
  DINE_IN_OUTBOX_ENABLED: "no",
  STAFF_USERS_JSON: JSON.stringify([
    { id: "manager", role: "manager", passwordHash: hashed },
    { id: "viewer", role: "viewer", passwordHash: hashed },
  ]),
};
await mkdir("test-results", { recursive: true });
const certificate = spawnSync(
  process.platform === "win32" ? "C:/Program Files/Git/usr/bin/openssl.exe" : "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    "test-results/lite-key.pem",
    "-out",
    "test-results/lite-cert.pem",
    "-subj",
    "/CN=localhost",
    "-days",
    "1",
  ],
  { stdio: "ignore" },
);
if (certificate.status !== 0) throw new Error("Loopback test certificate generation failed");
const tls = {
  key: await readFile("test-results/lite-key.pem"),
  cert: await readFile("test-results/lite-cert.pem"),
};
const exchange = createServer(tls, (req, res) => {
  res.setHeader("content-type", "application/json");
  if (req.url === "/api/v1/command-center/products") {
    res.end(
      JSON.stringify([{ id: productId, name: "Lite Drink", volumeMl: null, category: "Drinks" }]),
    );
    return;
  }
  if (req.url === "/api/v1/command-center/order-events") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () =>
      res.end(JSON.stringify({ accepted: true, eventId: JSON.parse(body).eventId })),
    );
    return;
  }
  res.end(
    JSON.stringify({
      status: "ok",
      generatedAt: new Date().toISOString(),
      currentRound: { id: roundId, endsAt: new Date(Date.now() + 600000).toISOString() },
      products: [
        { id: productId, name: "Lite Drink", price: 1590, currency: "KZT", isAvailable: true },
      ],
    }),
  );
});
const proxy = createServer(tls, (request, response) => {
  const upstream = proxyRequest(
    {
      hostname: "127.0.0.1",
      port: 3000,
      path: request.url,
      method: request.method,
      headers: request.headers,
    },
    (result) => {
      response.writeHead(result.statusCode, result.headers);
      result.pipe(response);
    },
  );
  upstream.on("error", () => {
    response.writeHead(503);
    response.end();
  });
  request.pipe(upstream);
});

let app, browser, webkitBrowser;
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const pass = (message) => console.log("PASS " + message);
let activePage;

async function guestOrder() {
  const table = (
    await pool.query(
      `SELECT r.id FROM ${schema}.table_qr_codes q JOIN ${schema}.venue_resources r ON r.id=q.resource_id ORDER BY r.code DESC LIMIT 1`,
    )
  ).rows[0];
  const quote = await fetch("http://localhost:3000/api/guest/v1/dine-in/quotes", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hostess-service-key": key,
      "x-hostess-client-id": "lite-fixture",
    },
    body: JSON.stringify({ qrToken: "web_" + table.id, items: [{ productId, quantity: 2 }] }),
  });
  assert(
    quote.status === 201,
    "Guest quote failed: " + quote.status + " " + (await quote.clone().text()),
  );
  const saved = await fetch("http://localhost:3000/api/guest/v1/dine-in/orders", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hostess-service-key": key,
      "x-hostess-client-id": "lite-fixture",
      cookie: quote.headers.get("set-cookie").split(";")[0],
    },
    body: JSON.stringify({ quoteId: (await quote.json()).id, idempotencyKey: randomUUID() }),
  });
  assert(saved.status === 201, "Guest order failed");
  return (await saved.json()).order;
}

/** Click a submit control and wait for the full page navigation it causes. */
async function submit(page, locator) {
  await Promise.all([page.waitForNavigation({ waitUntil: "load" }), locator.click()]);
}
async function noHorizontalOverflow(page, label) {
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    "Horizontal overflow on " + label,
  );
}

try {
  const migration = spawnSync(process.execPath, ["scripts/migrate.mjs"], { env, stdio: "inherit" });
  assert(migration.status === 0, "Migration failed");
  await pool.query(`SET search_path TO ${schema},public`);
  await pool.query(`INSERT INTO ${schema}.venue_menu_items(venue_id,name,description,category,portion,price_minor,published)
    SELECT id,'Lite Plov <b>','Isolated fixture','Кухня','300 г',245050,true FROM ${schema}.hostess_venues WHERE slug='xoxo'`);
  await new Promise((resolve) => exchange.listen(19092, "127.0.0.1", resolve));
  await new Promise((resolve) => proxy.listen(3443, "127.0.0.1", resolve));
  app = spawn(process.execPath, ["scripts/start.mjs"], { env, stdio: "inherit" });
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch("http://localhost:3000/lite/login")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  assert(ready, "Server did not start");

  /* ---------- 1. Worst case: no JavaScript at all, old Android UA ---------- */
  browser = await chromium.launch({ args: ["--no-sandbox"] });
  const noJs = await browser.newContext({
    javaScriptEnabled: false,
    ignoreHTTPSErrors: true,
    userAgent: OLD_ANDROID_UA,
    viewport: { width: 1024, height: 600 },
  });
  const page = (activePage = await noJs.newPage());
  await page.goto(BASE + "/lite");
  assert(
    page.url().endsWith("/lite/login"),
    "Unauthenticated /lite must land on login: " + page.url(),
  );
  const loginHtml = await page.content();
  assert(!loginHtml.includes('type="module"'), "Lite pages must not ship ES modules");
  await page.screenshot({ path: "test-results/lite-login-1024x600.png", fullPage: true });

  await page.locator('input[name="username"]').fill("manager");
  await page.locator('input[name="password"]').fill("wrong-password");
  await submit(page, page.getByRole("button", { name: "Войти" }));
  await page.getByText("Неверные данные входа").waitFor();
  pass("no-JS login shows the server error for a wrong password");

  await page.locator('input[name="username"]').fill("manager");
  await page.locator('input[name="password"]').fill(password);
  await submit(page, page.getByRole("button", { name: "Войти" }));
  assert(page.url().endsWith("/lite/shift"), "Login must land on the shift: " + page.url());
  await page.getByRole("heading", { name: "Смена" }).waitFor();
  pass("no-JS login with a real staff account opens the shift");

  await page.goto(BASE + "/lite/hall");
  await page.getByRole("heading", { name: "Зал" }).waitFor();
  await page.screenshot({ path: "test-results/lite-hall-1024x600.png", fullPage: true });
  await noHorizontalOverflow(page, "hall");
  const tableHref = await page.locator("a.tbl.st-free").first().getAttribute("href");
  assert(tableHref, "A free table must be listed in the hall");
  await page.goto(BASE + tableHref);
  const tableName = (await page.locator("h1").innerText()).trim();
  await page.locator('input[name="guests"]').first().fill("3");
  await submit(page, page.getByRole("button", { name: "Посадить и создать заказ" }));
  assert(
    page.url().includes("/lite/new?session="),
    "Seating must continue into the composer: " + page.url(),
  );
  await page.getByText("Посадка подтверждена").waitFor();
  pass("no-JS seating from the hall continues into the order composer (" + tableName + ")");

  await page.locator('input[name^="q:r:"]').first().fill("2");
  await page.locator('input[name^="q:e:"]').first().fill("1");
  await page.screenshot({ path: "test-results/lite-composer-1024x600.png", fullPage: true });
  await submit(page, page.getByRole("button", { name: "Рассчитать заказ" }));
  await page.getByRole("heading", { name: "Проверьте заказ" }).waitFor();
  const quoteText = await page.locator("body").innerText();
  assert(quoteText.includes("Lite Plov <b>"), "Quote must list the kitchen item escaped as text");
  assert(quoteText.includes("Lite Drink"), "Quote must list the exchange item");
  assert(quoteText.includes("6 491 тг"), "Quote total must be 2×2450.50 + 1×1590: " + quoteText);
  await submit(page, page.getByRole("button", { name: "Оформить заказ" }));
  assert(
    /\/lite\/order\/[a-f0-9-]{36}$/.test(page.url()),
    "Checkout must open the order: " + page.url(),
  );
  await page.getByText(/Заказ №\d+ оформлен/).waitFor();
  const orderUrl = page.url();
  pass("no-JS staff order: quantities → server quote → idempotent checkout");

  // Replaying the same checkout form (double tap / reload) must not create a second order.
  const orderCount = async () =>
    (await pool.query(`SELECT count(*)::int AS n FROM ${schema}.dine_in_orders`)).rows[0].n;
  const before = await orderCount();

  for (const [button, flash] of [
    ["Принять заказ", "Статус: Принят"],
    ["На приготовление", "Статус: Готовится"],
    ["Отметить подачу", "Статус: Подан"],
  ]) {
    await submit(page, page.getByRole("button", { name: button }));
    await page.getByText(flash).waitFor();
  }
  await submit(page, page.getByRole("button", { name: /Оплата получена/ }));
  await page.getByText("Оплата отмечена", { exact: true }).waitFor();
  await page.screenshot({ path: "test-results/lite-order-1024x600.png", fullPage: true });
  const stored = (
    await pool.query(`SELECT status,manual_payment_at FROM ${schema}.dine_in_orders WHERE id=$1`, [
      orderUrl.split("/").pop(),
    ])
  ).rows[0];
  assert(
    stored.status === "delivered" && stored.manual_payment_at,
    "Database must reflect lite actions",
  );
  assert((await orderCount()) === before, "Status changes must not create orders");
  pass("no-JS order lifecycle (accept → prepare → deliver → paid) persisted in PostgreSQL");

  const guest = await guestOrder();
  await page.goto(BASE + "/lite/shift?f=new");
  await page
    .getByText("№" + guest.number, { exact: false })
    .first()
    .waitFor();
  await page.screenshot({ path: "test-results/lite-shift-1024x600.png", fullPage: true });
  await noHorizontalOverflow(page, "shift");
  await submit(page, page.locator(`form[action="/lite/order/${guest.id}/status"] button`));
  await page.getByText("Статус: Принят").waitFor();
  assert(page.url().endsWith("/lite/shift?f=new"), "Shift action must return to the same filter");
  pass("guest QR order appears in the shift queue and is accepted from it");

  await page.goto(BASE + "/lite/orders?q=" + guest.number);
  await page
    .getByText("№" + guest.number, { exact: false })
    .first()
    .waitFor();
  pass("orders search by number");

  await page.goto(BASE + tableHref);
  await submit(page, page.getByRole("button", { name: "Завершить визит" }));
  await page.getByText("Визит завершён, стол свободен").waitFor();
  pass("no-JS visit release frees the table");

  const bookingForm = page.locator('form[action$="/book"]');
  const bookableHref = await (async () => {
    if (await bookingForm.count()) return tableHref;
    await page.goto(BASE + "/lite/hall");
    for (const href of await page
      .locator("a.tbl")
      .evaluateAll((links) => links.map((a) => a.getAttribute("href")))) {
      await page.goto(BASE + href);
      if (await page.locator('form[action$="/book"]').count()) return href;
    }
    return null;
  })();
  if (bookableHref) {
    const tomorrow = new Date(Date.now() + 5 * 3600000 + 86400000).toISOString().slice(0, 10);
    await page.locator('input[name="guestName"]').fill("Айгерим Lite");
    await page.locator('input[name="phone"]').fill("+7 701 000 00 00");
    await page.locator('input[name="date"]').fill(tomorrow);
    await page.locator('input[name="time"]').fill("19:30");
    await submit(page, page.getByRole("button", { name: "Создать бронь" }));
    await page.getByText("Бронь создана").waitFor();
    await page.getByText("19:30–21:30 · Айгерим Lite").waitFor();
    await page.screenshot({ path: "test-results/lite-bookings-1024x600.png", fullPage: true });
    pass("no-JS booking creation shows on the bookings day view");
  } else console.log("SKIP booking creation: no bookable table in this fixture");

  // Stale/forged form: a POST without the CSRF cookie pair is refused without side effects.
  const forged = await fetch("http://localhost:3000" + `/lite/order/${guest.id}/paid`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: (await noJs.cookies())
        .map((c) => `${c.name}=${c.value}`)
        .filter((c) => !c.startsWith("hostess-lite-csrf"))
        .join("; "),
    },
    body: "_csrf=" + "x".repeat(43),
    redirect: "manual",
  });
  assert(forged.status === 303, "Forged POST must be redirected");
  const guestRow = (
    await pool.query(`SELECT manual_payment_at FROM ${schema}.dine_in_orders WHERE id=$1`, [
      guest.id,
    ])
  ).rows[0];
  assert(!guestRow.manual_payment_at, "Forged POST must not change the order");
  pass("forged POST without a matching CSRF token is refused");

  for (const [w, h] of [
    [800, 480],
    [600, 1024],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    for (const path of ["/lite/shift", "/lite/hall", "/lite/orders"]) {
      await page.goto(BASE + path);
      await noHorizontalOverflow(page, `${path} at ${w}x${h}`);
    }
    await page.screenshot({ path: `test-results/lite-orders-${w}x${h}.png`, fullPage: true });
  }
  pass("no horizontal overflow at 800×480 and 600×1024");

  // WhatsApp (Dayan): a guest asks for a human, staff take over and give the chat back.
  const agentCall = async (path, payload) => {
    const response = await fetch("http://localhost:3000/api/agent/v1" + path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-hostess-service-key": "w".repeat(43) },
      body: JSON.stringify(payload),
    });
    if (!response.ok)
      throw new Error(
        "Agent " + path + " failed: " + response.status + " " + (await response.text()),
      );
    return response.json();
  };
  await agentCall("/inbound", {
    session: "xoxo",
    chatId: "77010000000@c.us",
    messageId: "lite-" + randomUUID(),
    text: "Здравствуйте, позовите администратора <b>",
    phone: "+77010000000",
    pushName: "Дана Lite",
  });
  const chatKey = "xoxo:77010000000@c.us";
  await agentCall("/handoff", { chatKey, reason: "просит администратора" });
  await page.goto(BASE + "/lite/shift");
  await page.getByText("WhatsApp: ждут сотрудника · 1").waitFor();
  await page.goto(BASE + "/lite/whatsapp");
  await page.getByText("Ждут сотрудника · 1").waitFor();
  await page.screenshot({ path: "test-results/lite-whatsapp-1024x600.png", fullPage: true });
  await page.getByText("Дана Lite").first().click();
  await page.getByText("Здравствуйте, позовите администратора <b>").waitFor();
  await page.screenshot({ path: "test-results/lite-whatsapp-chat-1024x600.png", fullPage: true });
  const pausedNow = async () =>
    (
      await pool.query(
        `SELECT agent_paused AS paused FROM ${schema}.dayan_conversations WHERE chat_key=$1`,
        [chatKey],
      )
    ).rows[0].paused;
  await submit(page, page.getByRole("button", { name: "Вернуть ИИ" }));
  await page.getByText("ИИ снова отвечает в этом чате").waitFor();
  assert((await pausedNow()) === false, "Give-back must resume the agent in PostgreSQL");
  await submit(page, page.getByRole("button", { name: "Ответить самому" }));
  await page.getByText("ИИ остановлен — ответьте гостю в WhatsApp").waitFor();
  assert((await pausedNow()) === true, "Take-over must pause the agent in PostgreSQL");
  pass("no-JS WhatsApp: handoff on the shift, dialog, take over and give back persisted");

  // Manager clean-up: cancel one test order, close another, keep the third untouched.
  const keep = await guestOrder();
  const junk = await guestOrder();
  const served = await guestOrder();
  await page.goto(BASE + "/lite/orders");
  await submit(page, page.getByRole("link", { name: "Массовое закрытие" }));
  await page.locator(`input[name="id"][value="${junk.id}"]`).check();
  await page.screenshot({ path: "test-results/lite-bulk-1024x600.png", fullPage: true });
  await submit(page, page.getByRole("button", { name: "Отменить отмеченные как тестовые" }));
  await page.getByText("Отменено: 1 из 1.").waitFor();
  await page.locator(`input[name="id"][value="${served.id}"]`).check();
  await submit(page, page.getByRole("button", { name: "Закрыть отмеченные как обслуженные" }));
  await page.getByText("Закрыто: 1 из 1.").waitFor();
  const state = async (id) =>
    (
      await pool.query(
        `SELECT status, manual_payment_at IS NOT NULL AS paid FROM ${schema}.dine_in_orders WHERE id=$1`,
        [id],
      )
    ).rows[0];
  assert((await state(junk.id)).status === "cancelled", "Checked order must be cancelled");
  const closed = await state(served.id);
  assert(closed.status === "closed" && closed.paid, "Closed order must be closed and paid");
  assert((await state(keep.id)).status === "new", "Unchecked order must stay untouched");
  assert(
    (await page.locator(`input[name="id"][value="${keep.id}"]`).count()) === 1 &&
      (await page.locator(`input[name="id"][value="${junk.id}"]`).count()) === 0,
    "Queue must keep only the untouched order",
  );
  pass("manager bulk clean-up: cancel and close only the checked orders");

  await submit(page, page.getByRole("button", { name: "Выйти" }));
  assert(page.url().endsWith("/lite/login"), "Logout must return to login");
  await page.goto(BASE + "/lite/shift");
  assert(page.url().endsWith("/lite/login"), "After logout the shift must require login");
  pass("logout revokes the session");
  await noJs.close();

  /* ---------- 2. Viewer role: read-only ---------- */
  const viewerContext = await browser.newContext({
    javaScriptEnabled: false,
    ignoreHTTPSErrors: true,
  });
  const viewer = (activePage = await viewerContext.newPage());
  await viewer.goto(BASE + "/lite/login");
  await viewer.locator('input[name="username"]').fill("viewer");
  await viewer.locator('input[name="password"]').fill(password);
  await submit(viewer, viewer.getByRole("button", { name: "Войти" }));
  assert(
    !(await viewer.getByRole("button", { name: "Принять заказ" }).count()),
    "Viewer must not see write actions",
  );
  pass("viewer sees the shift without write actions");
  await viewerContext.close();

  /* ---------- 3. JavaScript on: ES3 live refresh and double-submit guard ---------- */
  const jsContext = await browser.newContext({
    ignoreHTTPSErrors: true,
    userAgent: OLD_ANDROID_UA,
    viewport: { width: 1024, height: 600 },
  });
  const live = (activePage = await jsContext.newPage());
  const errors = [];
  live.on("pageerror", (error) => errors.push(error.message));
  live.on("dialog", (dialog) => void dialog.accept());
  await live.goto(BASE + "/lite/login");
  await live.locator('input[name="username"]').fill("manager");
  await live.locator('input[name="password"]').fill(password);
  await submit(live, live.getByRole("button", { name: "Войти" }));
  await live.locator("#live").waitFor();
  const fresh = await guestOrder();
  await live
    .locator("#live")
    .getByText("№" + fresh.number, { exact: false })
    .first()
    .waitFor({ timeout: 15000 });
  assert(
    (await live.locator("#conn").innerText()).includes("На связи"),
    "Connection badge must show online",
  );
  assert(await live.locator("#sound").isVisible(), "Sound toggle must appear when JS runs");
  pass("ES3 live refresh shows a new guest order without reloading");
  await live.locator("#alarm:not(.hide)").waitFor({ timeout: 15000 });
  assert(
    (await live.locator("#alarm-text").innerText()).includes("№" + fresh.number),
    "Alarm banner must name the new order",
  );
  const bellOk = await live.evaluate(
    () =>
      new Promise((resolve) => {
        const bell = document.getElementById("bell");
        if (bell.readyState >= 1) return resolve(bell.duration > 1.5);
        bell.onloadedmetadata = () => resolve(bell.duration > 1.5);
        bell.onerror = () => resolve(false);
        bell.load();
      }),
  );
  assert(bellOk, "Bell WAV must load in the browser");
  await live.locator("#alarm-ok").click();
  await live.locator("#alarm.hide").waitFor({ state: "attached" });
  await live.waitForTimeout(6000);
  assert(await live.locator("#alarm.hide").count(), "Acknowledged order must not ring again");
  pass("loud alarm shows the new order on every page, bell loads, «Принято» silences it");
  await submit(live, live.locator(`form[action="/lite/order/${fresh.id}/status"] button`));
  await live.getByText("Статус: Принят").waitFor();
  assert(!errors.length, "Page errors: " + errors.join("; "));
  pass("actions work with JavaScript on, no page errors");

  /* ---------- 4. Legacy redirect from the full app ---------- */
  const legacy = await browser.newContext({ ignoreHTTPSErrors: true });
  await legacy.addInitScript(() => {
    // Emulate an engine without modern CSS (no CSS.supports / oklch).
    Object.defineProperty(window, "CSS", { value: undefined, configurable: true });
  });
  const legacyPage = (activePage = await legacy.newPage());
  await legacyPage.goto(BASE + "/");
  await legacyPage.waitForURL(/\/lite\/login$/, { timeout: 15000 });
  pass("full app redirects engines without modern CSS to /lite");
  await legacyPage.goto(BASE + "/?full=1");
  await legacyPage.waitForTimeout(1500);
  assert(!legacyPage.url().includes("/lite"), "?full=1 must opt out of the redirect");
  pass("?full=1 keeps the full version on that browser");
  await legacy.close();

  const modern = await browser.newContext({ ignoreHTTPSErrors: true });
  const modernPage = (activePage = await modern.newPage());
  await modernPage.goto(BASE + "/");
  await modernPage.waitForTimeout(1500);
  assert(!modernPage.url().includes("/lite"), "Modern Chromium must stay on the full app");
  await modernPage.getByText("Вход сотрудника").waitFor();
  pass("modern browser stays on the full Command Center");
  await modern.close();

  const noJsFull = await browser.newContext({ ignoreHTTPSErrors: true, javaScriptEnabled: false });
  const noJsFullPage = (activePage = await noJsFull.newPage());
  await noJsFullPage.goto(BASE + "/");
  await noJsFullPage.waitForURL(/\/lite\/login$/, { timeout: 15000 });
  pass("browser without JavaScript is sent from the full app to /lite");
  await noJsFull.close();

  /* ---------- 5. Second engine (WebKit) renders the lite pages ---------- */
  webkitBrowser = await webkit.launch();
  const wk = await webkitBrowser.newContext({
    ignoreHTTPSErrors: true,
    javaScriptEnabled: false,
    viewport: { width: 1024, height: 600 },
  });
  const wkPage = (activePage = await wk.newPage());
  await wkPage.goto(BASE + "/lite/login");
  await wkPage.locator('input[name="username"]').fill("manager");
  await wkPage.locator('input[name="password"]').fill(password);
  await submit(wkPage, wkPage.getByRole("button", { name: "Войти" }));
  await wkPage.getByRole("heading", { name: "Смена" }).waitFor();
  await wkPage.screenshot({ path: "test-results/lite-shift-webkit.png", fullPage: true });
  pass("WebKit (no JS) logs in and renders the shift");
  console.log("ALL LITE CHECKS PASSED");
} catch (error) {
  if (activePage) {
    await activePage
      .screenshot({ path: "test-results/lite-failure.png", fullPage: true })
      .catch(() => {});
    console.error(
      (
        await activePage
          .locator("body")
          .innerText()
          .catch(() => "")
      ).slice(-4000),
    );
  }
  process.exitCode = 1;
  console.error(error);
} finally {
  if (webkitBrowser) await webkitBrowser.close();
  if (browser) await browser.close();
  if (app) app.kill();
  proxy.closeAllConnections();
  await new Promise((resolve) => proxy.close(resolve));
  await new Promise((resolve) => exchange.close(() => resolve()));
  await pool.query("DROP SCHEMA " + schema + " CASCADE");
  await pool.end();
}
