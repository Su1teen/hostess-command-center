import { useEffect, useMemo, useRef } from "react";
import { CalendarDays } from "lucide-react";
import {
  addDaysToDateKey,
  almatyDateKey,
  formatDateKeyHuman,
  formatDateKeyShort,
} from "../../lib/formatters/time";

const DAYS = 7;

/** 12:00 … 23:30 in 30-minute steps. */
export const HALL_TIME_SLOTS = Array.from({ length: 24 }, (_, index) => {
  const hour = 12 + Math.floor(index / 2);
  return `${String(hour).padStart(2, "0")}:${index % 2 ? "30" : "00"}`;
});

export function DateTimeSelector({
  date,
  time,
  onDate,
  onTime,
}: {
  date: string;
  time: string;
  onDate: (date: string) => void;
  onTime: (time: string) => void;
}) {
  const today = almatyDateKey();
  const dates = useMemo(
    () => Array.from({ length: DAYS }, (_, index) => addDaysToDateKey(today, index)),
    [today],
  );
  const timeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = timeRef.current?.querySelector<HTMLButtonElement>(`[data-time="${time}"]`);
    el?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [time]);

  const slots = HALL_TIME_SLOTS.includes(time)
    ? HALL_TIME_SLOTS
    : [...HALL_TIME_SLOTS, time].sort();

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <CalendarDays size={16} className="shrink-0 text-slate-400" />
        <p className="text-sm font-semibold">
          {formatDateKeyHuman(date, today)}
          {(date === today || date === addDaysToDateKey(today, 1)) && (
            <span className="font-normal text-slate-500">, {formatDateKeyShort(date)}</span>
          )}
          <span className="text-slate-400"> · {time}</span>
        </p>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-0.5" style={{ scrollbarWidth: "none" }}>
        {dates.map((value) => (
          <button
            type="button"
            key={value}
            onClick={() => onDate(value)}
            className={`shrink-0 rounded-full px-3.5 py-2 text-xs font-semibold transition-colors ${
              value === date ? "bg-slate-900 text-white" : "bg-white text-slate-600"
            }`}
          >
            {formatDateKeyHuman(value, today)}
          </button>
        ))}
      </div>
      <div
        ref={timeRef}
        className="flex gap-2 overflow-x-auto pb-1"
        style={{ scrollbarWidth: "none" }}
      >
        {slots.map((slot) => (
          <button
            type="button"
            key={slot}
            data-time={slot}
            onClick={() => onTime(slot)}
            className={`shrink-0 rounded-full px-3.5 py-2 text-sm font-semibold tabular-nums transition-colors ${
              slot === time ? "bg-[#C9A96E] text-white" : "bg-white text-slate-600"
            }`}
          >
            {slot}
          </button>
        ))}
      </div>
    </div>
  );
}
