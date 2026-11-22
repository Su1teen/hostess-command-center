/**
 * Lite Command Center (/lite) for very old tablets.
 *
 * Every page is rendered on the server as plain HTML; every action is a plain
 * <form method="post"> followed by a 303 redirect (POST-redirect-GET), so the
 * whole workflow works even when the browser executes no JavaScript at all.
 *
 * Business rules are NOT duplicated: each action is dispatched in-process to the
 * same /api/staff/v1 handlers the full Command Center uses (same validation,
 * roles, idempotency, database). The lite layer only translates form fields to
 * JSON and replaces the Origin check (old browsers often omit Origin) with a
 * double-submit CSRF token.
 */
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { DineOrder } from "../../lib/dine-in-client";
import type { FloorResource, FloorSnapshot, FloorZone } from "../../lib/floor-operations";
import { beepWav } from "./assets";
import {
  csrfField,
  dateKey,
  dateTime,
  esc,
  flashBlock,
  humanDate,
  minutesAgo,
  money,
  page,
  time,
  type Flash,
  type Nav,
  type Staff,
} from "./html";

export type Dispatch = (request: Request) => Promise<Response | null> | Response | null;

type ApiResult<T> =
  | { ok: true; status: number; data: T; setCookie: string[] }
  | { ok: false; status: number; code: string; message: string; setCookie: string[] };

const CSRF_COOKIE = "hostess-lite-csrf";
const FLASH_COOKIE = "hostess-lite-flash";
const STATUS_LABEL: Record<string, string> = {
  new: "Новый",
  accepted: "Принят",
  preparing: "Готовится",
  delivered: "Подан",
  closed: "Закрыт",
  cancelled: "Отменён",
};
const NEXT_STEP: Record<string, [string, string]> = {
  new: ["accepted", "Принять заказ"],
  accepted: ["preparing", "На приготовление"],
  preparing: ["delivered", "Отметить подачу"],
  delivered: ["closed", "Завершить заказ"],
};
const FLOOR_LABEL: Record<string, string> = {
  free: "Свободен",
  reserved: "Забронирован",
  seated: "Гости на месте",
  qr_activity: "Заказ по QR · посадка не подтверждена",
  overdue: "Время визита превышено",
  blocked: "Вне обслуживания",
  unconfigured: "Бронирование отключено",
};
const RESERVATION_LABEL: Record<string, string> = {
  confirmed: "Подтверждена",
  expected: "Ожидается",
  arrived: "Пришли",
  cancelled: "Отменена",
  no_show: "Не пришли",
};
const SOURCE_LABEL: Record<string, string> = {
  staff: "Оформлен сотрудником",
  web_app: "Через сайт · проверьте у гостей",
  table_code: "Гость по коду стола",
  qr: "Гость по QR",
};
const UUID = /^[a-f0-9-]{36}$/i;

type Ctx = {
  request: Request;
  url: URL;
  cookies: Map<string, string>;
  csrf: string;
  setCookies: string[];
  dispatch: Dispatch;
};

function parseCookies(header: string | null) {
  const map = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    try {
      map.set(name, decodeURIComponent(part.slice(index + 1).trim()));
    } catch {
      map.set(name, part.slice(index + 1).trim());
    }
  }
  return map;
}
function liteCookie(name: string, value: string, maxAge: number, httpOnly = true) {
  return `${name}=${encodeURIComponent(value)}; Path=/lite; ${httpOnly ? "HttpOnly; " : ""}Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
const baseHeaders = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "same-origin",
};
function respond(ctx: Ctx, body: string, status = 200, extra: Record<string, string> = {}) {
  const headers = new Headers({
    ...baseHeaders,
    "content-type": "text/html; charset=utf-8",
    ...extra,
  });
  for (const value of ctx.setCookies) headers.append("set-cookie", value);
  return new Response(body, { status, headers });
}
function redirect(ctx: Ctx, location: string, flash?: Flash) {
  if (flash)
    ctx.setCookies.push(liteCookie(FLASH_COOKIE, `${flash.kind}|${flash.text.slice(0, 400)}`, 120));
  const headers = new Headers({ ...baseHeaders, location });
  for (const value of ctx.setCookies) headers.append("set-cookie", value);
  return new Response(null, { status: 303, headers });
}
function takeFlash(ctx: Ctx): Flash {
  const raw = ctx.cookies.get(FLASH_COOKIE);
  if (!raw) return null;
  ctx.setCookies.push(liteCookie(FLASH_COOKIE, "", 0));
  const [kind, ...rest] = raw.split("|");
  return { kind: kind === "ok" ? "ok" : "err", text: rest.join("|") };
}
/** Only same-app relative /lite targets are accepted as redirect destinations. */
function safeBack(value: string | null | undefined, fallback: string) {
  return value && /^\/lite(\/[A-Za-z0-9/_?=&%.-]*)?$/.test(value) && !value.includes("//")
    ? value
    : fallback;
}

async function api<T>(
  ctx: Ctx,
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  const origin = process.env.COMMAND_CENTER_ORIGIN ?? new URL(ctx.request.url).origin;
  const headers = new Headers({
    accept: "application/json",
    origin,
    "x-hostess-client-id": "lite",
  });
  const cookie = ctx.request.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  if (body !== undefined) headers.set("content-type", "application/json");
  let response: Response | null;
  try {
    response = await ctx.dispatch(
      new Request(`${origin}/api/staff/v1${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  } catch {
    response = null;
  }
  if (!response)
    return {
      ok: false,
      status: 503,
      code: "UNAVAILABLE",
      message: "Сервис временно недоступен",
      setCookie: [],
    };
  const setCookie =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : response.headers.get("set-cookie")
        ? [response.headers.get("set-cookie")!]
        : [];
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (response.ok) return { ok: true, status: response.status, data: data as T, setCookie };
  const error = (data as { error?: { code?: string; message?: string } } | null)?.error;
  return {
    ok: false,
    status: response.status,
    code: error?.code ?? "UNAVAILABLE",
    message: error?.message ?? "Сервис временно недоступен",
    setCookie,
  };
}

