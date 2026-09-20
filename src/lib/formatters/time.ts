import { VENUE_TIMEZONE } from "../constants";

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
