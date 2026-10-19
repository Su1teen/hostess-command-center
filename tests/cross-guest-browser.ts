import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { get } from "node:https";
import { pathToFileURL } from "node:url";
import { chromium, type Page } from "@playwright/test";

/** Real guest UI and real BFF, without page.route or mocked fetch. */
export async function guestBrowserCheckout(input: {
  hostessRoot: string;
  senderOrigin: string;
  exchangeOrigin: string;
  productName: string;
  onCreated: (id: string) => Promise<void>;
}) {
  mkdirSync("test-results", { recursive: true });
  const keyPath = resolve("test-results/cross-key.pem"),
    certPath = resolve("test-results/cross-cert.pem");
  const cert = spawnSync(
    process.platform === "win32" ? "C:/Program Files/Git/usr/bin/openssl.exe" : "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-subj",
      "/CN=localhost",
      "-days",
      "1",
    ],
    { stdio: "ignore", windowsHide: true },
  );
  assert.equal(cert.status, 0, "Local test certificate failed");
  const entry = `import {createServer} from ${JSON.stringify(pathToFileURL(resolve(input.hostessRoot, "node_modules/vite/dist/node/index.js")).href)};import {readFileSync} from 'node:fs';const server=await createServer({root:${JSON.stringify(input.hostessRoot)},configFile:${JSON.stringify(resolve(input.hostessRoot, "vite.config.ts"))},server:{host:'127.0.0.1',port:5191,strictPort:true,https:{key:readFileSync(${JSON.stringify(keyPath)}),cert:readFileSync(${JSON.stringify(certPath)})}}});await server.listen();`;
  const server = spawn(process.execPath, ["--input-type=module", "-e", entry], {
    cwd: input.hostessRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      BOOKING_API_ORIGIN: input.senderOrigin,
      EXCHANGE_API_ORIGIN: input.exchangeOrigin,
    },
    stdio: "pipe",
    windowsHide: true,
  });
  let logs = "";
  server.stdout.on("data", (d) => (logs += d));
  server.stderr.on("data", (d) => (logs += d));
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let activePage: Page | undefined;
  try {
    let ready = false;
    for (let n = 0; n < 60; n++) {
      const up = await new Promise<boolean>((r) => {
        const req = get(
          "https://localhost:5191/guest-claim.css",
          { rejectUnauthorized: false },
          (res) => {
            res.resume();
            r(res.statusCode === 200);
          },
        );
        req.on("error", () => r(false));
      });
      if (up) {
        ready = true;
        break;
      }
      if (server.exitCode !== null) throw new Error(logs.slice(-2000));
      await new Promise((r) => setTimeout(r, 500));
    }
    assert.ok(ready, logs.slice(-2000));
    browser = await chromium.launch();
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    activePage = page;
    page.setDefaultTimeout(30000);
    page.on("response", (r) => {
      const path = new URL(r.url()).pathname;
      if (path.startsWith("/api/guest/"))
        console.log(
          "Browser API",
          r.request().method(),
          path.includes("/tables/") ? "/api/guest/v1/dine-in/tables/[redacted]" : path,
          r.status(),
        );
    });
    await page.goto("https://localhost:5191/xoxo");
    await page.getByRole("button", { name: "Я уже в XOXO", exact: true }).click();
    await page.getByRole("button", { name: /^Стол 01 / }).click();
    await page.getByRole("button", { name: "Продолжить как гость", exact: true }).click();
    await page.getByText("Стол №01", { exact: true }).waitFor();
    await page.getByRole("button", { name: /XOXO MARKET Биржа напитков/ }).click();
    await page.getByRole("button", { name: `Добавить ${input.productName}`, exact: true }).click();
    await page.getByRole("button", { name: /Корзина · 1/ }).click();
    const cart = page
      .getByRole("dialog")
      .filter({ has: page.getByRole("heading", { name: "Стол №01 · XOXO", exact: true }) });
    await cart.getByRole("button", { name: "Проверить сумму", exact: true }).click();
    await cart.getByRole("button", { name: /^Заказать ·/ }).waitFor();
    const response = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        new URL(r.url()).pathname === "/api/guest/v1/dine-in/orders",
    );
    await cart.getByRole("button", { name: /^Заказать ·/ }).click();
    const accepted = await response;
    assert.equal(accepted.status(), 201, await accepted.text());
    const order = (await accepted.json()).order;
    assert.equal(order.source, "web_app");
    assert.equal(order.status, "new");
    await cart.getByRole("button", { name: "Заказать ещё", exact: true }).waitFor();
    await input.onCreated(order.id);
    await cart.getByText("Принят сотрудником", { exact: true }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: "test-results/cross-web-order-mobile.png", fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: "test-results/cross-web-order-desktop.png", fullPage: true });
    console.log(
      "PASS real Hostess UI → its BFF → Command Center → PostgreSQL; anonymous web checkout and receipt status polling",
    );
    return order as { id: string; source: string };
  } catch (error) {
    if (activePage) {
      console.error((await activePage.locator("body").innerText()).slice(-5000));
      await activePage.screenshot({ path: "test-results/cross-failure.png", fullPage: true });
    }
    console.error(logs.slice(-3500));
    throw error;
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}