async function readForm(request: Request): Promise<URLSearchParams> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.startsWith("application/x-www-form-urlencoded")) return new URLSearchParams();
  const text = await request.text();
  if (text.length > 65536) return new URLSearchParams();
  return new URLSearchParams(text);
}
function sameToken(a: string, b: string) {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && left.length >= 32 && timingSafeEqual(left, right);
}
function allowedOrigins() {
  return [
    process.env.COMMAND_CENTER_ORIGIN,
    ...(process.env.COMMAND_CENTER_ADDITIONAL_ORIGINS ?? "").split(","),
  ]
    .map((value) => (value ?? "").trim())
    .filter(Boolean);
}
/** Double-submit token; a present Origin/Referer must also be one of ours. */
function csrfValid(ctx: Ctx, form: URLSearchParams) {
  const supplied = form.get("_csrf") ?? "";
  if (!sameToken(supplied, ctx.cookies.get(CSRF_COOKIE) ?? "")) return false;
  const origin = ctx.request.headers.get("origin");
  const own = new URL(ctx.request.url).origin;
  const allowed = [...allowedOrigins(), own];
  if (origin && origin !== "null" && !allowed.includes(origin)) return false;
  const referer = ctx.request.headers.get("referer");
  if (!origin && referer) {
    try {
      if (!allowed.includes(new URL(referer).origin)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

async function me(ctx: Ctx): Promise<Staff | null> {
  if (!ctx.cookies.get("__Host-hostess-staff")) return null;
  const result = await api<{ staff: Staff }>(ctx, "GET", "/me");
  return result.ok ? result.data.staff : null;
}
const canWrite = (staff: Staff) => staff.role === "operator" || staff.role === "manager";

function hidden(name: string, value: string | number) {
  return `<input type="hidden" name="${esc(name)}" value="${esc(value)}">`;
}
function form(
  ctx: Ctx,
  action: string,
  inner: string,
  options: { confirm?: string; cls?: string } = {},
) {
  return `<form method="post" action="${esc(action)}" accept-charset="utf-8" class="${options.cls ?? ""}"${options.confirm ? ` data-confirm="${esc(options.confirm)}"` : ""}>${csrfField(ctx.csrf)}${inner}</form>`;
}
function placeName(o: { tableName?: string | null; tableCode: string }) {
  return o.tableName || `Стол ${o.tableCode}`;
}
function itemsLine(o: DineOrder) {
  return o.items.map((i) => `${i.quantity} × ${esc(i.name)}`).join(", ");
}

/* ---------------- views ---------------- */

function orderCard(ctx: Ctx, staff: Staff, o: DineOrder, back: string) {
  const age = minutesAgo(o.acceptedAt);
  const step = NEXT_STEP[o.status];
  const late = o.status === "new" && age >= 10;
  const actions = canWrite(staff)
    ? `${
        step
          ? form(
              ctx,
              `/lite/order/${o.id}/status`,
              `${hidden("status", step[0])}${hidden("back", back)}<button type="submit" class="btn dark block">${step[1]}</button>`,
            )
          : ""
      }${
        !o.manualPaymentAt && o.status !== "cancelled"
          ? form(
              ctx,
              `/lite/order/${o.id}/paid`,
              `${hidden("back", back)}<button type="submit" class="btn block">Оплата получена · ${money(o.payableMinor)}</button>`,
              { confirm: `Отметить оплату ${money(o.payableMinor)}?` },
            )
          : ""
      }`
    : "";
  return `<div class="card${o.status === "new" ? " new" : ""}${late ? " late" : ""}">
<a class="title" href="/lite/order/${o.id}"><h2>${esc(placeName(o))}${o.zoneName ? ` <span class="muted">· ${esc(o.zoneName)}</span>` : ""}</h2>
<p><span class="pill ${esc(o.status)}">${esc(STATUS_LABEL[o.status] ?? o.status)}</span> <span class="${late ? "bold" : "muted"}" style="${late ? "color:#b91c1c" : ""}">№${esc(o.number)} · ${age} мин. назад</span></p>
<p class="small">${itemsLine(o)}</p>
${o.source === "web_app" ? '<p class="small bold" style="color:#92400e">Через сайт · подтвердите у гостей</p>' : ""}
<div class="sum cf">${o.manualPaymentAt ? "Оплата отмечена" : "К получению"}<span class="r">${money(o.payableMinor)}</span></div></a>
${actions}</div>`;
}

function grid(cards: string[]) {
  if (!cards.length) return "";
  let left = "",
    right = "";
  cards.forEach((card, index) => {
    if (index % 2 === 0) left += card;
    else right += card;
  });
  return `<div class="row"><div class="col">${left}</div><div class="col">${right}</div></div>`;
}

type Operations = {
  orders: DineOrder[];
  newCount: number;
  workingCount: number;
  unpaidCount: number;
  hasMore: boolean;
};
type BookingRequest = {
  id: string;
  startsAt: string;
  guests: number;
  guestName: string;
  guestPhone: string;
  note: string;
};

function liveWrap(src: string, inner: string, newIds: string) {
  return `<div class="bar"><div class="l"><span id="conn" class="conn">Обновляется автоматически</span></div><div class="r"><a class="btn sm" href="${esc(src)}">Обновить</a></div></div>
<div id="live" data-src="${esc(src)}" data-new="${esc(newIds)}">${inner}</div>`;
}

async function shiftPage(ctx: Ctx, staff: Staff) {
  const filter = ["new", "working", "unpaid"].includes(ctx.url.searchParams.get("f") ?? "")
    ? ctx.url.searchParams.get("f")!
    : "all";
  const [ops, requests, floor, chats] = await Promise.all([
    api<Operations>(ctx, "GET", "/dine-in/operations"),
    api<{ requests: BookingRequest[] }>(ctx, "GET", "/dine-in/booking-requests"),
    api<FloorSnapshot>(ctx, "GET", "/floor"),
    api<{ conversations: Conversation[] }>(ctx, "GET", "/agent/conversations"),
  ]);
  const waiting = chats.ok ? chats.data.conversations.filter((c) => c.paused) : [];
  if (!ops.ok && ops.status === 401) return null;
  const data = ops.ok ? ops.data : null;
  const orders = (data?.orders ?? []).filter((o) =>
    filter === "all"
      ? true
      : filter === "new"
        ? o.status === "new"
        : filter === "working"
          ? !["new", "closed", "cancelled"].includes(o.status)
          : !o.manualPaymentAt,
  );
  const back = `/lite/shift${filter === "all" ? "" : `?f=${filter}`}`;
  const tile = (key: string, label: string, n: number | undefined) =>
    `<td class="${filter === key ? "on" : ""}"><a href="/lite/shift?f=${key}"><span class="muted">${label}</span><strong>${n ?? "—"}</strong></a></td>`;
  let inner = "";
  if (!ops.ok)
    inner += flashBlock({ kind: "err", text: `${ops.message} · данные могут быть устаревшими` });
  inner += `<table class="tiles"><tr>${tile("new", "Новые", data?.newCount)}${tile("working", "В работе", data?.workingCount)}${tile("unpaid", "К оплате", data?.unpaidCount)}</tr></table>`;
  inner += `<p>${filter === "all" ? "<b>Все задачи</b>" : '<a class="btn sm" href="/lite/shift">Показать все задачи</a>'}</p>`;
  if (waiting.length)
    inner += `<div class="card warn"><h2>WhatsApp: ждут сотрудника · ${waiting.length}</h2>${waiting
      .map(
        (c) =>
          `<p><a href="${chatHref(c.chatKey)}"><b>${esc(chatLabel(c))}</b> · ${esc(c.pausedReason ?? "нужен сотрудник")}</a></p>`,
      )
      .join("")}</div>`;
  const resources = floor.ok ? bookableResources(floor.data) : [];
  if (requests.ok && requests.data.requests.length) {
    inner += `<div class="card warn"><h2>Заявки на бронирование · ${requests.data.requests.length}</h2>`;
    for (const r of requests.data.requests) {
      inner += `<div class="card"><p class="bold">${dateTime(r.startsAt)} · ${r.guests} гостей · ${esc(r.guestName)}</p>
<p><a href="tel:${esc(r.guestPhone)}">${esc(r.guestPhone)}</a></p>${r.note ? `<p class="small">${esc(r.note)}</p>` : ""}`;
      if (staff.role === "manager") {
        inner += form(
          ctx,
          `/lite/request/${r.id}`,
          `${hidden("action", "confirm")}<label>Место</label><select name="resourceId" class="field" required><option value="">Выберите место</option>${resources.map((t) => `<option value="${esc(t.id)}">${esc(t.label)}</option>`).join("")}</select><button type="submit" class="btn dark">Подтвердить бронь</button>`,
        );
        inner += form(
          ctx,
          `/lite/request/${r.id}`,
          `${hidden("action", "reject")}<button type="submit" class="btn red">Отклонить</button>`,
          { confirm: "Отклонить заявку?" },
        );
      } else inner += '<p class="muted small">Заявку подтверждает менеджер.</p>';
      inner += "</div>";
    }
    inner += "</div>";
  }
  if (floor.ok) {
    const soon = floor.data.zones.flatMap((z) =>
      z.resources
        .filter(
          (r) =>
            r.nextReservation && Date.parse(r.nextReservation.startsAt) - Date.now() <= 30 * 60000,
        )
        .map((r) => ({ r, z })),
    );
    if (soon.length)
      inner += `<div class="card warn"><h2>Скоро прибытие</h2>${soon
        .map(
          ({ r, z }) =>
            `<p><a href="/lite/table/${r.id}">${esc(r.name)} · ${esc(z.name)} · ${time(r.nextReservation!.startsAt)} · ${r.nextReservation!.guests} гостей · ${esc(r.nextReservation!.guestName)}</a>${r.currentSession ? ' <span class="pill">визит ещё открыт</span>' : ""}</p>`,
        )
        .join("")}</div>`;
  }
  if (data?.hasMore)
    inner += '<p class="flash ok">Показаны первые 200 задач. Остальные — в разделе «Заказы».</p>';
  inner += grid(orders.map((o) => orderCard(ctx, staff, o, back)));
  if (data && !orders.length)
    inner += '<div class="card"><p class="muted">В этой очереди нет задач.</p></div>';
  const newIds = (data?.orders ?? [])
    .filter((o) => o.status === "new")
    .map((o) => o.id)
    .concat(waiting.map((c) => `wa:${c.chatKey}`))
    .join(",");
  return {
    inner,
    newIds,
    newCount: data?.newCount ?? 0,
    waitingCount: waiting.length,
    src: back,
  };
}

async function ordersPage(ctx: Ctx, staff: Staff) {
  const status = Object.keys(STATUS_LABEL).includes(ctx.url.searchParams.get("status") ?? "")
    ? ctx.url.searchParams.get("status")!
    : "";
  const q = (ctx.url.searchParams.get("q") ?? "").slice(0, 100);
  const query = new URLSearchParams();
  if (status) query.set("status", status);
  query.set("q", q);
  const list = await api<{ orders: DineOrder[] }>(ctx, "GET", `/dine-in/orders?${query}`);
  if (!list.ok && list.status === 401) return null;
  const src = `/lite/orders${status || q ? `?${new URLSearchParams({ ...(status ? { status } : {}), ...(q ? { q } : {}) })}` : ""}`;
  let inner = "";
  if (!list.ok) inner += flashBlock({ kind: "err", text: list.message });
  const orders = list.ok ? list.data.orders : [];
  inner += grid(orders.map((o) => orderCard(ctx, staff, o, src)));
  if (list.ok && !orders.length)
    inner += '<div class="card"><p class="muted">Заказов по выбранным условиям нет.</p></div>';
  inner += '<p class="muted small">Последние 100 заказов. Для истории используйте поиск.</p>';
  const filters = `<form method="get" action="/lite/orders" accept-charset="utf-8" class="card"><div class="row"><div class="col"><label>Поиск</label><input class="field" type="text" name="q" value="${esc(q)}" placeholder="Стол, имя, телефон, № заказа"></div><div class="col"><label>Статус</label><select class="field" name="status"><option value="">Все статусы</option>${Object.entries(
    STATUS_LABEL,
  )
    .map(([v, l]) => `<option value="${v}"${v === status ? " selected" : ""}>${l}</option>`)
    .join(
      "",
    )}</select></div></div><button type="submit" class="btn dark">Найти</button>${staff.role === "manager" ? ' <a class="btn" href="/lite/orders/bulk">Массовое закрытие</a>' : ""}</form>`;
  return { inner, filters, src };
}

async function orderPage(ctx: Ctx, staff: Staff, id: string) {
  const detail = await api<{ order: DineOrder }>(ctx, "GET", `/dine-in/orders/${id}`);
  if (!detail.ok)
    return detail.status === 401 ? null : flashBlock({ kind: "err", text: detail.message });
  const o = detail.data.order;
  const back = `/lite/order/${o.id}`;
  const step = NEXT_STEP[o.status];
  let html = `<p><a href="/lite/shift">← К смене</a></p><div class="card"><h1>№${esc(o.number)} · ${esc(placeName(o))}</h1>
<p class="muted">${esc(o.zoneName)} · ${esc(SOURCE_LABEL[o.source ?? ""] ?? "Заказ")}</p>
<p><span class="pill ${esc(o.status)}">${esc(STATUS_LABEL[o.status] ?? o.status)}</span> <span class="muted">${dateTime(o.acceptedAt)}</span></p>
<p class="bold">${esc(o.guestName ?? "Гость без аккаунта")}</p>${o.guestPhone ? `<p><a href="tel:${esc(o.guestPhone)}">${esc(o.guestPhone)}</a></p>` : ""}
<ul class="lines">${o.items
    .map(
      (i) =>
        `<li class="cf"><span class="r">${money(i.totalMinor)}</span>${i.quantity} × ${esc(i.name)}<br><span class="muted small">${money(i.unitPriceMinor)} за ед. · ${i.itemType === "REGULAR_MENU" ? "Основное меню" : "Биржа напитков"}</span></li>`,
    )
    .join("")}</ul>
<ul class="lines"><li class="cf"><span class="r">${money(o.subtotalMinor)}</span>Сумма позиций</li><li class="cf"><span class="r">${money(o.discountMinor)}</span>Списано бонусов</li><li class="cf"><span class="r">${money(o.cashbackMinor)}</span>Кэшбэк начислен</li></ul>
<div class="total cf">К получению<span class="r">${money(o.payableMinor)}</span></div>
<p class="small">${o.manualPaymentAt ? `Оплата отмечена: ${dateTime(o.manualPaymentAt)}` : "Примите оплату через терминал и отметьте получение."}</p>`;
  if (canWrite(staff) && o.status !== "cancelled") {
    if (step)
      html += form(
        ctx,
        `/lite/order/${o.id}/status`,
        `${hidden("status", step[0])}${hidden("back", back)}<button type="submit" class="btn dark block">${step[1]}</button>`,
      );
    if (!o.manualPaymentAt)
      html += form(
        ctx,
        `/lite/order/${o.id}/paid`,
        `${hidden("back", back)}<button type="submit" class="btn ok block">Оплата получена · ${money(o.payableMinor)}</button>`,
        { confirm: `Отметить оплату ${money(o.payableMinor)}?` },
      );
    if (staff.role === "manager" || (o.status === "new" && !o.manualPaymentAt))
      html += form(
        ctx,
        `/lite/order/${o.id}/cancel`,
        `<h3>Отмена заказа</h3><input class="field" type="text" name="reason" required minlength="3" maxlength="500" placeholder="Причина отмены (не меньше 3 символов)"><button type="submit" class="btn red">Отменить заказ</button>`,
        { confirm: "Отменить заказ? Действие нельзя отменить." },
      );
  }
  html += `<h3>История</h3><ol class="history">${o.events
    .map(
      (e) =>
        `<li>${esc(
          STATUS_LABEL[e.type] ??
            (
              {
                created: "Заказ создан",
                manual_payment_received: "Оплата получена",
                guest_linked: "Гость прикреплён",
              } as Record<string, string>
            )[e.type] ??
            e.type,
        )} · ${esc(e.actor)}<br>${dateTime(e.createdAt)}${typeof e.details?.reason === "string" ? `<br>${esc(e.details.reason)}` : ""}</li>`,
    )
    .join("")}</ol></div>`;
  return html;
}

function bookableResources(floor: FloorSnapshot) {
  return floor.zones.flatMap((z) =>
    z.resources
      .filter((r) => r.bookable && r.bookingResourceId)
      .map((r) => ({ id: r.bookingResourceId!, label: `${r.name} · ${z.name}` })),
  );
}

async function hallPage(ctx: Ctx) {
  const floor = await api<FloorSnapshot>(ctx, "GET", "/floor");
  if (!floor.ok)
    return floor.status === 401
      ? null
      : { inner: flashBlock({ kind: "err", text: floor.message }) };
  let inner = `<p class="legend"><span class="st-free">Свободен</span><span class="st-reserved">Бронь</span><span class="st-seated">Гости</span><span class="st-qr_activity">Заказ по QR</span><span class="st-overdue">Превышено</span><span class="st-blocked">Не работает</span></p>`;
  for (const zone of floor.data.zones) {
    inner += `<div class="zone"><h2>${esc(zone.name)} <span class="muted small">· свободно ${zone.counts.available} из ${zone.counts.total}${zone.counts.activeOrders ? ` · активных заказов ${zone.counts.activeOrders}` : ""}</span></h2>`;
    for (const r of zone.resources) inner += tableTile(r);
    inner += "</div>";
  }
  return { inner };
}
function tableTile(r: FloorResource) {
  const s = r.currentSession;
  const line = s
    ? `${s.guests ? `${s.guests} гост. · ` : ""}${s.activeOrderCount ? `заказов ${s.activeOrderCount}` : s.orderCount ? `заказов ${s.orderCount}` : "без заказов"}`
    : r.nextReservation
      ? `бронь ${time(r.nextReservation.startsAt)} · ${r.nextReservation.guests} гост.`
      : r.capacity
        ? `до ${r.capacity} мест`
        : "";
  return `<a class="tbl st-${esc(r.state)}" href="/lite/table/${r.id}"><b>${esc(r.name)}</b><i>${esc(FLOOR_LABEL[r.state] ?? r.state)}</i><i>${esc(line)}</i></a>`;
}

function findResource(floor: FloorSnapshot, id: string): { r: FloorResource; z: FloorZone } | null {
  for (const z of floor.zones) for (const r of z.resources) if (r.id === id) return { r, z };
  return null;
}

type Folio = {
  orders: DineOrder[];
  totals: { payableMinor: string; withoutManualReceiptMinor: string };
};

async function tablePage(ctx: Ctx, staff: Staff, id: string) {
  const floor = await api<FloorSnapshot>(ctx, "GET", "/floor");
  if (!floor.ok)
    return floor.status === 401 ? null : flashBlock({ kind: "err", text: floor.message });
  const found = findResource(floor.data, id);
  if (!found) return flashBlock({ kind: "err", text: "Стол не найден" });
  const { r, z } = found;
  const s = r.currentSession;
  let html = `<p><a href="/lite/hall">← К залу</a></p><div class="card"><h1>${esc(r.name)}</h1><p class="muted">${esc(z.name)}${r.capacity ? ` · до ${r.capacity} мест` : ""}</p><p><span class="tbl st-${esc(r.state)}" style="width:auto;min-height:0;display:inline-block">${esc(FLOOR_LABEL[r.state] ?? r.state)}</span></p>`;
  for (const w of r.warnings) html += `<p class="flash err small">${esc(w)}</p>`;
  if (s) {
    html += `<h3>Текущий визит</h3><p>${esc(s.guestName ?? "Гость без аккаунта")}${s.guests ? ` · ${s.guests} гостей` : ""}</p><p class="muted small">С ${time(s.seatedAt ?? s.openedAt)}${s.expectedEndAt ? ` · освобождение ~${time(s.expectedEndAt)}` : ""} · заказов ${s.orderCount} · к получению ${money(s.payableMinor)}</p>`;
    const folio = await api<{ folio: Folio }>(ctx, "GET", `/floor/sessions/${s.id}/folio`);
    if (folio.ok && folio.data.folio.orders.length)
      html += `<ul class="lines">${folio.data.folio.orders
        .map(
          (o) =>
            `<li class="cf"><span class="r">${money(o.payableMinor)}</span><a href="/lite/order/${o.id}">№${esc(o.number)}</a> <span class="pill ${esc(o.status)}">${esc(STATUS_LABEL[o.status] ?? o.status)}</span><br><span class="small muted">${itemsLine(o)}</span></li>`,
        )
        .join(
          "",
        )}</ul><div class="total cf">Итого по визиту<span class="r">${money(folio.data.folio.totals.payableMinor)}</span></div>`;
  }
  const reservation = r.currentReservation ?? null;
  for (const [title, res] of [
    ["Бронь на текущее время", r.currentReservation],
    ["Следующая бронь", r.nextReservation],
  ] as const)
    if (res && (title === "Бронь на текущее время" || res.id !== reservation?.id))
      html += `<h3>${title}</h3><p>${esc(res.guestName || "Имя не указано")} · ${res.guests} гостей · ${time(res.startsAt)}–${time(res.endsAt)}</p><p class="muted small">${esc(RESERVATION_LABEL[res.status] ?? res.status)}${res.phone ? ` · <a href="tel:${esc(res.phone)}">${esc(res.phone)}</a>` : ""}${res.comment ? ` · ${esc(res.comment)}` : ""}</p>`;
  html += "</div>";
  if (canWrite(staff) && r.state !== "blocked") {
    if (s?.seatedAt) {
      html += `<a class="btn dark block" href="/lite/new?session=${s.id}">Создать заказ для стола</a>`;
      html += `<div class="card"><h2>Гости освободили стол</h2>${s.activeOrderCount ? `<p class="small" style="color:#92400e">Активных заказов: ${s.activeOrderCount}. Они сохранятся в фолио визита.</p>` : ""}${form(
        ctx,
        `/lite/session/${s.id}/release`,
        `${hidden("version", s.version)}${hidden("key", randomUUID())}${hidden("back", `/lite/table/${r.id}`)}<label>Комментарий к завершению</label><input class="field" type="text" name="reason" required minlength="3" maxlength="500" value="Гости ушли"><button type="submit" class="btn dark">Завершить визит</button>`,
        { confirm: "Завершить визит и освободить стол?" },
      )}</div>`;
    } else {
      const res = r.currentReservation;
      html += `<div class="card"><h2>${res ? "Посадить гостей по брони" : "Посадить гостей"}</h2>${form(
        ctx,
        `/lite/table/${r.id}/seat`,
        `${res ? hidden("reservationId", res.id) : ""}${hidden("key", randomUUID())}<div class="row"><div class="col"><label>Количество гостей</label><input class="field" type="number" name="guests" min="1" max="${r.capacity ?? 50}" value="${res?.guests ?? s?.guests ?? 2}" required></div><div class="col"><label>Визит, минут</label><select class="field" name="minutes">${[
          60, 90, 120, 150, 180, 240, 300,
        ]
          .map((m) => `<option value="${m}"${m === 120 ? " selected" : ""}>${m} мин</option>`)
          .join(
            "",
          )}</select></div></div><button type="submit" name="then" value="table" class="btn dark">Подтвердить посадку</button><button type="submit" name="then" value="order" class="btn">Посадить и создать заказ</button>`,
      )}</div>`;
    }
    if (r.bookable) html += bookingForm(ctx, r);
  }
  return html;
}

function bookingForm(ctx: Ctx, r: FloorResource) {
  const start = new Date(Date.now() + 60 * 60000);
  const minutes = start.getUTCMinutes();
  start.setUTCMinutes(minutes - (minutes % 15) + 15, 0, 0);
  return `<div class="card"><h2>Новая бронь на ${esc(r.name)}</h2>${form(
    ctx,
    `/lite/table/${r.id}/book`,
    `${hidden("key", randomUUID())}<div class="row"><div class="col"><label>Имя гостя</label><input class="field" type="text" name="guestName" required maxlength="100"></div><div class="col"><label>Телефон</label><input class="field" type="tel" name="phone" maxlength="30" placeholder="+7 ..."></div></div>
<div class="row"><div class="col3"><label>Дата</label><input class="field" type="text" name="date" value="${dateKey(start)}" placeholder="ГГГГ-ММ-ДД" pattern="\\d{4}-\\d{2}-\\d{2}" required></div><div class="col3"><label>Время</label><input class="field" type="text" name="time" value="${time(start)}" placeholder="ЧЧ:ММ" pattern="\\d{1,2}:\\d{2}" required></div><div class="col3"><label>Гостей</label><input class="field" type="number" name="guests" min="1" max="100" value="2" required></div></div>
<div class="row"><div class="col"><label>Длительность</label><select class="field" name="minutes">${[
      60, 90, 120, 150, 180, 240,
    ]
      .map((m) => `<option value="${m}"${m === 120 ? " selected" : ""}>${m} мин</option>`)
      .join(
        "",
      )}</select></div><div class="col"><label>Комментарий</label><input class="field" type="text" name="comment" maxlength="2000"></div></div>
<button type="submit" class="btn dark">Создать бронь</button>`,
  )}<p class="muted small">Дата и время — по Алматы. Формат даты: 2026-11-22, времени: 19:30.</p></div>`;
}

type Conversation = {
  chatKey: string;
  chatId: string;
  phone: string | null;
  guestName: string | null;
  paused: boolean;
  pausedReason: string | null;
  lastMessageAt: string;
  lastMessage: string | null;
  bookings: number;
};
type ChatMessage = { id: string; role: "guest" | "agent" | "system"; text: string; at: string };
const chatLabel = (c: Conversation) => c.guestName || c.phone || c.chatId.replace(/@.*/, "");
const chatHref = (key: string) => `/lite/whatsapp/chat?key=${encodeURIComponent(key)}`;
function waLink(phone: string | null) {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length === 11 ? `https://wa.me/${digits}` : null;
}
function chatRow(c: Conversation) {
  return `<a class="card title${c.paused ? " warn" : ""}" href="${chatHref(c.chatKey)}" style="display:block;text-decoration:none"><div class="cf"><span class="muted small" style="float:right">${dateTime(c.lastMessageAt)}</span><b>${esc(chatLabel(c))}</b></div>${c.guestName && c.phone ? `<p class="muted small">${esc(c.phone)}</p>` : ""}${c.paused ? `<p class="small bold" style="color:#92400e">ИИ остановлен: ${esc(c.pausedReason ?? "нужен сотрудник")}</p>` : ""}<p class="small">${esc((c.lastMessage ?? "").slice(0, 160))}</p>${c.bookings ? `<span class="pill delivered">Броней: ${c.bookings}</span>` : ""}</a>`;
}

async function whatsappPage(ctx: Ctx) {
  const list = await api<{ conversations: Conversation[] }>(ctx, "GET", "/agent/conversations");
  if (!list.ok)
    return list.status === 401
      ? null
      : { inner: flashBlock({ kind: "err", text: list.message }), newIds: "" };
  const all = list.data.conversations;
  const waiting = all.filter((c) => c.paused);
  let inner = "";
  if (waiting.length)
    inner += `<h2 style="color:#92400e">Ждут сотрудника · ${waiting.length}</h2>${grid(waiting.map(chatRow))}`;
  inner += `<h2>Все диалоги</h2>`;
  const rest = all.filter((c) => !c.paused);
  inner += rest.length
    ? grid(rest.map(chatRow))
    : '<div class="card"><p class="muted">Диалогов пока нет — они появятся, когда гости напишут в WhatsApp.</p></div>';
  return { inner, newIds: waiting.map((c) => `wa:${c.chatKey}`).join(",") };
}

async function chatPage(ctx: Ctx, staff: Staff, key: string) {
  const [list, messages] = await Promise.all([
    api<{ conversations: Conversation[] }>(ctx, "GET", "/agent/conversations"),
    api<{ messages: ChatMessage[] }>(
      ctx,
      "GET",
      `/agent/conversations/messages?key=${encodeURIComponent(key)}`,
    ),
  ]);
  if (messages.status === 401 || list.status === 401) return null;
  const c = list.ok ? list.data.conversations.find((item) => item.chatKey === key) : undefined;
  let inner = "";
  if (!messages.ok) inner += flashBlock({ kind: "err", text: messages.message });
  for (const m of messages.ok ? messages.data.messages : []) {
    if (m.role === "system")
      inner += `<p class="muted small" style="text-align:center">${esc(m.text)} · ${dateTime(m.at)}</p>`;
    else
      inner += `<div class="cf"><div class="bubble ${m.role}">${esc(m.text).replace(/\n/g, "<br>")}<span class="when">${m.role === "agent" ? "Даян · " : ""}${dateTime(m.at)}</span></div></div>`;
  }
  if (messages.ok && !messages.data.messages.length)
    inner += '<p class="muted">Сообщений пока нет.</p>';
  let head = `<p><a href="/lite/whatsapp">← Все диалоги</a></p><h1>${esc(c ? chatLabel(c) : "Диалог")}</h1>${c?.phone ? `<p class="muted">${esc(c.phone)}</p>` : ""}`;
  if (c?.paused)
    head += `<p class="flash err">ИИ в этом чате молчит: ${esc(c.pausedReason ?? "нужен сотрудник")}. Ответьте гостю в WhatsApp, затем верните ИИ.</p>`;
  const actions: string[] = [];
  if (c && canWrite(staff))
    actions.push(
      form(
        ctx,
        "/lite/whatsapp/pause",
        `${hidden("key", key)}${hidden("paused", c.paused ? "no" : "yes")}<button type="submit" class="btn ${c.paused ? "ok" : "dark"}">${c.paused ? "Вернуть ИИ" : "Ответить самому"}</button>`,
        {
          cls: "inline",
          ...(c.paused ? {} : { confirm: "Остановить ИИ в этом чате? Отвечать гостю будете вы." }),
        },
      ),
    );
  const wa = waLink(c?.phone ?? null);
  if (wa) actions.push(`<a class="btn" href="${wa}">Открыть WhatsApp</a>`);
  head += `<p>${actions.join(" ")}</p>`;
  return { head, inner, src: chatHref(key) };
}

const BULK_CANCEL_REASON = "Тестовый заказ — массовая очистка менеджером";

/** Manager clean-up: every order still in the service queue, with checkboxes. */
async function bulkPage(ctx: Ctx) {
  const ops = await api<Operations>(ctx, "GET", "/dine-in/operations");
  if (!ops.ok) return ops.status === 401 ? null : flashBlock({ kind: "err", text: ops.message });
  const all = ctx.url.searchParams.get("all") === "1";
  const orders = ops.data.orders;
  let html = `<p><a href="/lite/orders">← К заказам</a></p><h1>Массовое закрытие</h1><p class="muted">Все заказы, которые ещё висят в очереди: не закрытые или без отметки оплаты. Отметьте ненужные и выберите действие. Нужные заказы не отмечайте.</p>`;
  if (!orders.length)
    return `${html}<div class="card"><p class="muted">Очередь пуста — закрывать нечего.</p></div>`;
  html += `<p>${all ? '<a class="btn sm" href="/lite/orders/bulk">Снять все отметки</a>' : '<a class="btn sm" href="/lite/orders/bulk?all=1">Отметить все</a>'} <span class="muted small">В очереди: ${orders.length}</span></p>`;
  const rows = orders
    .map(
      (o) =>
        `<tr><td style="width:56px;text-align:center"><input type="checkbox" name="id" value="${o.id}" id="o${o.id}" style="width:28px;height:28px"${all ? " checked" : ""}></td><td><label for="o${o.id}" style="margin:0;font-size:15px;color:#111827"><b>№${esc(o.number)} · ${esc(placeName(o))}</b> · ${dateTime(o.acceptedAt)}<br><span class="small">${itemsLine(o)}</span><br><span class="pill ${esc(o.status)}">${esc(STATUS_LABEL[o.status] ?? o.status)}</span> <span class="small muted">${o.manualPaymentAt ? "оплата отмечена" : "без оплаты"}</span></label></td><td class="right bold" style="white-space:nowrap">${money(o.payableMinor)}</td></tr>`,
    )
    .join("");
  html += form(
    ctx,
    "/lite/orders/bulk",
    `<div class="card" style="padding:4px"><table class="bulk" style="width:100%;border-collapse:collapse">${rows}</table></div>
<div class="card"><button type="submit" name="action" value="cancel" class="btn dark block">Отменить отмеченные как тестовые</button><p class="muted small">Заказ получит статус «Отменён» с причиной «${esc(BULK_CANCEL_REASON)}». Выручка не меняется. Подходит для тестовых заказов.</p>
<button type="submit" name="action" value="close" class="btn block">Закрыть отмеченные как обслуженные</button><p class="muted small">Заказ проходит все шаги до «Закрыт» и получает отметку оплаты. Сумма попадёт в полученные деньги.</p></div>`,
    { confirm: "Применить действие к отмеченным заказам? Отменить это нельзя." },
  );
  return html;
}
async function cancelOrder(ctx: Ctx, id: string): Promise<true | 401 | string> {
  const result = await api(ctx, "POST", `/dine-in/orders/${id}/cancel`, {
    reason: BULK_CANCEL_REASON,
  });
  return result.ok ? true : result.status === 401 ? 401 : result.message;
}
async function closeOrder(ctx: Ctx, id: string): Promise<true | 401 | string> {
  const detail = await api<{ order: DineOrder }>(ctx, "GET", `/dine-in/orders/${id}`);
  if (!detail.ok) return detail.status === 401 ? 401 : detail.message;
  let status = detail.data.order.status;
  if (status === "cancelled") return "заказ уже отменён";
  while (NEXT_STEP[status]) {
    const target = NEXT_STEP[status][0];
    const step = await api(ctx, "PATCH", `/dine-in/orders/${id}/status`, { status: target });
    if (!step.ok)
      return step.status === 401 ? 401 : `№${detail.data.order.number}: ${step.message}`;
    status = target as DineOrder["status"];
  }
  if (!detail.data.order.manualPaymentAt) {
    const paid = await api(ctx, "PATCH", `/dine-in/orders/${id}/status`, {
      manualPaymentReceived: true,
    });
    if (!paid.ok)
      return paid.status === 401 ? 401 : `№${detail.data.order.number}: ${paid.message}`;
  }
  return true;
}

async function bookingsPage(ctx: Ctx) {
  const requested = ctx.url.searchParams.get("date") ?? "";
  const day = /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : dateKey();
  const floor = await api<FloorSnapshot>(ctx, "GET", `/floor?date=${day}`);
  if (!floor.ok)
    return floor.status === 401 ? null : flashBlock({ kind: "err", text: floor.message });
  const shift = (days: number) => {
    const d = new Date(`${day}T12:00:00+05:00`);
    d.setUTCDate(d.getUTCDate() + days);
    return dateKey(d);
  };
  const seen = new Set<string>();
  const rows = floor.data.zones
    .flatMap((z) => z.resources.flatMap((r) => r.reservations.map((res) => ({ res, r, z }))))
    .filter(({ res }) => (seen.has(res.id) ? false : (seen.add(res.id), true)))
    .sort((a, b) => Date.parse(a.res.startsAt) - Date.parse(b.res.startsAt));
  let html = `<h1>Брони · ${humanDate(day)}</h1><p><a class="btn sm" href="/lite/bookings?date=${shift(-1)}">← Пред. день</a><a class="btn sm" href="/lite/bookings">Сегодня</a><a class="btn sm" href="/lite/bookings?date=${shift(1)}">След. день →</a></p>`;
  if (!rows.length) html += '<div class="card"><p class="muted">Броней на этот день нет.</p></div>';
  html += grid(
    rows.map(
      ({ res, r, z }) =>
        `<div class="card${res.status === "cancelled" || res.status === "no_show" ? "" : " warn"}"><a class="title" href="/lite/table/${r.id}"><h2>${time(res.startsAt)}–${time(res.endsAt)} · ${esc(res.guestName || "Имя не указано")}</h2><p>${esc(r.name)} · ${esc(z.name)} · ${res.guests} гостей</p></a><p class="muted small">${esc(RESERVATION_LABEL[res.status] ?? res.status)}${res.phone ? ` · <a href="tel:${esc(res.phone)}">${esc(res.phone)}</a>` : ""}</p>${res.comment ? `<p class="small">${esc(res.comment)}</p>` : ""}${res.preorders?.length ? `<p class="small">Предзаказ: ${res.preorders.map((p) => `${p.quantity} × ${esc(p.productName)}`).join(", ")}</p>` : ""}</div>`,
    ),
  );
  html += '<p class="muted small">Новая бронь создаётся из карточки стола в разделе «Зал».</p>';
  return html;
}

type Product = { id: string; name: string; category?: string; price: number; isAvailable: boolean };
type Catalog = {
  regular: { items: Product[] };
  exchange: { products: Product[] } | null;
};
type Quote = {
  id: string;
  expiresAt: string;
  payableMinor: number;
  items: { name: string; quantity: number; totalMinor: number }[];
};

async function newOrderPage(ctx: Ctx, staff: Staff) {
  const session = ctx.url.searchParams.get("session") ?? "";
  const floor = await api<FloorSnapshot>(ctx, "GET", "/floor");
  if (!floor.ok)
    return floor.status === 401 ? null : flashBlock({ kind: "err", text: floor.message });
  const table = floor.data.zones
    .flatMap((z) => z.resources.map((r) => ({ r, z })))
    .find(({ r }) => r.currentSession?.id === session && r.currentSession.seatedAt);
  if (!UUID.test(session) || !table) {
    let html = '<h1>Новый заказ</h1><p class="muted">Шаг 1 из 2 — выберите стол.</p>';
    for (const z of floor.data.zones) {
      const seated = z.resources.filter((r) => r.currentSession?.seatedAt && r.state !== "blocked");
      const others = z.resources.filter(
        (r) => !r.currentSession?.seatedAt && r.state !== "blocked",
      );
      html += `<div class="zone"><h2>${esc(z.name)}</h2>`;
      for (const r of seated)
        html += `<a class="tbl st-${esc(r.state)}" href="/lite/new?session=${r.currentSession!.id}"><b>${esc(r.name)}</b><i>Гости на месте</i><i>Выбрать</i></a>`;
      for (const r of others)
        html += `<a class="tbl st-${esc(r.state)}" href="/lite/table/${r.id}"><b>${esc(r.name)}</b><i>${esc(FLOOR_LABEL[r.state] ?? r.state)}</i><i>Сначала посадить</i></a>`;
      html += "</div>";
    }
    return html;
  }
  const catalog = await api<Catalog>(ctx, "GET", "/dine-in/catalog");
  if (!catalog.ok) return flashBlock({ kind: "err", text: catalog.message });
  const sections: { title: string; prefix: string; items: Product[] }[] = [];
  const byCategory = new Map<string, Product[]>();
  for (const p of catalog.data.regular.items.filter((p) => p.isAvailable)) {
    const key = p.category || "Меню";
    byCategory.set(key, [...(byCategory.get(key) ?? []), p]);
  }
  for (const [title, items] of byCategory) sections.push({ title, prefix: "r", items });
  const exchange = catalog.data.exchange?.products.filter((p) => p.isAvailable) ?? [];
  if (exchange.length) sections.push({ title: "Биржа напитков", prefix: "e", items: exchange });
  let html = `<p><a href="/lite/new">← Другой стол</a></p><h1>Заказ · ${esc(table.r.name)}</h1><p class="muted">${esc(table.z.name)} · шаг 2 из 2 — укажите количество и нажмите «Рассчитать».</p>`;
  if (!sections.length)
    return `${html}<div class="card"><p class="muted">Меню пока пустое.</p></div>`;
  html += `<p class="jump">${sections.map((s, i) => `<a href="#cat${i}">${esc(s.title)}</a>`).join("")}</p>`;
  let body = hidden("session", session);
  sections.forEach((s, i) => {
    body += `<h2 class="menu-cat" id="cat${i}">${esc(s.title)}</h2>`;
    for (const p of s.items)
      body += `<div class="menu-row cf"><span class="r"><input class="qty" type="number" min="0" max="99" name="q:${s.prefix}:${esc(p.id)}" value="" placeholder="0"></span><span class="name">${esc(p.name)} <span class="muted">· ${money(Math.round(p.price * 100))}</span></span></div>`;
  });
  body += '<button type="submit" class="btn dark block">Рассчитать заказ</button>';
  html += form(ctx, "/lite/new/quote", `<div class="card">${body}</div>`);
  return html;
}

function quoteView(ctx: Ctx, quote: Quote, session: string, key: string, warning = "") {
  return `<h1>Проверьте заказ</h1>${warning ? flashBlock({ kind: "err", text: warning }) : ""}<div class="card"><ul class="lines">${quote.items
    .map(
      (i) =>
        `<li class="cf"><span class="r">${money(i.totalMinor)}</span>${i.quantity} × ${esc(i.name)}</li>`,
    )
    .join(
      "",
    )}</ul><div class="total cf">К получению<span class="r">${money(quote.payableMinor)}</span></div><p class="muted small">Расчёт действует до ${time(quote.expiresAt)}. Повторное нажатие безопасно — заказ не задвоится.</p>${form(
    ctx,
    "/lite/new/submit",
    `${hidden("quoteId", quote.id)}${hidden("key", key)}${hidden("session", session)}${hidden("payable", quote.payableMinor)}${quote.items.map((i, n) => hidden(`line${n}`, `${i.quantity}|${i.totalMinor}|${i.name}`)).join("")}${hidden("expires", quote.expiresAt)}<button type="submit" class="btn ok block">Оформить заказ</button>`,
  )}<a class="btn block" href="/lite/new?session=${esc(session)}">Изменить состав</a></div>`;
}

/* ---------------- router ---------------- */

export function createLiteHandler(dispatch: Dispatch) {
  return async function handleLite(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    if (url.pathname !== "/lite" && !url.pathname.startsWith("/lite/")) return null;
    const path = url.pathname.replace(/\/+$/, "") || "/lite";
    if (path === "/lite/beep.wav")
      return new Response(beepWav(), {
        headers: { "content-type": "audio/wav", "cache-control": "public, max-age=86400" },
      });
    const cookies = parseCookies(request.headers.get("cookie"));
    const ctx: Ctx = {
      request,
      url,
      cookies,
      csrf: cookies.get(CSRF_COOKIE) ?? "",
      setCookies: [],
      dispatch,
    };
    if (!/^[A-Za-z0-9_-]{43}$/.test(ctx.csrf)) {
      ctx.csrf = randomBytes(32).toString("base64url");
      ctx.setCookies.push(liteCookie(CSRF_COOKIE, ctx.csrf, 30 * 86400));
    }
    try {
      if (request.method === "POST") return await handlePost(ctx, path);
      if (request.method !== "GET" && request.method !== "HEAD")
        return respond(ctx, "Method not allowed", 405);
      return await handleGet(ctx, path);
    } catch (error) {
      console.error("[lite] request failed", error instanceof Error ? error.message : error);
      return respond(
        ctx,
        page({
          title: "Ошибка",
          body: `${flashBlock({ kind: "err", text: "Не удалось открыть страницу. Обновите её через несколько секунд." })}<a class="btn dark" href="/lite/shift">Повторить</a>`,
        }),
        500,
      );
    }
  };
}

async function handleGet(ctx: Ctx, path: string): Promise<Response> {
  const partial = ctx.url.searchParams.get("partial") === "1";
  if (path === "/lite/login") {
    const staff = await me(ctx);
    if (staff) return redirect(ctx, "/lite/shift");
    const flash = takeFlash(ctx);
    return respond(
      ctx,
      page({
        title: "Вход",
        body: `<div class="login"><p class="muted" style="letter-spacing:2px">HOSTESS COMMAND CENTER</p><h1>Вход сотрудника</h1>${flashBlock(flash)}<div class="card"><form method="post" action="/lite/login" accept-charset="utf-8">${csrfField(ctx.csrf)}<label for="u">Логин</label><input id="u" class="field" type="text" name="username" autocomplete="username" autocapitalize="off" autocorrect="off" required><label for="p">Пароль</label><input id="p" class="field" type="password" name="password" autocomplete="current-password" required><button type="submit" class="btn dark block" style="margin-top:16px">Войти</button></form></div><p class="muted small">Облегчённая версия для старых планшетов. Работает даже без JavaScript.</p></div>`,
      }),
    );
  }
  const staff = await me(ctx);
  if (!staff) {
    if (partial) return respond(ctx, "", 401);
    return redirect(ctx, "/lite/login");
  }
  if (path === "/lite") return redirect(ctx, "/lite/shift");
  const flash = takeFlash(ctx);
  const render = (
    title: string,
    nav: Nav,
    body: string,
    extra: { live?: boolean; newCount?: number; waitingCount?: number } = {},
  ) =>
    respond(
      ctx,
      page({ title, nav, staff, csrf: ctx.csrf, body: flashBlock(flash) + body, ...extra }),
    );
  const relogin = () =>
    redirect(ctx, "/lite/login", { kind: "err", text: "Сессия завершилась. Войдите снова." });

  if (path === "/lite/shift") {
    const view = await shiftPage(ctx, staff);
    if (!view) return partial ? respond(ctx, "", 401) : relogin();
    if (partial) return respond(ctx, view.inner, 200, { "x-lite-new": view.newIds });
    return render(
      "Смена",
      "shift",
      `<h1>Смена</h1><p class="muted">Стол, заказ и следующее действие — в одной очереди.</p>${canWrite(staff) ? '<a class="btn dark" href="/lite/new">+ Создать заказ</a>' : ""}${liveWrap(view.src, view.inner, view.newIds)}`,
      { live: true, newCount: view.newCount, waitingCount: view.waitingCount },
    );
  }
  if (path === "/lite/orders") {
    const view = await ordersPage(ctx, staff);
    if (!view) return partial ? respond(ctx, "", 401) : relogin();
    if (partial) return respond(ctx, view.inner, 200);
    return render(
      "Заказы",
      "orders",
      `<h1>Заказы</h1>${view.filters}${liveWrap(view.src, view.inner, "")}`,
      { live: true },
    );
  }
  if (path === "/lite/orders/bulk") {
    if (staff.role !== "manager")
      return redirect(ctx, "/lite/orders", {
        kind: "err",
        text: "Массовое закрытие доступно менеджеру",
      });
    const html = await bulkPage(ctx);
    return html === null ? relogin() : render("Массовое закрытие", "orders", html);
  }
  if (path === "/lite/hall") {
    const view = await hallPage(ctx);
    if (!view) return partial ? respond(ctx, "", 401) : relogin();
    if (partial) return respond(ctx, view.inner, 200);
    return render(
      "Зал",
      "hall",
      `<h1>Зал</h1><p class="muted">Нажмите на стол, чтобы посадить гостей, создать заказ или бронь.</p>${liveWrap("/lite/hall", view.inner, "")}`,
      { live: true },
    );
  }
  if (path === "/lite/whatsapp") {
    const view = await whatsappPage(ctx);
    if (!view) return partial ? respond(ctx, "", 401) : relogin();
    if (partial) return respond(ctx, view.inner, 200, { "x-lite-new": view.newIds });
    return render(
      "WhatsApp",
      "whatsapp",
      `<h1>Даян · WhatsApp</h1><p class="muted">Даян отвечает гостям и ставит брони. Если он передал чат сотруднику — чат наверху, ИИ в нём молчит, пока вы не вернёте его.</p>${liveWrap("/lite/whatsapp", view.inner, view.newIds)}`,
      { live: true },
    );
  }
  if (path === "/lite/whatsapp/chat") {
    const key = (ctx.url.searchParams.get("key") ?? "").slice(0, 300);
    if (!key) return redirect(ctx, "/lite/whatsapp");
    const view = await chatPage(ctx, staff, key);
    if (!view) return partial ? respond(ctx, "", 401) : relogin();
    if (partial) return respond(ctx, view.inner, 200);
    return render("WhatsApp", "whatsapp", view.head + liveWrap(view.src, view.inner, ""), {
      live: true,
    });
  }
  if (path === "/lite/bookings") {
    const html = await bookingsPage(ctx);
    return html === null ? relogin() : render("Брони", "bookings", html);
  }
  if (path === "/lite/new") {
    if (!canWrite(staff))
      return redirect(ctx, "/lite/shift", { kind: "err", text: "Недостаточно прав" });
    const html = await newOrderPage(ctx, staff);
    return html === null ? relogin() : render("Новый заказ", "new", html);
  }
  const order = /^\/lite\/order\/([a-f0-9-]{36})$/i.exec(path);
  if (order) {
    const html = await orderPage(ctx, staff, order[1]);
    return html === null ? relogin() : render("Заказ", "orders", html);
  }
  const table = /^\/lite\/table\/([a-f0-9-]{36})$/i.exec(path);
  if (table) {
    const html = await tablePage(ctx, staff, table[1]);
    return html === null ? relogin() : render("Стол", "hall", html);
  }
  return render(
    "Не найдено",
    "",
    '<div class="card"><h1>Страница не найдена</h1><a class="btn dark" href="/lite/shift">К смене</a></div>',
  );
}

function int(value: string | null, min: number, max: number, fallback: number) {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

async function handlePost(ctx: Ctx, path: string): Promise<Response> {
  const form = await readForm(ctx.request);
  if (!csrfValid(ctx, form)) {
    // Fresh token is already in ctx.csrf / Set-Cookie; send the user back to retry.
    return redirect(
      ctx,
      path === "/lite/login"
        ? "/lite/login"
        : safeBack(
            ctx.request.headers.get("referer")?.replace(/^https?:\/\/[^/]+/, ""),
            "/lite/shift",
          ),
      {
        kind: "err",
        text: "Страница устарела. Повторите действие ещё раз.",
      },
    );
  }
  const forward = (result: { setCookie: string[] }) => ctx.setCookies.push(...result.setCookie);
  const fail = (result: { message: string; status: number }, back: string) =>
    result.status === 401
      ? redirect(ctx, "/lite/login", { kind: "err", text: "Сессия завершилась. Войдите снова." })
      : redirect(ctx, back, { kind: "err", text: result.message });

  if (path === "/lite/login") {
    const username = (form.get("username") ?? "").trim();
    const password = form.get("password") ?? "";
    if (!username || !password)
      return redirect(ctx, "/lite/login", { kind: "err", text: "Введите логин и пароль" });
    const result = await api<{ staff: Staff }>(ctx, "POST", "/login", { username, password });
    if (!result.ok) return redirect(ctx, "/lite/login", { kind: "err", text: result.message });
    forward(result);
    return redirect(ctx, "/lite/shift");
  }
  if (path === "/lite/logout") {
    const result = await api(ctx, "POST", "/logout", {});
    forward(result);
    return redirect(ctx, "/lite/login", { kind: "ok", text: "Вы вышли из аккаунта" });
  }

  const order = /^\/lite\/order\/([a-f0-9-]{36})\/(status|paid|cancel)$/i.exec(path);
  if (order) {
    const [, id, action] = order;
    const back = safeBack(form.get("back"), `/lite/order/${id}`);
    const result =
      action === "cancel"
        ? await api(ctx, "POST", `/dine-in/orders/${id}/cancel`, {
            reason: (form.get("reason") ?? "").trim(),
          })
        : await api(
            ctx,
            "PATCH",
            `/dine-in/orders/${id}/status`,
            action === "paid"
              ? { manualPaymentReceived: true }
              : { status: form.get("status") ?? "" },
          );
    if (!result.ok) return fail(result, back);
    const text =
      action === "paid"
        ? "Оплата отмечена"
        : action === "cancel"
          ? "Заказ отменён"
          : `Статус: ${STATUS_LABEL[form.get("status") ?? ""] ?? "обновлён"}`;
    return redirect(ctx, back, { kind: "ok", text });
  }

  if (path === "/lite/orders/bulk") {
    const ids = form
      .getAll("id")
      .filter((id) => UUID.test(id))
      .slice(0, 200);
    const action = form.get("action") === "close" ? "close" : "cancel";
    if (!ids.length)
      return redirect(ctx, "/lite/orders/bulk", {
        kind: "err",
        text: "Отметьте хотя бы один заказ",
      });
    let done = 0;
    const failed: string[] = [];
    for (const id of ids) {
      const outcome = action === "cancel" ? await cancelOrder(ctx, id) : await closeOrder(ctx, id);
      if (outcome === true) done++;
      else if (outcome === 401) return fail({ status: 401, message: "" }, "/lite/login");
      else failed.push(outcome);
    }
    const verb = action === "cancel" ? "Отменено" : "Закрыто";
    return redirect(ctx, "/lite/orders/bulk", {
      kind: failed.length ? "err" : "ok",
      text: `${verb}: ${done} из ${ids.length}.${failed.length ? ` Не получилось: ${failed.slice(0, 5).join("; ")}` : ""}`,
    });
  }
  if (path === "/lite/whatsapp/pause") {
    const key = (form.get("key") ?? "").slice(0, 300);
    const paused = form.get("paused") === "yes";
    const back = key ? chatHref(key) : "/lite/whatsapp";
    const result = await api(
      ctx,
      "POST",
      `/agent/conversations/pause?key=${encodeURIComponent(key)}`,
      paused ? { paused: true, reason: "отвечает сотрудник" } : { paused: false },
    );
    if (!result.ok) return fail(result, back);
    return redirect(ctx, back, {
      kind: "ok",
      text: paused ? "ИИ остановлен — ответьте гостю в WhatsApp" : "ИИ снова отвечает в этом чате",
    });
  }
  const requestMatch = /^\/lite\/request\/([a-f0-9-]{36})$/i.exec(path);
  if (requestMatch) {
    const confirm = form.get("action") === "confirm";
    const result = await api(
      ctx,
      "PATCH",
      `/dine-in/booking-requests/${requestMatch[1]}`,
      confirm
        ? { action: "confirm", resourceId: form.get("resourceId") ?? "" }
        : {
            action: "reject",
            reason: "Нет подходящего места; свяжитесь с заведением для выбора другого времени",
          },
    );
    if (!result.ok) return fail(result, "/lite/shift");
    return redirect(ctx, "/lite/shift", {
      kind: "ok",
      text: confirm ? "Бронь подтверждена" : "Заявка отклонена",
    });
  }

  const seat = /^\/lite\/table\/([a-f0-9-]{36})\/seat$/i.exec(path);
  if (seat) {
    const back = `/lite/table/${seat[1]}`;
    const reservationId = form.get("reservationId");
    const result = await api<{ session: { id: string } }>(ctx, "POST", "/floor/seat", {
      resourceId: seat[1],
      ...(reservationId && UUID.test(reservationId) ? { reservationId } : {}),
      guests: int(form.get("guests"), 1, 100, 2),
      expectedEndAt: new Date(
        Date.now() + int(form.get("minutes"), 15, 1440, 120) * 60000,
      ).toISOString(),
      idempotencyKey: form.get("key") || randomUUID(),
    });
    if (!result.ok) return fail(result, back);
    if (form.get("then") === "order" && result.data?.session?.id)
      return redirect(ctx, `/lite/new?session=${result.data.session.id}`, {
        kind: "ok",
        text: "Посадка подтверждена",
      });
    return redirect(ctx, back, { kind: "ok", text: "Посадка подтверждена" });
  }

  const release = /^\/lite\/session\/([a-f0-9-]{36})\/release$/i.exec(path);
  if (release) {
    const back = safeBack(form.get("back"), "/lite/hall");
    const result = await api(ctx, "POST", `/floor/sessions/${release[1]}/release`, {
      reason: (form.get("reason") ?? "").trim(),
      version: int(form.get("version"), 1, 2147483647, 1),
      idempotencyKey: form.get("key") || randomUUID(),
    });
    if (!result.ok) return fail(result, back);
    return redirect(ctx, back, { kind: "ok", text: "Визит завершён, стол свободен" });
  }

  const book = /^\/lite\/table\/([a-f0-9-]{36})\/book$/i.exec(path);
  if (book) {
    const back = `/lite/table/${book[1]}`;
    const date = (form.get("date") ?? "").trim();
    const clock = (form.get("time") ?? "").trim().replace(/^(\d):/, "0$1:");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(clock))
      return redirect(ctx, back, {
        kind: "err",
        text: "Укажите дату как 2026-11-22 и время как 19:30",
      });
    const startsAt = new Date(`${date}T${clock}:00+05:00`);
    if (Number.isNaN(startsAt.getTime()))
      return redirect(ctx, back, { kind: "err", text: "Неверная дата или время" });
    const phone = (form.get("phone") ?? "").trim();
    const comment = (form.get("comment") ?? "").trim();
    const result = await api(ctx, "POST", "/floor/reservations", {
      resourceId: book[1],
      guestName: (form.get("guestName") ?? "").trim(),
      ...(phone ? { phone } : {}),
      guests: int(form.get("guests"), 1, 100, 2),
      startsAt: startsAt.toISOString(),
      endsAt: new Date(
        startsAt.getTime() + int(form.get("minutes"), 15, 1440, 120) * 60000,
      ).toISOString(),
      source: "phone",
      ...(comment ? { comment } : {}),
      idempotencyKey: form.get("key") || randomUUID(),
    });
    if (!result.ok) return fail(result, back);
    return redirect(ctx, `/lite/bookings?date=${date}`, { kind: "ok", text: "Бронь создана" });
  }

  if (path === "/lite/new/quote") {
    const session = form.get("session") ?? "";
    const back = `/lite/new?session=${encodeURIComponent(session)}`;
    const items: { productId: string; quantity: number; itemType: string }[] = [];
    for (const [name, value] of form) {
      const match = /^q:(r|e):(.{1,100})$/.exec(name);
      const quantity = int(value, 0, 99, 0);
      if (match && quantity > 0)
        items.push({
          productId: match[2],
          quantity,
          itemType: match[1] === "r" ? "REGULAR_MENU" : "EXCHANGE",
        });
    }
    if (!items.length)
      return redirect(ctx, back, {
        kind: "err",
        text: "Укажите количество хотя бы у одной позиции",
      });
    if (items.length > 30)
      return redirect(ctx, back, {
        kind: "err",
        text: "Не больше 30 разных позиций в одном заказе",
      });
    const quote = await api<Quote>(ctx, "POST", "/dine-in/staff-quotes", {
      sessionId: session,
      preorderIds: [],
      useVisitGuest: false,
      redeemMinor: 0,
      items,
    });
    if (!quote.ok) return fail(quote, back);
    const staff = await me(ctx);
    return respond(
      ctx,
      page({
        title: "Проверка заказа",
        nav: "new",
        staff,
        csrf: ctx.csrf,
        body: quoteView(ctx, quote.data, session, randomUUID()),
      }),
    );
  }

  if (path === "/lite/new/submit") {
    const session = form.get("session") ?? "";
    const quoteId = form.get("quoteId") ?? "";
    const key = form.get("key") ?? "";
    const result = await api<{ order: DineOrder }>(ctx, "POST", "/dine-in/staff-orders", {
      quoteId,
      idempotencyKey: key,
    });
    if (result.ok)
      return redirect(ctx, `/lite/order/${result.data.order.id}`, {
        kind: "ok",
        text: `Заказ №${result.data.order.number} оформлен`,
      });
    if (result.status === 401) return fail(result, "/lite/login");
    if (result.status >= 500) {
      // Outcome unknown: offer a safe replay with the same quote and idempotency key.
      const lines: Quote["items"] = [];
      for (let n = 0; form.has(`line${n}`); n++) {
        const [quantity, total, ...name] = (form.get(`line${n}`) ?? "").split("|");
        lines.push({ quantity: Number(quantity), totalMinor: Number(total), name: name.join("|") });
      }
      const quote: Quote = {
        id: quoteId,
        expiresAt: form.get("expires") ?? new Date().toISOString(),
        payableMinor: Number(form.get("payable") ?? 0),
        items: lines,
      };
      const staff = await me(ctx);
      return respond(
        ctx,
        page({
          title: "Проверка заказа",
          nav: "new",
          staff,
          csrf: ctx.csrf,
          body: quoteView(
            ctx,
            quote,
            session,
            key,
            "Ответ не получен. Заказ мог быть создан — нажмите «Оформить» ещё раз, повтор безопасен.",
          ),
        }),
      );
    }
    return redirect(ctx, `/lite/new?session=${encodeURIComponent(session)}`, {
      kind: "err",
      text: `${result.message}. Проверьте состав и рассчитайте заново.`,
    });
  }

  return redirect(ctx, "/lite/shift");
}
