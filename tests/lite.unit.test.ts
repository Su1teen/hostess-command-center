import { describe, expect, test } from "bun:test";
import { parse } from "acorn";
import { LITE_CSS, LITE_JS, beepWav } from "../src/server/lite/assets";
import { createLiteHandler, type Dispatch } from "../src/server/lite/handler";
import { esc, money } from "../src/server/lite/html";
import { LEGACY_REDIRECT } from "../src/lib/legacy-redirect";

process.env.COMMAND_CENTER_ORIGIN = "https://command.test";
const ORIGIN = "https://command.test";
const STAFF_COOKIE = "__Host-hostess-staff=" + "s".repeat(43);
const CSRF = "c".repeat(43);

type Call = { method: string; path: string; body: unknown; origin: string | null };

function fakeApi(routes: Record<string, (body: unknown) => [number, unknown, string?]>) {
  const calls: Call[] = [];
  const dispatch: Dispatch = async (request) => {
    const url = new URL(request.url);
    const path = url.pathname.replace("/api/staff/v1", "") + url.search;
    const body = request.body ? JSON.parse(await request.text()) : undefined;
    calls.push({ method: request.method, path, body, origin: request.headers.get("origin") });
    const key = `${request.method} ${path.split("?")[0]}`;
    const route = routes[key];
    if (!route)
      return new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "нет" } }), {
        status: 404,
      });
    const [status, data, setCookie] = route(body);
    return new Response(JSON.stringify(data), {
      status,
      headers: setCookie ? { "set-cookie": setCookie } : {},
    });
  };
  return { calls, handle: createLiteHandler(dispatch) };
}
const me = (): [number, unknown] => [200, { staff: { id: "anna", role: "operator" } }];
function get(path: string, cookie = `${STAFF_COOKIE}; hostess-lite-csrf=${CSRF}`) {
  return new Request(ORIGIN + path, { headers: { cookie } });
}
function post(path: string, fields: Record<string, string>, extra: Record<string, string> = {}) {
  return new Request(ORIGIN + path, {
    method: "POST",
    headers: {
      cookie: `${STAFF_COOKIE}; hostess-lite-csrf=${CSRF}`,
      "content-type": "application/x-www-form-urlencoded",
      ...extra,
    },
    body: new URLSearchParams({ _csrf: CSRF, ...fields }).toString(),
  });
}
const order = (patch: Record<string, unknown> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  number: "42",
  source: "qr",
  tableCode: "07",
  tableName: "Стол 07",
  zoneName: "Первый зал",
  guestId: null,
  guestName: "<script>alert(1)</script>",
  guestPhone: null,
  status: "new",
  manualPaymentAt: null,
  acceptedAt: new Date().toISOString(),
  subtotalMinor: "245050",
  discountMinor: "0",
  payableMinor: "245050",
  cashbackMinor: "0",
  items: [
    {
      id: "i1",
      name: "Плов <b>",
      quantity: 2,
      unitPriceMinor: "122525",
      totalMinor: "245050",
      roundId: null,
      itemType: "REGULAR_MENU",
    },
  ],
  events: [],
  ...patch,
});

