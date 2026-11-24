import { LITE_CSS, LITE_JS } from "./assets";

/** Escapes text for HTML element content and double-quoted attributes. */
export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const VENUE_OFFSET_MS = 5 * 3600000;
const MONTHS = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];
const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
/** Venue wall clock (Asia/Almaty, fixed UTC+5), independent of server tzdata. */
function wall(value: string | Date) {
  return new Date(new Date(value).getTime() + VENUE_OFFSET_MS);
}
export function time(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = wall(value);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
export function dateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = wall(value);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${time(value)}`;
}
export function dateKey(value: string | Date = new Date()): string {
  const d = wall(value);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
export function humanDate(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return `${d} ${MONTHS[(m || 1) - 1]} ${y}`;
}
/** Tenge from minor units, e.g. 245050 → «2 450,50 тг». No ₸ glyph: old Android fonts lack it. */
export function money(minor: string | number | null | undefined): string {
  const value = Number(minor ?? 0) / 100;
  const negative = value < 0;
  const [whole, fraction] = Math.abs(value).toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${negative ? "-" : ""}${grouped}${fraction === "00" ? "" : `,${fraction}`} тг`;
}
export function minutesAgo(value: string, now = Date.now()) {
  return Math.max(0, Math.floor((now - Date.parse(value)) / 60000));
}

export type Nav = "shift" | "orders" | "hall" | "bookings" | "whatsapp" | "new" | "";
export type Flash = { kind: "ok" | "err"; text: string } | null;
export type Staff = { id: string; role: string };

export const ROLE_LABEL: Record<string, string> = {
  manager: "Менеджер",
  operator: "Сотрудник",
  viewer: "Просмотр",
};

export function flashBlock(flash: Flash) {
  if (!flash) return "";
  return `<div class="flash ${flash.kind}" role="${flash.kind === "err" ? "alert" : "status"}">${esc(flash.text)}</div>`;
}

export function csrfField(token: string) {
  return `<input type="hidden" name="_csrf" value="${esc(token)}">`;
}

export function page(input: {
  title: string;
  body: string;
  staff?: Staff | null;
  nav?: Nav;
  csrf?: string;
  newCount?: number;
  waitingCount?: number;
  /** Data source for the live region; enables polling and a no-JS refresh. */
  live?: boolean;
}) {
  const { staff, nav = "", csrf = "" } = input;
  const link = (key: Nav, href: string, label: string, extra = "") =>
    `<a href="${href}" class="${nav === key ? "on" : ""}${extra}">${label}</a>`;
  const header = staff
    ? `<div class="top"><div class="brand">XOXO<span>Command Center</span></div>
<div class="who"><span class="id">${esc(ROLE_LABEL[staff.role] ?? staff.role)} · ${esc(staff.id)}</span>
<button id="sound" type="button" class="btn sm hide">Звук</button>
<form method="post" action="/lite/logout" class="inline" accept-charset="utf-8">${csrfField(csrf)}<button type="submit" class="btn sm">Выйти</button></form></div></div>
<div class="nav">${link("shift", "/lite/shift", `Смена${input.newCount ? `<span class="badge">${input.newCount}</span>` : ""}`)}${link("orders", "/lite/orders", "Заказы")}${link("hall", "/lite/hall", "Зал")}${link("bookings", "/lite/bookings", "Брони")}${link("whatsapp", "/lite/whatsapp", `WhatsApp${input.waitingCount ? `<span class="badge">${input.waitingCount}</span>` : ""}`)}${staff.role !== "viewer" ? link("new", "/lite/new", "+ Заказ", " add") : ""}</div>`
    : "";
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="format-detection" content="telephone=no">
<title>${esc(input.title)} · XOXO</title>
${input.live ? '<noscript><meta http-equiv="refresh" content="20"></noscript>' : ""}
<style>${LITE_CSS}</style>
</head>
<body>
${header}
${staff ? '<div id="alarm" class="alarm hide" role="alert"><button id="alarm-ok" type="button" class="btn">Принято</button><a href="/lite/shift?f=new"><b id="alarm-title">НОВЫЙ ЗАКАЗ</b> <span id="alarm-text"></span><span id="alarm-tap" class="tap hide">Нажмите сюда, чтобы включился звук</span></a></div>' : ""}
<div class="wrap">${input.body}</div>
<div class="foot">Облегчённая версия для планшетов · <a href="/?full=1">Полная версия</a></div>
${staff ? '<audio id="bell" src="/lite/bell.wav" preload="auto"></audio><audio id="beep" src="/lite/beep.wav" preload="auto"></audio><audio id="chime" src="/lite/chime.wav" preload="auto"></audio>' : ""}
<script>${LITE_JS}</script>
</body>
</html>`;
}
