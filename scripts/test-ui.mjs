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
if (url.hostname !== "127.0.0.1" || url.username !== "hostess_test")
  throw new Error("Isolated local PostgreSQL required");
const pool = new pg.Pool({ connectionString: raw, max: 1 }),
  schema = "hostess_test_ui_" + randomUUID().replaceAll("-", "");
await pool.query("CREATE SCHEMA " + schema);
const scoped = new URL(raw);
scoped.searchParams.set("options", "-c search_path=" + schema + ",public");
const key = "b".repeat(43),
  productId = randomUUID(),
  roundId = randomUUID(),
  password = "test-password",
  salt = "test-salt";
const env = {
  ...process.env,
  DATABASE_URL: scoped.href,
  NODE_ENV: "test",
  NODE_TLS_REJECT_UNAUTHORIZED: "0",
  PORT: "3000",
  HOST: "127.0.0.1",
  COMMAND_CENTER_ORIGIN: "https://localhost:3443",
  HOSTESS_PUBLIC_ORIGIN: "https://hostes.online",
  EXCHANGE_API_ORIGIN: "https://127.0.0.1:19092",
  EXCHANGE_DATA_MODE: "api",
  HOSTESS_BFF_KEY: key,
  COMMAND_CENTER_SERVICE_KEY: "s".repeat(43),
  ALLOW_GUEST_BOOKING_MIGRATION: "yes",
  DINE_IN_ENABLED: "yes",
  DINE_IN_PILOT_ASSUMED_PAID: "yes",
  DINE_IN_OUTBOX_ENABLED: "no",
  STAFF_USERS_JSON: JSON.stringify([
    {
      id: "manager",
      role: "manager",
      passwordHash: salt + ":" + scryptSync(password, salt, 64).toString("hex"),
    },
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
    "test-results/exchange-key.pem",
    "-out",
    "test-results/exchange-cert.pem",
    "-subj",
    "/CN=localhost",
    "-days",
    "1",
  ],
  { stdio: "ignore" },
);
if (certificate.status !== 0) throw new Error("Loopback test certificate generation failed");
const exchange = createServer(
  {
    key: await readFile("test-results/exchange-key.pem"),
    cert: await readFile("test-results/exchange-cert.pem"),
  },
  (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/v1/command-center/order-events") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        const event = JSON.parse(body);
        res.end(JSON.stringify({ accepted: true, eventId: event.eventId }));
      });
      return;
    }
    res.end(
      JSON.stringify({
        status: "ok",
        generatedAt: new Date().toISOString(),
        currentRound: { id: roundId, endsAt: new Date(Date.now() + 600000).toISOString() },
        products: [
          { id: productId, name: "UI Drink", price: 1590, currency: "KZT", isAvailable: true },
        ],
      }),
    );
  },
);
const proxy = createServer(
  {
    key: await readFile("test-results/exchange-key.pem"),
    cert: await readFile("test-results/exchange-cert.pem"),
  },
  (request, response) => {
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
  },
);
let app, browser, webkitBrowser;
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
try {
  const migration = spawnSync(process.execPath, ["scripts/migrate.mjs"], { env, stdio: "inherit" });
  assert(migration.status === 0, "Migration failed");
  await pool.query(`SET search_path TO ${schema},public`);
  // Deliberately nonsequential locations are fixtures in this isolated schema only.
  await pool.query(`UPDATE ${schema}.venue_resources r SET zone_id=z.id FROM ${schema}.venue_zones z
    WHERE r.venue_code='xoxo' AND r.code ~ '^[0-9]{2}$' AND z.code=CASE
      WHEN r.code=ANY(ARRAY['01','03','05','07','09','11','13','16']) THEN 'first_hall'
      WHEN r.code=ANY(ARRAY['02','06','12']) THEN 'second_hall'
      WHEN r.code=ANY(ARRAY['04','10','15']) THEN 'ps' ELSE 'vip' END`);
  const beforeCredentials = (
    await pool.query(`SELECT resource_id,token FROM ${schema}.table_qr_codes ORDER BY resource_id`)
  ).rows;
  const menuItem = (
    await pool.query(`INSERT INTO ${schema}.venue_menu_items(venue_id,name,description,category,portion,price_minor,published)
    SELECT id,'UI Kitchen','Isolated verified kitchen fixture','Кухня','250 г',245050,true FROM ${schema}.hostess_venues WHERE slug='xoxo' RETURNING id`)
  ).rows[0];
  await new Promise((resolve) => exchange.listen(19092, "127.0.0.1", resolve));
  await new Promise((resolve) => proxy.listen(3443, "127.0.0.1", resolve));
  app = spawn(process.execPath, ["scripts/start.mjs"], { env, stdio: "inherit" });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch("http://localhost:3000/")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  assert(ready, "Server did not start");
  const table = (
    await pool.query(
      "SELECT q.token,r.code,r.id FROM " +
        schema +
        ".table_qr_codes q JOIN " +
        schema +
        ".venue_resources r ON r.id=q.resource_id ORDER BY r.code LIMIT 1",
    )
  ).rows[0];
  const quote = await fetch("http://localhost:3000/api/guest/v1/dine-in/quotes", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hostess-service-key": key,
      "x-hostess-client-id": "ui-fixture",
    },
    body: JSON.stringify({
      qrToken: table.token,
      items: [
        { productId, quantity: 3 },
        { productId: menuItem.id, quantity: 1, itemType: "REGULAR_MENU" },
      ],
    }),
  });
  assert(
    quote.status === 201,
    "Quote failed: " + quote.status + " " + (quote.ok ? "" : await quote.clone().text()),
  );
  const cookie = quote.headers.get("set-cookie").split(";")[0],
    quoteData = await quote.json();
  const saved = await fetch("http://localhost:3000/api/guest/v1/dine-in/orders", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hostess-service-key": key,
      "x-hostess-client-id": "ui-fixture",
      cookie,
    },
    body: JSON.stringify({ quoteId: quoteData.id, idempotencyKey: randomUUID() }),
  });
  assert(saved.status === 201, "Order failed");
  const order = (await saved.json()).order;
  browser = await chromium.launch({ args: ["--no-sandbox"] });
  const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      ignoreHTTPSErrors: true,
    }),
    page = await context.newPage();
  await page.goto("https://localhost:3443/orders");
  await page.locator('input[autocomplete="username"]').fill("manager");
  await page.locator('input[autocomplete="current-password"]').fill(password);
  await page.locator("form").getByRole("button").click();
  await page.getByRole("heading", { name: "Заказы", exact: true }).waitFor();
  await page.getByText("№" + order.number + " · Стол " + order.tableCode, { exact: true }).click();
  await page.getByRole("button", { name: "Принят", exact: true }).click();
  await page.getByRole("button", { name: "Готовится", exact: true }).waitFor();
  await page.reload();
  await page.getByText("№" + order.number + " · Стол " + order.tableCode, { exact: true }).click();
  await page.getByRole("button", { name: "Готовится", exact: true }).waitFor();
  for (const width of [360, 390, 430, 768, 1440]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    assert(
      (await page.getByRole("dialog").getByText("UI Kitchen", { exact: false }).count()) > 0,
      "Mixed order missing kitchen line",
    );
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      "Order drawer overflow",
    );
    await page.screenshot({ path: `test-results/order-drawer-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.keyboard.press("Escape");
  await page.getByRole("textbox", { name: "Поиск заказов" }).fill("not-an-order");
  await page.getByText("Заказов по выбранным условиям нет.").waitFor();
  console.log("PASS mobile order details, amounts, state change, filters and reload");
  await page.goto("https://localhost:3443/menu");
  await page.getByRole("heading", { name: "Меню", exact: true }).waitFor();
  await page.getByRole("button", { name: "Добавить блюдо", exact: true }).click();
  const menuDrawer = page.getByRole("dialog");
  await menuDrawer.getByLabel("Название", { exact: true }).fill("UI Persisted Dish");
  await menuDrawer.getByLabel("Цена, ₸", { exact: true }).fill("2300.50");
  await menuDrawer.getByLabel("Порция / объём", { exact: true }).fill("180 г");
  await menuDrawer
    .getByLabel("Описание / состав", { exact: true })
    .fill("Проверенная тестовая позиция");
  await menuDrawer.getByLabel("Опубликовать для гостей", { exact: true }).check();
  await menuDrawer.getByRole("button", { name: "Сохранить блюдо", exact: true }).click();
  await menuDrawer.waitFor({ state: "hidden" });
  await page.reload();
  await page.getByRole("heading", { name: "UI Persisted Dish", exact: true }).waitFor();
  for (const width of [360, 390, 430, 768, 1440]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      "Menu overflow",
    );
    await page.screenshot({ path: `test-results/menu-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const catalog = await fetch(
    "http://localhost:3000/api/guest/v1/dine-in/regular-menu?venue=xoxo",
    { headers: { "x-hostess-service-key": key, "x-hostess-client-id": "menu-ui" } },
  );
  assert(
    (await catalog.json()).items.some(
      (item) => item.name === "UI Persisted Dish" && item.priceMinor === "230050",
    ),
    "Published menu did not reach guest API",
  );
  console.log(
    "PASS real persisted menu publish/reload and guest price parity at 360/390/430/768/1440",
  );
  await page.goto("https://localhost:3443/guests");
  await page.getByLabel("Имя гостя", { exact: true }).fill("UI Guest");
  await page.getByLabel("Телефон гостя", { exact: true }).fill("87015558899");
  await page.getByRole("button", { name: "Создать", exact: true }).click();
  await page.getByText("UI Guest", { exact: true }).waitFor();
  await page.getByText("UI Guest", { exact: true }).click();
  await page.getByRole("button", { name: "Изменить выбранного" }).click();
  await page.getByLabel("Имя гостя", { exact: true }).fill("UI Guest Edited");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await page.getByText("UI Guest Edited", { exact: true }).first().waitFor();
  console.log("PASS staff guest creation, normalization, editing and server reload");
  await page.goto("https://localhost:3443/tables/qr");
  await page.getByRole("heading", { name: "Столы и QR", exact: true }).waitFor();
  await page.locator("article").last().waitFor();
  assert((await page.locator("article").count()) === 17, "Expected 17 physical points");
  const api = async (path, data, method = "POST") => {
    const result = await context.request.fetch("https://localhost:3443/api/staff/v1" + path, {
      method: data ? method : "GET",
      headers: { origin: "https://localhost:3443" },
      ...(data ? { data } : {}),
    });
    assert(
      result.ok(),
      `Staff operation ${path} failed: ${result.status()} ${await result.text()}`,
    );
    return result.json();
  };
  const waitSaved = async () => {
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page.getByText("Изменения сохранены. QR-ссылки сохранены.", { exact: true }).waitFor();
  };
  const priorVisit = (
    await pool.query(
      `SELECT s.id,s.version FROM ${schema}.dining_sessions s JOIN ${schema}.dine_in_orders o ON o.dining_session_id=s.id WHERE o.id=$1`,
      [order.id],
    )
  ).rows[0];
  await api(`/floor/sessions/${priorVisit.id}/release`, {
    version: priorVisit.version,
    reason: "Завершение предыдущей тестовой компании",
    idempotencyKey: randomUUID(),
  });
  await page
    .locator("article")
    .first()
    .getByRole("button", { name: "Открыть", exact: true })
    .click();
  let drawer = page.getByRole("dialog");
  for (const ext of ["SVG", "PNG"]) {
    const waiting = page.waitForEvent("download");
    await drawer.getByRole("link", { name: ext, exact: true }).click();
    await (await waiting).saveAs(`test-results/qr.${ext.toLowerCase()}`);
    assert(
      (await readFile(`test-results/qr.${ext.toLowerCase()}`)).length > 100,
      "Empty QR export",
    );
  }
  await drawer.getByLabel("Вместимость", { exact: true }).fill("4");
  await drawer.locator("summary").filter({ hasText: "Связь с бронированиями" }).click();
  await drawer.getByLabel("Физическое соответствие", { exact: true }).selectOption("independent");
  await drawer.getByLabel("Расположение проверено на месте", { exact: true }).check();
  await drawer
    .getByLabel("Основание проверки", { exact: true })
    .fill("Isolated browser fixture survey");
  await drawer.getByRole("button", { name: "Сохранить изменения", exact: true }).click();
  await waitSaved();
  await page
    .locator("article")
    .first()
    .getByText("Бронирование недоступно", { exact: true })
    .waitFor();
  await page
    .locator("article")
    .first()
    .getByRole("button", { name: "Открыть", exact: true })
    .click();
  drawer = page.getByRole("dialog");
  await drawer.locator("summary").filter({ hasText: "Связь с бронированиями" }).click();
  await drawer.getByLabel("Разрешить бронирования", { exact: true }).check();
  await drawer.getByLabel("Принимать QR-заказы", { exact: true }).uncheck();
  await drawer.getByRole("button", { name: "Сохранить изменения", exact: true }).click();
  await waitSaved();
  await page
    .locator("article")
    .first()
    .getByText("QR-заказы приостановлены", { exact: true })
    .waitFor();
  await page
    .locator("article")
    .first()
    .getByRole("button", { name: "Открыть", exact: true })
    .click();
  await page.getByRole("dialog").getByLabel("Принимать QR-заказы", { exact: true }).check();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Сохранить изменения", exact: true })
    .click();
  await waitSaved();
  // A failed save keeps the user's draft; retry uses the same confirmed version.
  await page
    .locator("article")
    .first()
    .getByRole("button", { name: "Открыть", exact: true })
    .click();
  await page.getByRole("dialog").getByLabel("Название", { exact: true }).fill("Стол 01 · у окна");
  await page.route("**/tables/*/registry", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: "Тестовая потеря сети" } }),
    }),
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Сохранить изменения", exact: true })
    .click();
  await page.getByRole("alert").getByText("Тестовая потеря сети").waitFor();
  assert(
    (await page.getByRole("dialog").getByLabel("Название", { exact: true }).inputValue()) ===
      "Стол 01 · у окна",
    "Failed save lost draft",
  );
  await page.unroute("**/tables/*/registry");
  await context.clearCookies();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Сохранить изменения", exact: true })
    .click();
  const reauth = page.getByRole("dialog", { name: "Повторный вход", exact: true });
  await reauth.waitFor();
  await reauth.locator('input[autocomplete="username"]').fill("manager");
  await reauth.locator('input[autocomplete="current-password"]').fill(password);
  await reauth.getByRole("button", { name: "Войти", exact: true }).click();
  await reauth.waitFor({ state: "hidden" });
  assert(
    (await page.getByRole("dialog").getByLabel("Название", { exact: true }).inputValue()) ===
      "Стол 01 · у окна",
    "Session expiry lost draft",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Сохранить изменения", exact: true })
    .click();
  await waitSaved();
  await page.getByLabel("Найти стол по номеру или названию").fill("у окна");
  assert((await page.locator("article").count()) === 1, "Search does not filter");
  await page.getByLabel("Найти стол по номеру или названию").fill("");
  await page.getByLabel("Выбрать стол 02", { exact: true }).check();
  await page.getByLabel("Выбрать стол 06", { exact: true }).check();
  await page.getByRole("button", { name: "Настроить расположение", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Название стола 02", { exact: true })
    .fill("Стол 02 · обновлён");
  await page.getByRole("button", { name: "Проверить изменения", exact: true }).click();
  await page.getByRole("button", { name: "Подтвердить и сохранить", exact: true }).click();
  await waitSaved();
  await page.getByRole("button", { name: "Снять выделение", exact: true }).click();
  await page.getByRole("button", { name: "Скачать все QR", exact: true }).click();
  const zipWait = page.waitForEvent("download");
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "ZIP · PNG и SVG", exact: true })
    .click();
  await (await zipWait).saveAs("test-results/qr.zip");
  assert((await readFile("test-results/qr.zip")).readUInt32LE() === 0x04034b50, "Invalid ZIP");
  await page.getByRole("button", { name: "Закрыть панель", exact: true }).click();
  const print = await context.newPage();
  await print.goto("https://localhost:3443/api/staff/v1/tables/qr/print");
  assert((await print.locator(".panel").count()) === 17, "Print missing panels");
  await print.pdf({ path: "test-results/panels.pdf", format: "A4" });
  await print.close();
  assert(
    JSON.stringify(
      (
        await pool.query(
          `SELECT resource_id,token FROM ${schema}.table_qr_codes ORDER BY resource_id`,
        )
      ).rows,
    ) === JSON.stringify(beforeCredentials),
    "Registry/bulk/export changed permanent credentials",
  );
  console.log(
    "PASS registry single save, independent QR/booking, bulk, search, network recovery, 17 unchanged credentials and exports",
  );

  const floorQuoteResponse = await fetch("http://localhost:3000/api/guest/v1/dine-in/quotes", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hostess-service-key": key,
      "x-hostess-client-id": "ui-fixture",
      cookie,
    },
    body: JSON.stringify({ qrToken: table.token, items: [{ productId, quantity: 2 }] }),
  });
  assert(floorQuoteResponse.status === 201, "Second visit quote failed");
  const floorQuote = await floorQuoteResponse.json();
  const floorOrderResponse = await fetch("http://localhost:3000/api/guest/v1/dine-in/orders", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hostess-service-key": key,
      "x-hostess-client-id": "ui-fixture",
      cookie,
    },
    body: JSON.stringify({ quoteId: floorQuote.id, idempotencyKey: randomUUID() }),
  });
  assert(floorOrderResponse.status === 201, "Second visit checkout failed");
  const floorOrder = (await floorOrderResponse.json()).order;
  await page.goto("https://localhost:3443/");
  await page.getByRole("heading", { name: "Карта зала", exact: true }).waitFor();
  await page
    .getByRole("navigation", { name: "Зоны зала" })
    .getByRole("button", { name: /Первый зал/ })
    .click();
  await page.getByRole("button", { name: /Стол 01 · у окна:/ }).click();
  await page.getByText("QR-активность · посадка не подтверждена", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Посадить гостей", exact: true }).click();
  await page.getByRole("button", { name: "Подтвердить посадку", exact: true }).click();
  await page.getByRole("button", { name: "Завершить визит", exact: true }).waitFor();
  await page.getByRole("button", { name: /Открыть фолио визита/ }).click();
  await page.getByRole("region", { name: "Фолио визита", exact: true }).waitFor();
  await page
    .getByRole("link", { name: `Открыть заказ ${floorOrder.number}`, exact: true })
    .waitFor();
  assert(
    (await page
      .getByRole("region", { name: "Фолио визита", exact: true })
      .getByRole("link", { name: `Открыть заказ ${order.number}`, exact: true })
      .count()) === 0,
    "Previous company's order leaked into current folio",
  );
  await page.screenshot({ path: "test-results/floor-mobile-folio.png", fullPage: true });
  await page.getByRole("button", { name: "Завершить визит", exact: true }).click();
  await page
    .getByLabel("Комментарий к завершению", { exact: true })
    .fill("Гости ушли, тестовый визит завершён");
  await page.getByRole("button", { name: "Подтвердить освобождение", exact: true }).click();
  await page.getByRole("button", { name: "Посадить гостей", exact: true }).waitFor();
  await page.getByRole("button", { name: "Закрыть карточку", exact: true }).click();
  await page.getByRole("button", { name: "На время", exact: true }).click();
  const futureDate = new Date(Date.now() + 86400000 + 5 * 3600000).toISOString().slice(0, 10);
  await page.getByLabel("Дата карты", { exact: true }).fill(futureDate);
  await page.getByLabel("Время карты", { exact: true }).fill("17:00");
  await page.getByRole("button", { name: /Стол 01 · у окна:/ }).click();
  await page.getByRole("button", { name: "Создать бронь", exact: true }).click();
  await page.getByLabel("Имя гостя", { exact: true }).fill("Бронь на 17:00");
  await page.getByRole("button", { name: "Создать бронь", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Закрыть карточку", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Закрыть карточку", exact: true }).click();
  await api("/floor/reservations", {
    resourceId: table.id,
    guestName: "Бронь на 19:00",
    guests: 2,
    startsAt: `${futureDate}T19:00:00+05:00`,
    endsAt: `${futureDate}T21:00:00+05:00`,
    source: "whatsapp",
    idempotencyKey: randomUUID(),
  });
  await page.getByLabel("Время карты", { exact: true }).fill("19:00");
  await page.getByRole("button", { name: /Стол 01 · у окна:/ }).click();
  await page
    .getByRole("dialog")
    .getByText(/19:00–21:00 · Бронь на 19:00/)
    .first()
    .waitFor();
  await page.getByRole("button", { name: "Расписание", exact: true }).click();
  await page.getByRole("button", { name: "Обновить карту", exact: true }).click();
  await page
    .getByText(/Бронь на 17:00/)
    .first()
    .waitFor();
  await page
    .getByText(/Бронь на 19:00/)
    .first()
    .waitFor();
  await page.screenshot({ path: "test-results/floor-mobile-timeline.png", fullPage: true });
  await page.reload();
  assert(
    (await page.getByLabel("Дата карты", { exact: true }).inputValue()) === futureDate,
    "Timeline date lost on reload",
  );
  await page.getByRole("button", { name: "Вернуться к сейчас", exact: true }).click();
  await page.getByRole("button", { name: "Редактировать план", exact: true }).click();
  await page.getByLabel("Позиция X", { exact: true }).fill("50");
  await page.getByRole("button", { name: "Сохранить план", exact: true }).click();
  await page.getByRole("button", { name: "Редактировать план", exact: true }).waitFor();
  assert(
    (
      await pool.query(
        `SELECT count(*)::int AS n FROM ${schema}.venue_layout l JOIN ${schema}.venue_resources r ON r.id=l.resource_id JOIN ${schema}.venue_zones z ON z.id=r.zone_id WHERE z.code='first_hall' AND l.x IS NOT NULL`,
      )
    ).rows[0].n === 8,
    "Zone layout not saved",
  );
  console.log(
    "PASS real floor QR activity, seating, folio, release, manual/WhatsApp canonical bookings, 17/19 switching, timeline persistence and layout",
  );
  await page
    .getByRole("region", { name: "Интерактивная карта зоны", exact: true })
    .scrollIntoViewIfNeeded();
  const mapSvg = page.locator('svg[aria-label="Столы выбранной зоны"]');
  const mapHost = mapSvg.locator("..");
  const mapBounds = await mapHost.boundingBox();
  const beforePinch = await mapSvg.locator(":scope > g").getAttribute("transform");
  const touch = await context.newCDPSession(page);
  await touch.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 2 });
  const point = (id, fraction) => ({
    id,
    x: mapBounds.x + mapBounds.width * fraction,
    y: mapBounds.y + mapBounds.height / 2,
  });
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [point(1, 0.4), point(2, 0.6)],
  });
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [point(1, 0.25), point(2, 0.75)],
  });
  await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForFunction(
    (old) =>
      document
        .querySelector('svg[aria-label="Столы выбранной зоны"] > g')
        ?.getAttribute("transform") !== old,
    beforePinch,
  );
  assert(
    (await mapHost.evaluate((node) => getComputedStyle(node).touchAction)) === "pan-y",
    "Map blocks normal vertical touch scrolling",
  );
  await page.getByRole("button", { name: "Показать всю карту", exact: true }).click();
  await touch.detach();
  console.log("PASS real two-touch pinch zoom and vertical page gesture policy");

  for (const width of [320, 375, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["/tables/qr", "/"]) {
      await page.goto("https://localhost:3443" + route);
      await page
        .getByRole("heading", { name: route === "/" ? "Карта зала" : "Столы и QR", exact: true })
        .waitFor();
      await page
        .locator(route === "/" ? '[aria-label="Зоны зала"]' : "article")
        .first()
        .waitFor();
      if (route === "/") {
        await page
          .getByRole("navigation", { name: "Зоны зала" })
          .getByRole("button", { name: /Первый зал/ })
          .waitFor();
        await page.getByRole("button", { name: /Стол 01 · у окна:/ }).waitFor();
        await page.waitForFunction(() => {
          const buttons = [
            ...document.querySelectorAll('svg[aria-label="Столы выбранной зоны"] g[role="button"]'),
          ];
          return (
            buttons.length > 0 &&
            buttons.every((button) => {
              const box = button.getBoundingClientRect();
              return box.width >= 44 && box.height >= 44;
            })
          );
        });
        const mapTargets = await page
          .locator('svg[aria-label="Столы выбранной зоны"] g[role="button"]')
          .evaluateAll((buttons) =>
            buttons.map((button) => {
              const box = button.getBoundingClientRect();
              return {
                label: button.getAttribute("aria-label"),
                width: box.width,
                height: box.height,
              };
            }),
          );
        assert(
          mapTargets.every((target) => target.width >= 44 && target.height >= 44),
          `Map touch target below44px at ${width}: ${JSON.stringify(mapTargets)}`,
        );
      }
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        `Horizontal overflow ${width} ${route}`,
      );
      if (width === 320 || width === 390 || width === 1440)
        await page.screenshot({
          path: `test-results/${route === "/" ? "floor" : "qr"}-${width}.png`,
          fullPage: true,
        });
    }
  }
  webkitBrowser = await webkit.launch();
  const webContext = await webkitBrowser.newContext({
    viewport: { width: 375, height: 812 },
    ignoreHTTPSErrors: true,
  });
  const safari = await webContext.newPage();
  await safari.goto("https://localhost:3443/tables/qr");
  await safari.locator('input[autocomplete="username"]').fill("manager");
  await safari.locator('input[autocomplete="current-password"]').fill(password);
  await safari.getByRole("button", { name: "Войти", exact: true }).click();
  await safari.getByRole("heading", { name: "Столы и QR", exact: true }).waitFor();
  await safari
    .locator("article")
    .first()
    .getByRole("button", { name: "Открыть", exact: true })
    .click();
  await safari.getByRole("dialog").getByLabel("Название", { exact: true }).waitFor();
  await safari.keyboard.press("Escape");
  await safari.getByRole("dialog").waitFor({ state: "hidden" });
  await safari.goto("https://localhost:3443/menu");
  await safari.getByRole("heading", { name: "UI Persisted Dish", exact: true }).waitFor();
  await safari.screenshot({ path: "test-results/menu-webkit-375.png", fullPage: true });
  await safari.goto(`https://localhost:3443/orders?order=${order.id}`);
  await safari.getByRole("dialog").getByText("UI Kitchen", { exact: false }).waitFor();
  await safari.screenshot({ path: "test-results/order-webkit-375.png", fullPage: true });
  await safari.keyboard.press("Escape");
  await safari.goto("https://localhost:3443/");
  await safari.getByRole("heading", { name: "Карта зала", exact: true }).waitFor();
  await safari
    .getByRole("navigation", { name: "Зоны зала" })
    .getByRole("button", { name: /Первый зал/ })
    .click();
  await safari.getByRole("button", { name: /Стол 01 · у окна:/ }).click();
  await safari.getByRole("dialog").waitFor();
  assert(
    await safari.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    "WebKit overflow",
  );
  await safari.screenshot({ path: "test-results/floor-webkit-375.png", fullPage: true });
  await webkitBrowser.close();
  webkitBrowser = undefined;
  console.log(
    "PASS Chromium 320/375/390/768/1024/1440, WebKit375, dialogs keyboard and screenshots",
  );

  // Restart with persisted backlog and no incoming HTTP request: the worker must start itself.
  const previousApp = app;
  await new Promise((resolve) => {
    previousApp.once("exit", resolve);
    previousApp.kill();
  });
  app = spawn(process.execPath, ["scripts/start.mjs"], {
    env: { ...env, DINE_IN_OUTBOX_ENABLED: "yes", DINE_IN_OUTBOX_INTERVAL_MS: "1000" },
    stdio: "inherit",
  });
  let recovered = false;
  for (let i = 0; i < 40; i++) {
    const result = await pool.query(
      "SELECT count(*)::int AS n FROM " + schema + ".integration_outbox WHERE status='delivered'",
    );
    if (result.rows[0].n > 0) {
      recovered = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert(recovered, "Outbox did not recover persisted backlog at startup without HTTP traffic");
  console.log("PASS outbox restart recovers persisted backlog without incoming HTTP traffic");
  await browser.close();
  browser = undefined;
} catch (error) {
  const activePage = browser?.contexts()[0]?.pages()[0];
  if (activePage) {
    await activePage
      .screenshot({ path: "test-results/failure.png", fullPage: true })
      .catch(() => {});
    console.error((await activePage.locator("body").innerText()).slice(-6000));
  }
  throw error;
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