describe("lite: old-browser compatibility gates", () => {
  test("enhancement script and legacy redirect are pure ECMAScript 3", () => {
    expect(() => parse(LITE_JS, { ecmaVersion: 3 })).not.toThrow();
    expect(() => parse(LEGACY_REDIRECT, { ecmaVersion: 3 })).not.toThrow();
  });
  test("stylesheet avoids features missing in Android 4.x WebKit", () => {
    const css = LITE_CSS.replace(/\s+/g, "");
    for (const banned of [
      "var(--",
      "display:flex",
      "display:grid",
      "display:inline-flex",
      "gap:",
      "oklch",
      "color-mix",
      "@layer",
      "@property",
      "@supports",
      "calc(",
      ":is(",
      ":where(",
      ":has(",
      "position:sticky",
      "inset:",
      "aspect-ratio",
      "backdrop-filter",
      "dvh",
      "svh",
    ])
      expect(css.includes(banned)).toBe(false);
    // Every standard border-radius/box-sizing carries the -webkit- fallback before it.
    const radius = (css.match(/(^|[;{])border-radius:/g) ?? []).length;
    const webkitRadius = (css.match(/-webkit-border-radius:/g) ?? []).length;
    expect(webkitRadius).toBe(radius);
  });
  test("beep is a valid PCM WAV", () => {
    const wav = beepWav();
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe("WAVE");
    expect(wav.length).toBe(44 + 2000);
  });
  test("money avoids the ₸ glyph and groups thousands", () => {
    expect(money("245050")).toBe("2 450,50 тг");
    expect(money(100000)).toBe("1 000 тг");
    expect(esc(`<a href="x">'`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;");
  });
});

describe("lite: pages", () => {
  test("ignores non-lite paths", async () => {
    const { handle } = fakeApi({});
    expect(await handle(get("/orders"))).toBeNull();
    expect(await handle(get("/literature"))).toBeNull();
  });
  test("login page is a plain form that works without JavaScript", async () => {
    const { handle } = fakeApi({});
    const response = (await handle(get("/lite/login", "")))!;
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('<form method="post" action="/lite/login"');
    expect(html).toContain('name="username"');
    expect(html).toContain('name="password"');
    expect(html).toMatch(/name="_csrf" value="[A-Za-z0-9_-]{43}"/);
    expect(html).not.toContain('type="module"');
    expect(response.headers.get("set-cookie")).toContain("hostess-lite-csrf=");
  });
  test("unauthenticated pages redirect to login", async () => {
    const { handle } = fakeApi({ "GET /me": () => [401, { error: { message: "x" } }] });
    const response = (await handle(get("/lite/shift")))!;
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/lite/login");
    const partial = (await handle(get("/lite/shift?partial=1")))!;
    expect(partial.status).toBe(401);
  });
  test("shift renders the queue, escapes guest data and exposes new ids", async () => {
    const { handle } = fakeApi({
      "GET /me": me,
      "GET /dine-in/operations": () => [
        200,
        { orders: [order()], newCount: 1, workingCount: 0, unpaidCount: 1, hasMore: false },
      ],
      "GET /dine-in/booking-requests": () => [200, { requests: [] }],
      "GET /floor": () => [200, { zones: [] }],
    });
    const html = await (await handle(get("/lite/shift")))!.text();
    expect(html).toContain("Стол 07");
    expect(html).toContain("Плов &lt;b&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("Принять заказ");
    expect(html).toContain('data-new="11111111-1111-4111-8111-111111111111"');
    expect(html).toContain('<noscript><meta http-equiv="refresh" content="20"></noscript>');
    const partial = (await handle(get("/lite/shift?partial=1")))!;
    expect(partial.headers.get("x-lite-new")).toBe("11111111-1111-4111-8111-111111111111");
    expect(await partial.text()).not.toContain("<html");
  });
  test("viewer gets no write actions", async () => {
    const { handle } = fakeApi({
      "GET /me": () => [200, { staff: { id: "v", role: "viewer" } }],
      "GET /dine-in/operations": () => [
        200,
        { orders: [order()], newCount: 1, workingCount: 0, unpaidCount: 1, hasMore: false },
      ],
      "GET /dine-in/booking-requests": () => [200, { requests: [] }],
      "GET /floor": () => [200, { zones: [] }],
    });
    const html = await (await handle(get("/lite/shift")))!.text();
    expect(html).not.toContain("Принять заказ");
    expect(html).not.toContain("+ Заказ");
  });
});

describe("lite: actions", () => {
  test("rejects a missing or wrong CSRF token without calling the API", async () => {
    const { handle, calls } = fakeApi({ "GET /me": me });
    const response = (await handle(
      post("/lite/order/11111111-1111-4111-8111-111111111111/paid", { _csrf: "x".repeat(43) }),
    ))!;
    expect(response.status).toBe(303);
    expect(response.headers.get("set-cookie")).toContain("hostess-lite-flash=err");
    expect(calls.filter((c) => c.method !== "GET")).toHaveLength(0);
  });
  test("rejects a foreign Origin even with a valid token", async () => {
    const { handle, calls } = fakeApi({});
    await handle(
      post(
        "/lite/order/11111111-1111-4111-8111-111111111111/paid",
        {},
        { origin: "https://evil.example" },
      ),
    );
    expect(calls).toHaveLength(0);
  });
  test("accepts old browsers that send no Origin header at all", async () => {
    const { handle, calls } = fakeApi({
      "PATCH /dine-in/orders/11111111-1111-4111-8111-111111111111/status": () => [
        200,
        { order: order() },
      ],
    });
    const response = (await handle(
      post("/lite/order/11111111-1111-4111-8111-111111111111/status", {
        status: "accepted",
        back: "/lite/shift?f=new",
      }),
    ))!;
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/lite/shift?f=new");
    expect(calls[0]).toEqual({
      method: "PATCH",
      path: "/dine-in/orders/11111111-1111-4111-8111-111111111111/status",
      body: { status: "accepted" },
      origin: ORIGIN,
    });
  });
  test("login forwards the staff session cookie and redirects to the shift", async () => {
    const { handle, calls } = fakeApi({
      "POST /login": () => [
        200,
        { staff: { id: "anna", role: "operator" } },
        "__Host-hostess-staff=abc; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600",
      ],
    });
    const response = (await handle(post("/lite/login", { username: "anna", password: "pw" })))!;
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/lite/shift");
    expect(
      response.headers.getSetCookie().some((c) => c.startsWith("__Host-hostess-staff=abc")),
    ).toBe(true);
    expect(calls[0].body).toEqual({ username: "anna", password: "pw" });
  });
  test("failed login shows the server message", async () => {
    const { handle } = fakeApi({
      "POST /login": () => [
        401,
        { error: { code: "UNAUTHORIZED", message: "Неверные данные входа" } },
      ],
    });
    const response = (await handle(post("/lite/login", { username: "a", password: "b" })))!;
    expect(response.headers.get("location")).toBe("/lite/login");
    expect(decodeURIComponent(response.headers.get("set-cookie") ?? "")).toContain(
      "Неверные данные входа",
    );
  });
  test("open redirects through `back` are refused", async () => {
    const { handle } = fakeApi({
      "PATCH /dine-in/orders/11111111-1111-4111-8111-111111111111/status": () => [200, {}],
    });
    for (const back of ["https://evil.example", "//evil.example", "/lite//evil", "javascript:x"]) {
      const response = (await handle(
        post("/lite/order/11111111-1111-4111-8111-111111111111/paid", { back }),
      ))!;
      expect(response.headers.get("location")).toBe(
        "/lite/order/11111111-1111-4111-8111-111111111111",
      );
    }
  });
  test("seat converts minutes to expectedEndAt and keeps the idempotency key", async () => {
    const { handle, calls } = fakeApi({
      "POST /floor/seat": () => [200, { session: { id: "22222222-2222-4222-8222-222222222222" } }],
    });
    const before = Date.now();
    const response = (await handle(
      post("/lite/table/33333333-3333-4333-8333-333333333333/seat", {
        guests: "4",
        minutes: "90",
        key: "k".repeat(36),
        then: "order",
      }),
    ))!;
    expect(response.headers.get("location")).toBe(
      "/lite/new?session=22222222-2222-4222-8222-222222222222",
    );
    const body = calls[0].body as Record<string, unknown>;
    expect(body.guests).toBe(4);
    expect(body.idempotencyKey).toBe("k".repeat(36));
    const end = Date.parse(String(body.expectedEndAt));
    expect(end - before).toBeGreaterThanOrEqual(90 * 60000 - 1000);
    expect(end - before).toBeLessThan(90 * 60000 + 5000);
  });
  test("booking converts Almaty wall clock to an instant", async () => {
    const { handle, calls } = fakeApi({ "POST /floor/reservations": () => [201, {}] });
    await handle(
      post("/lite/table/33333333-3333-4333-8333-333333333333/book", {
        guestName: "Айгерим",
        phone: "+7 701 000 00 00",
        date: "2026-11-22",
        time: "9:30",
        guests: "3",
        minutes: "120",
        key: "k".repeat(36),
      }),
    );
    const body = calls[0].body as Record<string, unknown>;
    expect(body.startsAt).toBe("2026-11-22T04:30:00.000Z");
    expect(body.endsAt).toBe("2026-11-22T06:30:00.000Z");
    expect(body.source).toBe("phone");
  });
  test("composer builds quote items from quantity fields and renders a confirm form", async () => {
    const { handle, calls } = fakeApi({
      "GET /me": me,
      "POST /dine-in/staff-quotes": () => [
        201,
        {
          id: "44444444-4444-4444-8444-444444444444",
          expiresAt: new Date(Date.now() + 300000).toISOString(),
          payableMinor: 159000,
          items: [{ name: "Чай", quantity: 2, totalMinor: 159000 }],
        },
      ],
    });
    const response = (await handle(
      post("/lite/new/quote", {
        session: "22222222-2222-4222-8222-222222222222",
        "q:r:55555555-5555-4555-8555-555555555555": "2",
        "q:e:prod-1": "0",
        "q:e:prod-2": "",
      }),
    ))!;
    const html = await response.text();
    expect(calls.find((c) => c.path === "/dine-in/staff-quotes")?.body).toEqual({
      sessionId: "22222222-2222-4222-8222-222222222222",
      preorderIds: [],
      useVisitGuest: false,
      redeemMinor: 0,
      items: [
        {
          productId: "55555555-5555-4555-8555-555555555555",
          quantity: 2,
          itemType: "REGULAR_MENU",
        },
      ],
    });
    expect(html).toContain('action="/lite/new/submit"');
    expect(html).toContain("1 590 тг");
  });
  test("an unknown checkout outcome offers a safe replay with the same key", async () => {
    const { handle, calls } = fakeApi({
      "GET /me": me,
      "POST /dine-in/staff-orders": () => [
        503,
        { error: { message: "Сервис временно недоступен" } },
      ],
    });
    const html = await (await handle(
      post("/lite/new/submit", {
        quoteId: "44444444-4444-4444-8444-444444444444",
        key: "same-key-0123456789",
        session: "22222222-2222-4222-8222-222222222222",
        payable: "159000",
        line0: "2|159000|Чай",
        expires: new Date().toISOString(),
      }),
    ))!.text();
    expect(calls.find((c) => c.path === "/dine-in/staff-orders")?.body).toEqual({
      quoteId: "44444444-4444-4444-8444-444444444444",
      idempotencyKey: "same-key-0123456789",
    });
    expect(html).toContain('value="same-key-0123456789"');
    expect(html).toContain("повтор безопасен");
  });
});

describe("lite: WhatsApp (Dayan)", () => {
  const chats = [
    {
      chatKey: "xoxo:77010000000@c.us",
      chatId: "77010000000@c.us",
      phone: "+77010000000",
      guestName: "Дана <i>",
      paused: true,
      pausedReason: "просит менеджера",
      pausedAt: null,
      lastMessageAt: new Date().toISOString(),
      lastMessage: "Можно позвать администратора?",
      bookings: 1,
    },
    {
      chatKey: "xoxo:77020000000@c.us",
      chatId: "77020000000@c.us",
      phone: null,
      guestName: null,
      paused: false,
      pausedReason: null,
      pausedAt: null,
      lastMessageAt: new Date().toISOString(),
      lastMessage: "Спасибо!",
      bookings: 0,
    },
  ];
  test("list shows chats waiting for staff first and flags them for the sound", async () => {
    const { handle } = fakeApi({
      "GET /me": me,
      "GET /agent/conversations": () => [200, { conversations: chats }],
    });
    const response = (await handle(get("/lite/whatsapp")))!;
    const html = await response.text();
    expect(html.indexOf("Ждут сотрудника")).toBeLessThan(html.indexOf("Все диалоги"));
    expect(html).toContain("Дана &lt;i&gt;");
    expect(html).toContain("просит менеджера");
    expect(html).toContain("/lite/whatsapp/chat?key=xoxo%3A77010000000%40c.us");
    const partial = (await handle(get("/lite/whatsapp?partial=1")))!;
    expect(partial.headers.get("x-lite-new")).toBe("wa:xoxo:77010000000@c.us");
  });
  test("chat shows the conversation and the take-over / give-back action", async () => {
    const { handle, calls } = fakeApi({
      "GET /me": me,
      "GET /agent/conversations": () => [200, { conversations: chats }],
      "GET /agent/conversations/messages": () => [
        200,
        {
          messages: [
            { id: "1", role: "guest", text: "Привет\nесть стол?", at: new Date().toISOString() },
            { id: "2", role: "agent", text: "<b>Да</b>", at: new Date().toISOString() },
          ],
        },
      ],
    });
    const html = await (await handle(
      get("/lite/whatsapp/chat?key=" + encodeURIComponent(chats[0].chatKey)),
    ))!.text();
    expect(
      calls.some((c) => c.path === "/agent/conversations/messages?key=xoxo%3A77010000000%40c.us"),
    ).toBe(true);
    expect(html).toContain("Привет<br>есть стол?");
    expect(html).toContain("&lt;b&gt;Да&lt;/b&gt;");
    expect(html).toContain("Вернуть ИИ");
    expect(html).toContain('href="https://wa.me/77010000000"');
  });
  test("pause/resume maps to the agent API and returns to the chat", async () => {
    const { handle, calls } = fakeApi({
      "POST /agent/conversations/pause": () => [200, { conversation: {} }],
    });
    const response = (await handle(
      post("/lite/whatsapp/pause", { key: chats[1].chatKey, paused: "yes" }),
    ))!;
    expect(calls[0]).toEqual({
      method: "POST",
      path: "/agent/conversations/pause?key=xoxo%3A77020000000%40c.us",
      body: { paused: true, reason: "отвечает сотрудник" },
      origin: ORIGIN,
    });
    expect(response.headers.get("location")).toBe(
      "/lite/whatsapp/chat?key=xoxo%3A77020000000%40c.us",
    );
    await handle(post("/lite/whatsapp/pause", { key: chats[0].chatKey, paused: "no" }));
    expect(calls[1].body).toEqual({ paused: false });
  });
  test("shift warns about chats waiting for staff and badges the nav", async () => {
    const { handle } = fakeApi({
      "GET /me": me,
      "GET /dine-in/operations": () => [
        200,
        { orders: [], newCount: 0, workingCount: 0, unpaidCount: 0, hasMore: false },
      ],
      "GET /dine-in/booking-requests": () => [200, { requests: [] }],
      "GET /floor": () => [200, { zones: [] }],
      "GET /agent/conversations": () => [200, { conversations: chats }],
    });
    const response = (await handle(get("/lite/shift")))!;
    const html = await response.text();
    expect(html).toContain("WhatsApp: ждут сотрудника · 1");
    expect(html).toMatch(/WhatsApp<span class="badge">1<\/span>/);
  });
});

describe("lite: manager bulk clean-up", () => {
  const A = "11111111-1111-4111-8111-111111111111";
  const B = "22222222-2222-4222-8222-222222222222";
  test("only managers can open it; it lists the queue with unchecked boxes", async () => {
    const operator = fakeApi({ "GET /me": me });
    const denied = (await operator.handle(get("/lite/orders/bulk")))!;
    expect(denied.headers.get("location")).toBe("/lite/orders");
    const { handle } = fakeApi({
      "GET /me": () => [200, { staff: { id: "boss", role: "manager" } }],
      "GET /dine-in/operations": () => [
        200,
        {
          orders: [order(), order({ id: B, number: "43", payableMinor: "89000" })],
          newCount: 2,
          workingCount: 0,
          unpaidCount: 2,
          hasMore: false,
        },
      ],
    });
    const html = await (await handle(get("/lite/orders/bulk")))!.text();
    expect(html).toContain(`name="id" value="${A}"`);
    expect(html).not.toContain("checked>");
    expect(html).toContain("890 тг");
    const all = await (await handle(get("/lite/orders/bulk?all=1")))!.text();
    expect((all.match(/ checked>/g) ?? []).length).toBe(2);
  });
  test("cancel applies only to the checked orders, with the clean-up reason", async () => {
    const { handle, calls } = fakeApi({
      [`POST /dine-in/orders/${A}/cancel`]: () => [200, { order: {} }],
    });
    const body = new URLSearchParams({ _csrf: CSRF, action: "cancel" });
    body.append("id", A);
    const response = (await handle(
      new Request(ORIGIN + "/lite/orders/bulk", {
        method: "POST",
        headers: {
          cookie: `${STAFF_COOKIE}; hostess-lite-csrf=${CSRF}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      }),
    ))!;
    expect(calls).toEqual([
      {
        method: "POST",
        path: `/dine-in/orders/${A}/cancel`,
        body: { reason: "Тестовый заказ — массовая очистка менеджером" },
        origin: ORIGIN,
      },
    ]);
    expect(decodeURIComponent(response.headers.get("set-cookie") ?? "")).toContain(
      "Отменено: 1 из 1",
    );
  });
  test("close walks every remaining step and marks payment", async () => {
    const { handle, calls } = fakeApi({
      [`GET /dine-in/orders/${A}`]: () => [200, { order: order({ status: "preparing" }) }],
      [`PATCH /dine-in/orders/${A}/status`]: () => [200, { order: {} }],
    });
    await handle(post("/lite/orders/bulk", { action: "close", id: A }));
    expect(calls.filter((c) => c.method === "PATCH").map((c) => c.body)).toEqual([
      { status: "delivered" },
      { status: "closed" },
      { manualPaymentReceived: true },
    ]);
  });
});
