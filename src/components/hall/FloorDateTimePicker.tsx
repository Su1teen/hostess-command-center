import { useEffect, useMemo, useRef, useState } from "react";
import { addDaysToDateKey, almatyDateKey } from "../../lib/formatters/time";

const ROW = 44;
const pad = (value: number) => String(value).padStart(2, "0");

/** Native scrolling preserves touch momentum; values commit only when the wheel settles. */
export function TimeWheel({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef({ value, onChange, options });
  latest.current = { value, onChange, options };
  const selected = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  useEffect(() => {
    clearTimeout(timer.current);
    ref.current?.scrollTo({ top: selected * ROW, behavior: "instant" });
    return () => clearTimeout(timer.current);
  }, [selected]);
  function choose(index: number) {
    const next = Math.max(0, Math.min(options.length - 1, index));
    ref.current?.scrollTo({ top: next * ROW, behavior: "smooth" });
    onChange(options[next].value);
  }
  return (
    <div className="min-w-0 flex-1 first:flex-[2.5]">
      <p className="mb-1 text-center text-[10px] font-medium uppercase tracking-wider text-slate-400">
        {label}
      </p>
      <div className="relative h-[220px] overflow-hidden rounded-xl">
        <div className="pointer-events-none absolute inset-x-0 top-[88px] h-11 rounded-xl bg-slate-100" />
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[74px] bg-gradient-to-b from-white to-white/0" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[74px] bg-gradient-to-t from-white to-white/0" />
        <div
          ref={ref}
          role="spinbutton"
          tabIndex={0}
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={options.length - 1}
          aria-valuenow={selected}
          aria-valuetext={options[selected]?.label}
          className="relative h-full snap-y snap-mandatory overflow-y-auto overscroll-contain rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-800 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{ paddingBlock: ROW * 2, perspective: 500 }}
          onKeyDown={(event) => {
            const delta = { ArrowDown: 1, ArrowUp: -1, PageDown: 5, PageUp: -5 }[event.key];
            if (delta !== undefined || event.key === "Home" || event.key === "End") {
              event.preventDefault();
              choose(
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? options.length - 1
                    : selected + (delta ?? 0),
              );
            }
          }}
          onScroll={(event) => {
            const element = event.currentTarget;
            const center = element.scrollTop / ROW;
            element.querySelectorAll<HTMLElement>("[data-wheel-row]").forEach((row) => {
              const distance = Number(row.dataset.wheelRow) - center;
              if (Math.abs(distance) > 4) return;
              row.style.transform = `rotateX(${Math.max(-55, Math.min(55, distance * -18))}deg) scale(${1 - Math.min(0.18, Math.abs(distance) * 0.06)})`;
            });
            clearTimeout(timer.current);
            timer.current = setTimeout(() => {
              const index = Math.max(
                0,
                Math.min(latest.current.options.length - 1, Math.round(element.scrollTop / ROW)),
              );
              const next = latest.current.options[index].value;
              if (next !== latest.current.value) latest.current.onChange(next);
            }, 140);
          }}
        >
          {options.map((option, index) => (
            <button
              type="button"
              key={option.value}
              tabIndex={-1}
              aria-hidden="true"
              data-wheel-row={index}
              onClick={() => choose(index)}
              className={`flex h-11 w-full snap-center items-center justify-center whitespace-nowrap text-[17px] tabular-nums ${index === selected ? "font-semibold text-slate-900" : "text-slate-500"}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function FloorDateTimePicker({
  date,
  time,
  onChange,
  dateOnly = false,
}: {
  date: string;
  time: string;
  onChange: (value: { date?: string; time?: string }) => void;
  dateOnly?: boolean;
}) {
  const today = almatyDateKey();
  const [anchor, setAnchor] = useState(date);
  if (date < addDaysToDateKey(anchor, -365) || date > addDaysToDateKey(anchor, 731))
    setAnchor(date);
  const dates = useMemo(
    () =>
      Array.from({ length: 1097 }, (_, index) => {
        const value = addDaysToDateKey(anchor, index - 365);
        const day = new Date(`${value}T12:00:00Z`).toLocaleDateString("ru-RU", {
          weekday: "short",
          day: "numeric",
          month: "short",
          timeZone: "UTC",
        });
        return { value, label: value === today ? "Сегодня" : day };
      }),
    [anchor, today],
  );
  const hours = useMemo(
    () => Array.from({ length: 24 }, (_, i) => ({ value: pad(i), label: pad(i) })),
    [],
  );
  const minutes = useMemo(
    () => Array.from({ length: 60 }, (_, i) => ({ value: pad(i), label: pad(i) })),
    [],
  );
  const [hour, minute] = time.split(":");
  return (
    <div className="w-full" aria-label="Выбор даты и времени">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2">
        <p className="text-sm font-semibold tabular-nums" aria-live="polite">
          {new Date(`${date}T12:00:00Z`).toLocaleDateString("ru-RU", {
            day: "numeric",
            month: "long",
            year: "numeric",
            timeZone: "UTC",
          })}
          {!dateOnly && ` · ${time}`}
        </p>
        <label className="relative cursor-pointer text-xs text-slate-500">
          Календарь
          <input
            type="date"
            aria-label="Дата карты"
            value={date}
            onChange={(e) => {
              if (e.target.value) onChange({ date: e.target.value });
            }}
            className="absolute inset-0 w-full cursor-pointer opacity-0"
          />
        </label>
      </div>
      <div className="flex gap-1 pt-3">
        <TimeWheel
          label={dateOnly ? "Операционный день" : "Дата"}
          options={dates}
          value={date}
          onChange={(value) => onChange({ date: value })}
        />
        {!dateOnly && (
          <>
            <TimeWheel
              label="Часы"
              options={hours}
              value={hour}
              onChange={(value) => onChange({ time: `${value}:${minute}` })}
            />
            <span
              className="self-center pb-0.5 text-xl font-semibold text-slate-400"
              aria-hidden="true"
            >
              :
            </span>
            <TimeWheel
              label="Минуты"
              options={minutes}
              value={minute}
              onChange={(value) => onChange({ time: `${hour}:${value}` })}
            />
          </>
        )}
      </div>
    </div>
  );
}
