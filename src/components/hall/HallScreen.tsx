import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  AlertCircle,
  ArrowLeft,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  LayoutGrid,
  List,
  MapPin,
  Pencil,
  RefreshCw,
} from "lucide-react";
import { staffApi, useStaffRole, controlClass } from "../../lib/dine-in-client";
import type { FloorEvent, FloorResource, FloorSnapshot } from "../../lib/floor-operations";
import {
  addMinutesIso,
  almatyDateKey,
  almatyTimeKey,
  almatyToIso,
  formatDateTimeAlmaty,
} from "../../lib/formatters/time";
import { operationalDate } from "../../lib/hall/operations";
import { FloorPlan } from "./FloorPlan";
import { FLOOR_STATE_LABEL, FLOOR_STATE_STYLE } from "../../lib/hall/presentation";
import { FloorTimeline } from "./FloorTimeline";
import { FloorTableDrawer } from "./FloorTableDrawer";
import { FloorBooking } from "./FloorBooking";
import { FloorLayoutEditor } from "./FloorLayoutEditor";

type ViewState = {
  mode: "now" | "at" | "day";
  zone: string;
  date: string;
  time: string;
  view: "map" | "list";
  duration: number;
};
const STORAGE = "xoxo-floor-operations-v2";
export function HallScreen({ openReservations = false }: { openReservations?: boolean }) {
  const [clock, setClock] = useState(() => new Date().toISOString());
  const [filters, setFilters] = useState<ViewState>({
    mode: openReservations ? "day" : "now",
    zone: "all",
    date: openReservations ? operationalDate() : almatyDateKey(),
    time: almatyTimeKey(),
    view: "map",
    duration: 120,
  });
  const [ready, setReady] = useState(false),
    [selectedId, setSelected] = useState<string | null>(null),
    [event, setEvent] = useState<FloorEvent | null>(null);
  const [booking, setBooking] = useState<FloorResource | null>(null),
    [editing, setEditing] = useState(false);
  const role = useStaffRole(),
    canWrite = role === "manager" || role === "operator",
    canManage = role === "manager";
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE) ?? "null");
      if (
        saved &&
        ["now", "at", "day"].includes(saved.mode) &&
        typeof saved.zone === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(saved.date) &&
        /^\d{2}:\d{2}$/.test(saved.time) &&
        ["map", "list"].includes(saved.view)
      ) {
        setFilters({
          ...saved,
          duration: [60, 90, 120, 180, 240].includes(saved.duration) ? saved.duration : 120,
          ...(openReservations ? { mode: "day", date: operationalDate() } : {}),
        });
      }
    } catch {
      /* A restricted browser can still use every floor operation. */
    }
    setReady(true);
    const interval = window.setInterval(() => setClock(new Date().toISOString()), 15_000);
    return () => window.clearInterval(interval);
  }, [openReservations]);
  useEffect(() => {
    if (ready) {
      try {
        localStorage.setItem(STORAGE, JSON.stringify(filters));
      } catch {
        /* Persistence is optional. */
      }
    }
  }, [filters, ready]);
  const at =
    filters.mode === "now"
      ? clock
      : almatyToIso(filters.date, filters.mode === "day" ? "17:00" : filters.time);
  const date = filters.mode === "day" ? filters.date : operationalDate(at);
  const endsAt = addMinutesIso(at, filters.duration);
  const query = useQuery({
    queryKey: ["floor", date, filters.mode === "now" ? "live" : at, filters.duration],
    enabled: ready,
    refetchInterval: filters.mode === "now" ? 15_000 : false,
    queryFn: ({ signal }) =>
      staffApi<FloorSnapshot>(`/floor?${new URLSearchParams({ date, at, endsAt })}`, { signal }),
    staleTime: 10_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: 1,
  });
  const data = query.data,
    zones = data?.zones ?? [],
    zone = zones.find((item) => item.id === filters.zone);
  const resources = zone ? zone.resources : zones.flatMap((item) => item.resources);
  const selected = resources.find((item) => item.id === selectedId);
  const setFilter = (update: Partial<ViewState>) => {
    setFilters((previous) => ({ ...previous, ...update }));
    setEditing(false);
    setEvent(null);
  };
  function now() {
    const instant = new Date().toISOString();
    setClock(instant);
    setFilter({ mode: "now", date: almatyDateKey(instant), time: almatyTimeKey(instant) });
  }
  function step(minutes: number) {
    const next = addMinutesIso(at, minutes);
    setFilter({ mode: "at", date: almatyDateKey(next), time: almatyTimeKey(next) });
  }
  function select(id: string, nextEvent: FloorEvent | null = null) {
    setSelected(id);
    setEvent(nextEvent);
  }
  const attention = resources.reduce(
    (count, item) =>
      count + Number(item.warnings.length > 0 || ["overdue", "unconfigured"].includes(item.state)),
    0,
  );
  return (
    <main className="min-w-0 space-y-5 px-3 py-5 sm:px-6" aria-label="Карта зала">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[.16em] text-slate-500">
            <MapPin size={12} />
            XOXO · операции зала
          </p>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-tight sm:text-3xl">Карта зала</h1>
          <p className="mt-1 text-xs text-slate-500">Посадки, брони и заказы · Asia/Almaty</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/tables/qr" className={`${controlClass} inline-flex items-center`}>
            Столы и QR
          </Link>
          <button
            type="button"
            onClick={() => {
              setClock(new Date().toISOString());
              void query.refetch();
            }}
            className={`${controlClass} inline-flex items-center gap-2`}
            aria-label="Обновить карту"
          >
            <RefreshCw size={14} className={query.isFetching ? "animate-spin" : ""} />
            <span className="hidden sm:inline">Обновить</span>
          </button>
        </div>
      </header>
      <section
        className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3 sm:p-4"
        aria-label="Фильтры карты"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            className="flex max-w-full gap-1 rounded-xl bg-slate-100 p-1"
            role="group"
            aria-label="Режим времени"
          >
            {(
              [
                ["now", "Сейчас", Clock3],
                ["at", "На время", CalendarDays],
                ["day", "Весь день", LayoutGrid],
              ] as const
            ).map(([mode, label, Icon]) => (
              <button
                key={mode}
                type="button"
                aria-pressed={filters.mode === mode}
                onClick={() => {
                  if (mode === "now") now();
                  else
                    setFilter({
                      mode,
                      date: mode === "day" ? operationalDate(at) : almatyDateKey(at),
                      time: almatyTimeKey(at),
                    });
                }}
                className={`flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-medium sm:text-sm ${filters.mode === mode ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
              >
                <Icon size={13} />
                {label}
              </button>
            ))}
          </div>
          {filters.mode !== "now" && (
            <button
              type="button"
              onClick={now}
              className="min-h-11 text-xs font-medium text-blue-700"
            >
              Вернуться к сейчас
            </button>
          )}
        </div>
        {filters.mode !== "now" ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-0 text-xs text-slate-500">
              {filters.mode === "day" ? "Операционный день" : "Календарная дата"}
              <input
                type="date"
                aria-label="Дата карты"
                value={filters.date}
                onChange={(e) => {
                  if (e.target.value) setFilter({ date: e.target.value });
                }}
                className={`${controlClass} mt-1 block max-w-full min-w-0`}
              />
            </label>
            {filters.mode === "at" && (
              <>
                <label className="text-xs text-slate-500">
                  Время
                  <input
                    type="time"
                    aria-label="Время карты"
                    value={filters.time}
                    onChange={(e) => {
                      if (e.target.value) setFilter({ time: e.target.value });
                    }}
                    className={`${controlClass} mt-1 block`}
                  />
                </label>
                <div className="flex gap-1">
                  {[-30, -15, 15, 30].map((minutes) => (
                    <button
                      key={minutes}
                      type="button"
                      className={`${controlClass} px-2!`}
                      aria-label={`${minutes > 0 ? "Вперёд" : "Назад"} ${Math.abs(minutes)} минут`}
                      onClick={() => step(minutes)}
                    >
                      {minutes > 0 ? "+" : "−"}
                      {Math.abs(minutes)}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : (
          <p className="text-sm font-medium tabular-nums">{formatDateTimeAlmaty(clock)}</p>
        )}
        {filters.mode !== "day" && (
          <label className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            Доступность на полный интервал
            <select
              aria-label="Интервал доступности"
              value={filters.duration}
              onChange={(e) => setFilter({ duration: Number(e.target.value) })}
              className={`${controlClass} text-xs!`}
            >
              <option value={60}>1 час</option>
              <option value={90}>1,5 часа</option>
              <option value={120}>2 часа</option>
              <option value={180}>3 часа</option>
              <option value={240}>4 часа</option>
            </select>
          </label>
        )}
        {filters.mode === "day" && (
          <p className="text-xs text-slate-500">
            С 17:00 выбранной даты до 04:00 следующей. События соседних вечеров не смешиваются.
          </p>
        )}
      </section>
      <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="Зоны зала">
        <button
          type="button"
          aria-pressed={filters.zone === "all" || !zone}
          className={`min-h-11 shrink-0 rounded-xl px-4 text-sm font-medium ${filters.zone === "all" || !zone ? "bg-slate-900 text-white" : "border bg-white text-slate-600"}`}
          onClick={() => {
            setFilter({ zone: "all" });
            setSelected(null);
          }}
        >
          Все зоны
        </button>
        {zones.map((item) => (
          <button
            type="button"
            key={item.id}
            aria-pressed={filters.zone === item.id}
            onClick={() => {
              setFilter({ zone: item.id });
              setSelected(null);
            }}
            className={`min-h-11 shrink-0 rounded-xl px-4 text-sm font-medium ${filters.zone === item.id ? "bg-slate-900 text-white" : "border bg-white text-slate-600"}`}
          >
            {item.name}
            <span className="ml-2 opacity-60">{item.resources.length}</span>
          </button>
        ))}
      </nav>
      {query.error && (
        <div
          role="alert"
          className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-800"
        >
          <p>{query.error.message}</p>
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="mt-2 min-h-10 underline"
          >
            Повторить загрузку карты
          </button>
        </div>
      )}
      {(query.isPending || !ready) && (
        <div
          role="status"
          className="rounded-2xl border border-dashed bg-white px-5 py-14 text-center text-sm text-slate-500"
        >
          Загружаем реальные столы, брони и визиты…
        </div>
      )}
      {data && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <p>
              {resources.length} QR-точек ·{" "}
              {resources.filter((item) => item.currentSession?.seatedAt).length} с гостями ·{" "}
              {resources.filter((item) => item.available).length} свободно на интервал
              {attention > 0 && (
                <span className="ml-2 inline-flex items-center gap-1 text-amber-800">
                  <AlertCircle size={12} />
                  {attention} требуют внимания
                </span>
              )}
            </p>
            <span>{query.isFetching ? "Обновляем…" : `Данные ${almatyTimeKey(data.now)}`}</span>
          </div>
          {!zone && filters.mode !== "day" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {zones.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => setFilter({ zone: item.id })}
                  className="rounded-2xl border border-slate-200 bg-white p-5 text-left transition-colors hover:border-slate-400"
                >
                  <div className="flex justify-between">
                    <h2 className="font-semibold">{item.name}</h2>
                    <ChevronRight size={16} className="text-slate-400" />
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-x-3 gap-y-4">
                    {(
                      [
                        [item.counts.total, "QR-точек"],
                        [item.counts.seated, "с гостями"],
                        [item.counts.available, "свободно"],
                        [item.counts.reservations, "будущих броней"],
                        [item.counts.activeOrders, "с заказами"],
                        [item.counts.attention, "внимание"],
                      ] as const
                    ).map(([value, label]) => (
                      <div key={label}>
                        <strong className="block text-xl font-semibold tabular-nums">
                          {value}
                        </strong>
                        <span className="text-[10px] text-slate-500">{label}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-1" aria-hidden>
                    {item.resources.map((resource) => (
                      <span
                        key={resource.id}
                        className="rounded-md border px-2 py-1 text-[10px]"
                        style={{
                          background: FLOOR_STATE_STYLE[resource.state].fill,
                          borderColor: FLOOR_STATE_STYLE[resource.state].stroke,
                          color: FLOOR_STATE_STYLE[resource.state].text,
                        }}
                      >
                        {resource.name}
                      </span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          ) : filters.mode === "day" ? (
            <FloorTimeline
              resources={resources}
              startsAt={data.startsAt}
              endsAt={data.endsAt}
              now={clock}
              onSelect={(id) => select(id)}
              onEvent={(resource, next) => select(resource.id, next)}
            />
          ) : (
            zone && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex gap-1" role="group" aria-label="Вид зоны">
                    <button
                      type="button"
                      aria-pressed={filters.view === "map"}
                      className={`${controlClass} inline-flex items-center gap-1.5`}
                      onClick={() => setFilter({ view: "map" })}
                    >
                      <LayoutGrid size={14} />
                      Карта
                    </button>
                    <button
                      type="button"
                      aria-pressed={filters.view === "list"}
                      className={`${controlClass} inline-flex items-center gap-1.5`}
                      onClick={() => setFilter({ view: "list" })}
                    >
                      <List size={14} />
                      Список
                    </button>
                  </div>
                  {canManage && !editing && (
                    <button
                      type="button"
                      className={`${controlClass} inline-flex items-center gap-1.5`}
                      onClick={() => {
                        setSelected(null);
                        setEditing(true);
                      }}
                    >
                      <Pencil size={13} />
                      Редактировать план
                    </button>
                  )}
                </div>
                {editing ? (
                  <FloorLayoutEditor key={zone.id} zone={zone} onDone={() => setEditing(false)} />
                ) : filters.view === "map" ? (
                  <FloorPlan
                    resources={resources}
                    selectedId={selectedId}
                    onSelect={(id) => select(id)}
                  />
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {resources.map((resource) => (
                      <button
                        type="button"
                        key={resource.id}
                        className="rounded-xl border border-slate-200 bg-white p-4 text-left hover:border-slate-400"
                        onClick={() => select(resource.id)}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <strong className="text-sm font-semibold">{resource.name}</strong>
                          <span className="text-xs text-slate-500">
                            {resource.capacity
                              ? `${resource.capacity} мест`
                              : "Вместимость не задана"}
                          </span>
                        </span>
                        <span
                          className="mt-2 block text-xs"
                          style={{ color: FLOOR_STATE_STYLE[resource.state].text }}
                        >
                          {FLOOR_STATE_STYLE[resource.state].mark}{" "}
                          {FLOOR_STATE_LABEL[resource.state]}
                        </span>
                        {resource.currentSession && (
                          <span className="mt-2 block text-xs text-slate-500">
                            {resource.currentSession.activeOrderCount} активных заказов
                          </span>
                        )}
                        {resource.nextReservation && (
                          <span className="mt-1 block text-xs text-slate-500">
                            Следующая бронь: {almatyTimeKey(resource.nextReservation.startsAt)}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )
          )}
          {!zones.length && (
            <p className="rounded-2xl border border-dashed bg-white p-8 text-center text-sm text-slate-500">
              Физические QR-точки пока не настроены. Настройте инвентарь в управлении столами.
            </p>
          )}
          <div
            className="flex flex-wrap gap-x-4 gap-y-2 px-1 text-[10px] text-slate-500"
            aria-label="Обозначения состояний"
          >
            {Object.entries(FLOOR_STATE_LABEL).map(([state, label]) => (
              <span key={state} className="flex items-center gap-1.5">
                <span
                  className="inline-flex h-4 w-4 items-center justify-center rounded border"
                  style={{
                    background: FLOOR_STATE_STYLE[state as keyof typeof FLOOR_STATE_STYLE].fill,
                    borderColor: FLOOR_STATE_STYLE[state as keyof typeof FLOOR_STATE_STYLE].stroke,
                  }}
                >
                  {FLOOR_STATE_STYLE[state as keyof typeof FLOOR_STATE_STYLE].mark}
                </span>
                {label}
              </span>
            ))}
          </div>
          {zone && filters.mode !== "day" && !editing && (
            <button
              type="button"
              className={`${controlClass} flex w-full items-center justify-center gap-2`}
              onClick={() => setFilter({ mode: "day", date: operationalDate(at) })}
            >
              <CalendarDays size={15} />
              Открыть дневной таймлайн
            </button>
          )}
        </>
      )}
      {selected && !booking && !editing && (
        <FloorTableDrawer
          key={`${selected.id}:${event?.id ?? "table"}`}
          resource={selected}
          zoneName={zones.find((item) => item.id === selected.zoneId)?.name ?? "Зона не назначена"}
          at={at}
          now={clock}
          live={filters.mode === "now"}
          canWrite={canWrite}
          canManage={canManage}
          event={event}
          onClose={() => {
            setSelected(null);
            setEvent(null);
          }}
          onBook={() => setBooking(selected)}
          onTimeline={() => {
            setSelected(null);
            setFilter({ mode: "day", date: operationalDate(at) });
          }}
        />
      )}
      {booking && (
        <FloorBooking
          resource={booking}
          at={at}
          duration={filters.duration}
          onClose={() => setBooking(null)}
        />
      )}
    </main>
  );
}
