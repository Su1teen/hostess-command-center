import { VENUE_TIMEZONE } from "../lib/constants";
import { almatyDateKey, VENUE_UTC_OFFSET } from "../lib/formatters/time";

export function almatyDayRange(date?: string): {
  date: string;
  start: Date;
  end: Date;
  dateLabel: string;
} {
  const key = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : almatyDateKey();
  const start = new Date(`${key}T00:00:00${VENUE_UTC_OFFSET}`);
  return {
    date: key,
    start,
    end: new Date(start.getTime() + 86_400_000),
    dateLabel: new Intl.DateTimeFormat("ru-RU", {
      timeZone: VENUE_TIMEZONE,
      day: "numeric",
      month: "long",
    }).format(new Date(start.getTime() + 43_200_000)),
  };
}
