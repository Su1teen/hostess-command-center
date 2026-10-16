import { chromium } from "@playwright/test";
import pg from "pg";
import { createServer } from "node:https";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID, scryptSync } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
const raw = process.env.TEST_DATABASE_URL;
if (!raw) throw new Error("TEST_DATABASE_URL required");
const url = new URL(raw);
if (url.hostname !== "127.0.0.1" || url.username !== "hostess_test")
  throw new Error("Isolated local PostgreSQL required");
const pool = new pg.Pool({ connectionString: raw }),
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
  COMMAND_CENTER_ORIGIN: "http://localhost:3000",
  HOSTESS_PUBLIC_ORIGIN: "https://hostess.online",
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
  "openssl",
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
let app, browser;
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
try {
  const migration = spawnSync(process.execPath, ["scripts/migrate.mjs"], { env, stdio: "inherit" });
  assert(migration.status === 0, "Migration failed");
  await new Promise((resolve) => exchange.listen(19092, "127.0.0.1", resolve));
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
      "SELECT q.token,r.code FROM " +
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
    body: JSON.stringify({ qrToken: table.token, items: [{ productId, quantity: 3 }] }),
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
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } }),
    page = await context.newPage();
  await page.goto("http://localhost:3000/orders");
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
  await page.getByRole("textbox", { name: "Поиск заказов" }).fill("not-an-order");
  await page.getByText("Заказов по выбранным условиям нет.").waitFor();
  console.log("PASS mobile order details, amounts, state change, filters and reload");
  await page.goto("http://localhost:3000/guests");
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
  await page.goto("http://localhost:3000/tables/qr");
  await page.getByRole("heading", { name: "QR-панели", exact: true }).waitFor();
  await page.locator("article").last().waitFor();
  assert((await page.locator("article").count()) === 17, "Expected 17 table panels");
  await mkdir("test-results", { recursive: true });
  for (const ext of ["SVG", "PNG"]) {
    const waiting = page.waitForEvent("download");
    await page
      .locator("article")
      .first()
      .getByRole("link", { name: ext.toLowerCase(), exact: true })
      .click();
    const download = await waiting;
    await download.saveAs("test-results/qr." + ext.toLowerCase());
    const bytes = await readFile("test-results/qr." + ext.toLowerCase());
    assert(bytes.length > 100, "Empty QR download");
  }
  const zipWait = page.waitForEvent("download");
  await page.getByRole("link", { name: "Все SVG и PNG · ZIP" }).click();
  await (await zipWait).saveAs("test-results/qr.zip");
  assert((await readFile("test-results/qr.zip")).readUInt32LE() === 0x04034b50, "Invalid ZIP");
  await page.getByRole("button", { name: "Проверить комплект", exact: true }).click();
  await page.getByText("Сохранено", { exact: true }).waitFor();
  assert(
    (
      await pool.query("SELECT token FROM " + schema + ".table_qr_codes WHERE token=$1", [
        table.token,
      ])
    ).rowCount === 1,
    "Bootstrap changed token",
  );
  await page.locator("article").first().getByRole("checkbox").uncheck();
  await page
    .locator("article")
    .first()
    .getByRole("button", { name: "Сохранить", exact: true })
    .click();
  await page.locator("article").first().getByText("Отключён", { exact: true }).waitFor();
  await page.locator("article").first().getByRole("checkbox").check();
  await page
    .locator("article")
    .first()
    .getByRole("button", { name: "Сохранить", exact: true })
    .click();
  await page.locator("article").first().getByText("Заказы включены", { exact: true }).waitFor();
  await page
    .locator("article")
    .first()
    .getByRole("button", { name: "Перевыпустить QR", exact: true })
    .click();
  await page
    .locator("article")
    .first()
    .getByRole("button", { name: "Перевыпустить", exact: true })
    .click();
  await page.waitForFunction(
    (old) => !document.querySelector("article a").href.endsWith(old),
    table.token,
  );
  assert(
    (
      await pool.query("SELECT token FROM " + schema + ".table_qr_codes WHERE token=$1", [
        table.token,
      ])
    ).rowCount === 0,
    "Old token still active",
  );
  const print = await context.newPage();
  await print.goto("http://localhost:3000/api/staff/v1/tables/qr/print");
  assert((await print.locator(".panel").count()) === 17, "Printable panels missing");
  await print.pdf({ path: "test-results/panels.pdf", format: "A4" });
  console.log(
    "PASS 17 QR panels, SVG/PNG/ZIP downloads, bootstrap, enabled state, rotation and print PDF",
  );
  await browser.close();
  browser = undefined;
} finally {
  if (browser) await browser.close();
  if (app) app.kill();
  await new Promise((resolve) => exchange.close(() => resolve()));
  await pool.query("DROP SCHEMA " + schema + " CASCADE");
  await pool.end();
}
