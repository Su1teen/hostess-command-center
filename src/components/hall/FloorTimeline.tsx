import type { FloorEvent, FloorResource } from "../../lib/floor-operations";
import { formatDateTimeAlmaty, formatTimeAlmaty } from "../../lib/formatters/time";
import { intervalPosition, timelineLanes } from "../../lib/hall/operations";
import { FLOOR_STATE_LABEL } from "../../lib/hall/presentation";

const EVENT_STYLE: Record<FloorEvent["source"], string> = {
  reservation: "border-blue-200 bg-blue-100 text-blue-950",
  session: "border-amber-200 bg-amber-100 text-amber-950",
  hold: "border-slate-300 bg-slate-200 text-slate-700",
};
export function FloorTimeline({
  resources,
  startsAt,
  endsAt,
  now,
  onEvent,
  onSelect,
}: {
  resources: FloorResource[];
  startsAt: string;
  endsAt: string;
  now: string;
  onEvent: (resource: FloorResource, event: FloorEvent) => void;
  onSelect: (id: string) => void;
}) {
  const nowPosition = intervalPosition(
    { id: "now", startsAt: now, endsAt: new Date(Date.parse(now) + 1000).toISOString() },
    startsAt,
    endsAt,
  );
  return (
    <section
      className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white"
      aria-label="Расписание операционного дня"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-4">
        <div>
          <h2 className="font-semibold">Расписание столов</h2>
          <p className="mt-1 text-xs text-slate-500">
            {formatDateTimeAlmaty(startsAt)} — {formatDateTimeAlmaty(endsAt)} · Asia/Almaty
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-slate-600">
          <span>▰ Бронь</span>
          <span className="text-amber-800">▰ Визит / QR</span>
          <span>▰ Удержание</span>
        </div>
      </div>
      <div
        className="overflow-x-auto overscroll-x-contain"
        tabIndex={0}
        role="region"
        aria-label="Прокрутка расписания по времени"
      >
        <div className="min-w-[950px]">
          <div className="flex h-11 border-b text-xs text-slate-500">
            <div className="sticky left-0 z-20 w-36 shrink-0 border-r bg-white px-4 py-3">Стол</div>
            <div className="relative mr-7 flex-1">
              {Array.from({ length: 12 }, (_, hour) => (
                <span
                  key={hour}
                  className="absolute top-3 -translate-x-1/2 tabular-nums"
                  style={{ left: `${(hour / 11) * 100}%` }}
                >
                  {String((17 + hour) % 24).padStart(2, "0")}:00
                </span>
              ))}
            </div>
          </div>
          {resources.map((resource) => {
            const lanes = timelineLanes(resource.events, endsAt),
              count = Math.max(1, ...lanes.map(({ lane }) => lane + 1));
            return (
              <div
                key={resource.id}
                className="flex border-b last:border-0"
                style={{ minHeight: count * 48 + 16 }}
              >
                <button
                  type="button"
                  onClick={() => onSelect(resource.id)}
                  className="sticky left-0 z-20 w-36 shrink-0 border-r bg-white px-4 py-3 text-left hover:bg-slate-50"
                >
                  <span className="block text-sm font-semibold">{resource.name}</span>
                  <span className="mt-1 block text-[10px] text-slate-500">
                    {FLOOR_STATE_LABEL[resource.state]}
                  </span>
                </button>
                <div
                  className="relative mr-7 flex-1"
                  style={{
                    backgroundImage:
                      "repeating-linear-gradient(to right, transparent 0, transparent calc(4.54545% - 1px), #eef2f6 calc(4.54545% - 1px), #eef2f6 4.54545%), repeating-linear-gradient(to right, transparent 0, transparent calc(9.0909% - 1px), #d8e0e9 calc(9.0909% - 1px), #d8e0e9 9.0909%)",
                  }}
                >
                  {nowPosition && (
                    <div
                      className="pointer-events-none absolute inset-y-0 z-10 w-px bg-rose-500"
                      style={{ left: `${nowPosition.left}%` }}
                      aria-label="Текущее время"
                    />
                  )}
                  {lanes.map(({ event, lane }) => {
                    const position = intervalPosition(event, startsAt, endsAt);
                    if (!position) return null;
                    return (
                      <button
                        type="button"
                        key={`${event.source}:${event.id}`}
                        onClick={() => onEvent(resource, event)}
                        title={`${event.label} · ${formatTimeAlmaty(event.startsAt)}–${formatTimeAlmaty(event.endsAt)} · ${event.source} ${event.id}`}
                        aria-label={`${resource.name}: ${event.label}, ${formatTimeAlmaty(event.startsAt)}–${formatTimeAlmaty(event.endsAt)}`}
                        className={`absolute h-11 min-w-1 overflow-hidden rounded-md border px-2 text-left text-[11px] hover:brightness-95 focus:z-30 focus:outline-2 focus:outline-slate-900 ${EVENT_STYLE[event.source]} ${event.status === "cancelled" || event.status === "no_show" ? "opacity-50 line-through" : ""}`}
                        style={{
                          top: 8 + lane * 48,
                          left: `${position.left}%`,
                          width: `${position.width}%`,
                        }}
                      >
                        <span className="block truncate font-medium">{event.label}</span>
                        <span className="block truncate text-[9px]">
                          {formatTimeAlmaty(event.startsAt)}–{formatTimeAlmaty(event.endsAt)}
                        </span>
                      </button>
                    );
                  })}
                  {!lanes.length && <p className="px-3 py-5 text-xs text-slate-400">Нет событий</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {!resources.length && (
        <p className="p-6 text-center text-sm text-slate-500">В выбранной зоне нет столов.</p>
      )}
    </section>
  );
}
