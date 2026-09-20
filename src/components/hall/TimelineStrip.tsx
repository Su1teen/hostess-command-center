import { TIME_SLOTS } from "./mock";

export function TimelineStrip({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
      {TIME_SLOTS.map((slot) => (
        <button
          key={slot}
          onClick={() => onChange(slot)}
          className={`shrink-0 rounded-full px-3 py-2 text-xs font-medium ${value === slot ? "bg-slate-900 text-white" : "bg-white text-slate-500 border border-slate-200"}`}
        >
          {slot}
        </button>
      ))}
    </div>
  );
}
