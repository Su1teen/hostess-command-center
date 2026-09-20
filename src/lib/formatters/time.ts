import { VENUE_TIMEZONE } from "../constants";

/** Asia/Almaty has no DST and is fixed at UTC+5. */
export const VENUE_UTC_OFFSET = "+05:00";

export function formatTimeAlmaty(value: string | Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: VENUE_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function formatDateTimeAlmaty(value: string | Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: VENUE_TIMEZONE,
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function formatTimeRangeAlmaty(start: string | Date, end: string | Date | null): string {
  return end ? `${formatTimeAlmaty(start)} – ${formatTimeAlmaty(end)}` : formatTimeAlmaty(start);
}

/** Calendar date (YYYY-MM-DD) of an instant in the venue timezone. */
export function almatyDateKey(value: string | Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: VENUE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Wall-clock time (HH:mm) of an instant in the venue timezone. */
export function almatyTimeKey(value: string | Date = new Date()): string {
  return formatTimeAlmaty(value);
}

/** Combines a venue-local date (YYYY-MM-DD) and time (HH:mm) into an ISO instant. */
export function almatyToIso(date: string, time: string): string {
  return new Date(`${date}T${time}:00${VENUE_UTC_OFFSET}`).toISOString();
}

export function addDaysToDateKey(date: string, days: number): string {
  const base = new Date(`${date}T12:00:00${VENUE_UTC_OFFSET}`);
  base.setUTCDate(base.getUTCDate() + days);
  return almatyDateKey(base);
}

export function addMinutesIso(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

const WEEKDAY_SHORT = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

/** "Сегодня" / "Завтра" / "Пн, 21 сент." */
export function formatDateKeyHuman(date: string, today = almatyDateKey()): string {
  if (date === today) return "Сегодня";
  if (date === addDaysToDateKey(today, 1)) return "Завтра";
  const instant = new Date(`${date}T12:00:00${VENUE_UTC_OFFSET}`);
  const weekday = WEEKDAY_SHORT[instant.getUTCDay()];
  const dayMonth = new Intl.DateTimeFormat("ru-RU", {
    timeZone: VENUE_TIMEZONE,
    day: "numeric",
    month: "short",
  }).format(instant);
  return `${weekday}, ${dayMonth}`;
}

/** "20 сент." */
export function formatDateKeyShort(date: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: VENUE_TIMEZONE,
    day: "numeric",
    month: "short",
  }).format(new Date(`${date}T12:00:00${VENUE_UTC_OFFSET}`));
}
