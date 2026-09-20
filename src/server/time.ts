import { VENUE_TIMEZONE } from "../lib/constants";

export function almatyDayRange(now = new Date()): { start: Date; end: Date; dateLabel: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: VENUE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const date = `${values.year}-${values.month}-${values.day}`;
  const start = new Date(`${date}T00:00:00+05:00`);
  return {
    start,
    end: new Date(start.getTime() + 86_400_000),
    dateLabel: new Intl.DateTimeFormat("ru-RU", {
      timeZone: VENUE_TIMEZONE,
      day: "numeric",
      month: "long",
    }).format(now),
  };
}
