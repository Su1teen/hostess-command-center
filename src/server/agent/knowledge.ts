import { z } from "zod";
import type { PoolClient } from "pg";
import { pool } from "../db/pool";
import { ApiError } from "../guest/security";

type Queryable = Pick<PoolClient, "query">;

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeKey = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const weekdayNames = [
  "",
  "понедельник",
  "вторник",
  "среда",
  "четверг",
  "пятница",
  "суббота",
  "воскресенье",
];
const weekdayShort = ["", "пн", "вт", "ср", "чт", "пт", "сб", "вс"];

export const eventSchema = z
  .object({
    date: dateKey,
    time: timeKey.nullable().optional(),
    title: z.string().trim().min(1).max(200),
    details: z.string().trim().max(4000).default(""),
  })
  .strict();
export const promotionSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    details: z.string().trim().max(4000).default(""),
    active: z.boolean().default(true),
    startsOn: dateKey.nullable().optional(),
    endsOn: dateKey.nullable().optional(),
    weekdays: z.array(z.number().int().min(1).max(7)).max(7).nullable().optional(),
  })
  .strict()
  .refine(
    (v) => !v.startsOn || !v.endsOn || v.endsOn >= v.startsOn,
    "Дата окончания раньше начала",
  );

/** Local calendar date in Astana for an instant. */
export function astanaDate(at = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty" }).format(at);
}
export function astanaClock(at = new Date()) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Almaty",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);
}
/** ISO weekday (1=Mon) of a YYYY-MM-DD key; date keys are calendar dates, so UTC is exact. */
export function isoWeekday(key: string) {
  const day = new Date(`${key}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}
export function addDays(key: string, days: number) {
  return new Date(Date.parse(`${key}T00:00:00Z`) + days * 86400_000).toISOString().slice(0, 10);
}

const eventFields = `id,to_char(event_date,'YYYY-MM-DD') AS date,event_time AS time,title,details,
  created_by AS "createdBy",updated_at AS "updatedAt"`;
const promotionFields = `id,title,details,active,to_char(starts_on,'YYYY-MM-DD') AS "startsOn",
  to_char(ends_on,'YYYY-MM-DD') AS "endsOn",weekdays,created_by AS "createdBy",updated_at AS "updatedAt"`;

export async function listEvents(from: string, to: string, db: Queryable = pool) {
  dateKey.parse(from);
  dateKey.parse(to);
  return (
    await db.query(
      `SELECT ${eventFields} FROM venue_events WHERE venue_code='xoxo' AND event_date BETWEEN $1 AND $2
       ORDER BY event_date,event_time NULLS FIRST,created_at`,
      [from, to],
    )
  ).rows;
}
export async function saveEvent(staffId: string, raw: unknown, id?: string) {
  const input = eventSchema.parse(raw);
  const values = [input.date, input.time ?? null, input.title, input.details, staffId];
  const row = id
    ? (
        await pool.query(
          `UPDATE venue_events SET event_date=$1,event_time=$2,title=$3,details=$4,created_by=$5,updated_at=now()
           WHERE id=$6 AND venue_code='xoxo' RETURNING ${eventFields}`,
          [...values, id],
        )
      ).rows[0]
    : (
        await pool.query(
          `INSERT INTO venue_events(event_date,event_time,title,details,created_by) VALUES($1,$2,$3,$4,$5)
           RETURNING ${eventFields}`,
          values,
        )
      ).rows[0];
  if (!row) throw new ApiError(404, "NOT_FOUND", "Событие не найдено");
  return row;
}
export async function deleteEvent(id: string) {
  await pool.query("DELETE FROM venue_events WHERE id=$1 AND venue_code='xoxo'", [id]);
}

export async function listPromotions(db: Queryable = pool) {
  return (
    await db.query(
      `SELECT ${promotionFields} FROM venue_promotions WHERE venue_code='xoxo'
       ORDER BY active DESC,updated_at DESC`,
    )
  ).rows;
}
export async function savePromotion(staffId: string, raw: unknown, id?: string) {
  const input = promotionSchema.parse(raw);
  const weekdays = input.weekdays?.length ? [...new Set(input.weekdays)].sort() : null;
  const values = [
    input.title,
    input.details,
    input.active,
    input.startsOn ?? null,
    input.endsOn ?? null,
    weekdays,
    staffId,
  ];
  const row = id
    ? (
        await pool.query(
          `UPDATE venue_promotions SET title=$1,details=$2,active=$3,starts_on=$4,ends_on=$5,weekdays=$6,
           created_by=$7,updated_at=now() WHERE id=$8 AND venue_code='xoxo' RETURNING ${promotionFields}`,
          [...values, id],
        )
      ).rows[0]
    : (
        await pool.query(
          `INSERT INTO venue_promotions(title,details,active,starts_on,ends_on,weekdays,created_by)
           VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING ${promotionFields}`,
          values,
        )
      ).rows[0];
  if (!row) throw new ApiError(404, "NOT_FOUND", "Акция не найдена");
  return row;
}
export async function deletePromotion(id: string) {
  await pool.query("DELETE FROM venue_promotions WHERE id=$1 AND venue_code='xoxo'", [id]);
}

function promotionSchedule(p: {
  startsOn: string | null;
  endsOn: string | null;
  weekdays: number[] | null;
}) {
  const parts: string[] = [];
  if (p.weekdays?.length) parts.push(p.weekdays.map((d) => weekdayShort[d]).join(", "));
  if (p.startsOn && p.endsOn) parts.push(`с ${p.startsOn} по ${p.endsOn}`);
  else if (p.startsOn) parts.push(`с ${p.startsOn}`);
  else if (p.endsOn) parts.push(`до ${p.endsOn}`);
  return parts.join("; ") || "постоянно";
}
function promotionApplies(
  p: { startsOn: string | null; endsOn: string | null; weekdays: number[] | null },
  day: string,
) {
  return (
    (!p.startsOn || p.startsOn <= day) &&
    (!p.endsOn || p.endsOn >= day) &&
    (!p.weekdays?.length || p.weekdays.includes(isoWeekday(day)))
  );
}

/** Compact, prompt-ready knowledge for the WhatsApp agent: what is on and what is offered. */
export async function agentKnowledge(days = 14, db: Queryable = pool) {
  const now = new Date();
  const today = astanaDate(now);
  const until = addDays(today, days);
  const [events, promotions, zones] = await Promise.all([
    listEvents(today, until, db),
    listPromotions(db),
    // Only zones with bookable places, so the agent never offers a zone it cannot seat.
    db.query(
      `SELECT z.code,z.name,z.zone_type AS "zoneType",
         json_agg(json_build_object('name',r.name,'capacity',r.capacity) ORDER BY r.code) AS places
       FROM venue_zones z JOIN venue_resources r ON r.zone_id=z.id AND r.is_reservable AND r.status='active'
       WHERE z.venue_code='xoxo' AND z.is_active AND z.code<>'qr_unassigned'
       GROUP BY z.id ORDER BY z.display_order`,
    ),
  ]);
  return {
    today,
    nowLocal: `${today} ${astanaClock(now)}`,
    weekday: weekdayNames[isoWeekday(today)],
    events: events.map((e) => {
      // Calendar dates are real dates; a 01:00 match belongs to the previous evening's booking day.
      const night = Boolean(e.time && e.time < "05:00");
      return {
        date: e.date,
        weekday: weekdayNames[isoWeekday(e.date)],
        time: e.time,
        title: e.title,
        details: e.details,
        bookingDate: night ? addDays(e.date, -1) : e.date,
        night,
      };
    }),
    promotions: promotions
      .filter((p) => p.active && (!p.endsOn || p.endsOn >= today))
      .map((p) => ({
        title: p.title,
        details: p.details,
        schedule: promotionSchedule(p),
        appliesToday: promotionApplies(p, today),
      })),
    zones: zones.rows.map(zoneSummary),
  };
}

type ZoneRow = {
  code: string;
  name: string;
  zoneType: string;
  places: { name: string; capacity: number | null }[];
};
/** «VIP-комнаты: 3 отдельные комнаты — VIP 01 до 6, VIP 02 до 9, VIP 03 до 4 гостей». */
export function zoneSummary(zone: ZoneRow) {
  const count = zone.places.length;
  const noun =
    zone.zoneType === "vip"
      ? plural(count, "отдельная комната", "отдельные комнаты", "отдельных комнат")
      : zone.code === "ps"
        ? plural(count, "место с PlayStation", "места с PlayStation", "мест с PlayStation")
        : plural(count, "стол", "стола", "столов");
  const capacities = new Set(zone.places.map((p) => p.capacity));
  const detail =
    capacities.size === 1
      ? [...capacities][0]
        ? `, до ${[...capacities][0]} гостей за каждым`
        : ""
      : ` — ${zone.places.map((p) => (p.capacity ? `${p.name} до ${p.capacity}` : p.name)).join(", ")} гостей`;
  return {
    code: zone.code,
    name: zone.name,
    places: count,
    summary: `${zone.name}: ${count} ${noun}${detail}`,
  };
}
function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10,
    mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
