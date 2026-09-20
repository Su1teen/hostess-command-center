import { useMemo } from "react";
import { addDaysToDateKey, almatyDateKey, formatDateKeyHuman } from "../../lib/formatters/time";
import { WheelColumn, type WheelOption } from "./WheelPicker";

export const MINUTE_STEP = 15;
const DAYS_AHEAD = 30;

export function dateOptions(today = almatyDateKey(), days = DAYS_AHEAD): WheelOption[] {
  return Array.from({ length: days }, (_, index) => {
    const value = addDaysToDateKey(today, index);
    return { value, label: formatDateKeyHuman(value, today) };
  });
}

const HOURS: WheelOption[] = Array.from({ length: 24 }, (_, hour) => {
  const value = String(hour).padStart(2, "0");
  return { value, label: value };
});
const MINUTES: WheelOption[] = Array.from({ length: 60 / MINUTE_STEP }, (_, index) => {
  const value = String(index * MINUTE_STEP).padStart(2, "0");
  return { value, label: value };
});

/** Rounds "HH:mm" up to the nearest MINUTE_STEP. */
export function roundTimeUp(time: string, step = MINUTE_STEP): string {
  const [h, m] = time.split(":").map(Number);
  const total = Math.ceil((h * 60 + m) / step) * step;
  const hh = Math.floor(total / 60) % 24;
  return `${String(hh).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function DateTimeWheel({
  date,
  time,
  onChange,
}: {
  date: string;
  time: string;
  onChange: (next: { date: string; time: string }) => void;
}) {
  const dates = useMemo(() => dateOptions(), []);
  const [hour, minute] = time.split(":");
  return (
    <div className="rounded-3xl bg-white p-2 shadow-sm">
      <div className="grid grid-cols-[1.6fr_auto_auto_auto] items-center">
        <WheelColumn options={dates} value={date} onChange={(d) => onChange({ date: d, time })} />
        <WheelColumn
          options={HOURS}
          value={hour}
          className="w-16"
          onChange={(h) => onChange({ date, time: `${h}:${minute}` })}
        />
        <span className="pb-1 text-2xl font-semibold text-slate-400">:</span>
        <WheelColumn
          options={MINUTES}
          value={minute}
          className="w-16"
          onChange={(m) => onChange({ date, time: `${hour}:${m}` })}
        />
      </div>
    </div>
  );
}
