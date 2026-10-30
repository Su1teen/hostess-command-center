import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Pencil, Plus, Trash2, Sparkles } from "lucide-react";
import { staffApi, useStaffRole, controlClass } from "../../lib/dine-in-client";
import { BottomSheet } from "../shared/BottomSheet";

type VenueEvent = { id: string; date: string; time: string | null; title: string; details: string };
type Promotion = {
  id: string;
  title: string;
  details: string;
  active: boolean;
  startsOn: string | null;
  endsOn: string | null;
  weekdays: number[] | null;
};

const weekdays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const monthNames = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];
const todayKey = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty" }).format(new Date());
const shift = (key: string, days: number) =>
  new Date(Date.parse(`${key}T00:00:00Z`) + days * 86400_000).toISOString().slice(0, 10);
const humanDate = (key: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${key}T00:00:00Z`));
const inputClass =
  "mt-1.5 min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-base";
const primaryClass =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white disabled:opacity-40";

/** Calendar of matches/events and the list of promotions that the Dayan agent tells guests about. */
export function EventsScreen() {
  const role = useStaffRole();
  const canEdit = role === "operator" || role === "manager";
  const [tab, setTab] = useState<"calendar" | "promotions">("calendar");
  return (
    <div className="mx-auto max-w-3xl px-4 pb-28 pt-6">
      <p className="text-xs uppercase tracking-wide text-slate-500">XOXO · для гостей</p>
      <h1 className="mt-2 text-2xl font-semibold">Афиша и акции</h1>
      <p className="mt-2 flex items-start gap-2 rounded-2xl bg-white p-3 text-sm text-slate-600 ring-1 ring-slate-200">
        <Sparkles size={16} className="mt-0.5 shrink-0 text-amber-500" />
        Всё, что записано здесь, знает ИИ-администратор Даян. Он рассказывает об этом гостям в
        WhatsApp, только когда они спрашивают.
      </p>
      <div className="mt-5 grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1" role="tablist">
        {(
          [
            ["calendar", "Календарь событий"],
            ["promotions", "Акции"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`min-h-12 rounded-xl text-sm font-semibold ${tab === key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "calendar" ? <EventsCalendar canEdit={canEdit} /> : <Promotions canEdit={canEdit} />}
    </div>
  );
}

function EventsCalendar({ canEdit }: { canEdit: boolean }) {
  const today = todayKey();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [openDay, setOpenDay] = useState<string | null>(null);
  const first = `${month}-01`;
  const gridStart = shift(first, -((new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => shift(gridStart, i));
  const from = days[0],
    to = days[41];
  const events = useQuery({
    queryKey: ["venue-events", from, to],
    queryFn: () => staffApi<{ events: VenueEvent[] }>(`/agent/events?from=${from}&to=${to}`),
  });
  const upcoming = useQuery({
    queryKey: ["venue-events", "upcoming", today],
    queryFn: () =>
      staffApi<{ events: VenueEvent[] }>(`/agent/events?from=${today}&to=${shift(today, 14)}`),
  });
  const byDay = useMemo(() => {
    const map = new Map<string, VenueEvent[]>();
    for (const e of events.data?.events ?? []) map.set(e.date, [...(map.get(e.date) ?? []), e]);
    return map;
  }, [events.data]);
  const [y, m] = month.split("-").map(Number);
  const move = (delta: number) => {
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    setMonth(d.toISOString().slice(0, 7));
  };
  return (
    <section className="mt-5">
      <div className="flex items-center justify-between">
        <button className={controlClass} aria-label="Предыдущий месяц" onClick={() => move(-1)}>
          <ChevronLeft size={18} />
        </button>
        <h2 className="text-lg font-semibold">
          {monthNames[m - 1]} {y}
        </h2>
        <button className={controlClass} aria-label="Следующий месяц" onClick={() => move(1)}>
          <ChevronRight size={18} />
        </button>
      </div>
      <div className="mt-3 grid grid-cols-7 gap-1 text-center text-xs font-medium text-slate-500">
        {weekdays.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {days.map((day) => {
          const list = byDay.get(day) ?? [];
          const outside = !day.startsWith(month);
          return (
            <button
              key={day}
              onClick={() => setOpenDay(day)}
              aria-label={`${humanDate(day)}: событий ${list.length}`}
              className={`flex min-h-16 flex-col items-stretch rounded-xl border p-1 text-left transition-colors ${
                day === today ? "border-slate-900" : "border-slate-200"
              } ${outside ? "bg-slate-50 text-slate-400" : "bg-white"} ${list.length ? "ring-1 ring-amber-300" : ""}`}
            >
              <span className={`text-xs font-semibold ${day === today ? "text-slate-900" : ""}`}>
                {Number(day.slice(8))}
              </span>
              {list.slice(0, 2).map((e) => (
                <span
                  key={e.id}
                  className="mt-0.5 truncate rounded bg-amber-100 px-1 text-[10px] leading-4 text-amber-900"
                >
                  {e.title}
                </span>
              ))}
              {list.length > 2 && (
                <span className="text-[10px] text-slate-500">ещё {list.length - 2}</span>
              )}
            </button>
          );
        })}
      </div>
      {events.error && <p className="mt-3 text-sm text-red-700">{events.error.message}</p>}
      <h2 className="mt-7 font-semibold">Ближайшие 2 недели</h2>
      <div className="mt-2 space-y-2">
        {(upcoming.data?.events ?? []).map((e) => (
          <button
            key={e.id}
            onClick={() => setOpenDay(e.date)}
            className="flex w-full items-start gap-3 rounded-2xl bg-white p-3 text-left ring-1 ring-slate-200"
          >
            <span className="w-20 shrink-0 text-xs text-slate-500">
              {humanDate(e.date).split(",")[1]?.trim() ?? e.date}
              {e.time && <strong className="block text-sm text-slate-900">{e.time}</strong>}
            </span>
            <span className="min-w-0">
              <strong className="block text-sm">{e.title}</strong>
              {e.details && (
                <span className="line-clamp-2 text-xs text-slate-600">{e.details}</span>
              )}
            </span>
          </button>
        ))}
        {upcoming.data && !upcoming.data.events.length && (
          <p className="rounded-2xl border border-dashed p-5 text-center text-sm text-slate-500">
            Пока пусто. Нажмите на дату в календаре, чтобы добавить матч, бой или вечеринку.
          </p>
        )}
      </div>
      {openDay && (
        <DaySheet
          day={openDay}
          events={byDay.get(openDay) ?? []}
          canEdit={canEdit}
          onClose={() => setOpenDay(null)}
        />
      )}
    </section>
  );
}

function DaySheet({
  day,
  events,
  canEdit,
  onClose,
}: {
  day: string;
  events: VenueEvent[];
  canEdit: boolean;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [editing, setEditing] = useState<VenueEvent | "new" | null>(
    events.length ? null : canEdit ? "new" : null,
  );
  const remove = useMutation({
    mutationFn: (id: string) => staffApi(`/agent/events/${id}`, { method: "DELETE" }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["venue-events"] }),
  });
  return (
    <BottomSheet eyebrow="Событие" title={humanDate(day)} onClose={onClose}>
      <div className="space-y-2">
        {events.map((e) =>
          editing !== "new" && editing?.id === e.id ? (
            <EventForm key={e.id} day={day} event={e} onDone={() => setEditing(null)} />
          ) : (
            <article key={e.id} className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {e.time && <p className="text-sm font-semibold text-amber-700">{e.time}</p>}
                  <h3 className="font-semibold">{e.title}</h3>
                </div>
                {canEdit && (
                  <div className="flex gap-1">
                    <button
                      className={controlClass}
                      aria-label="Изменить"
                      onClick={() => setEditing(e)}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      className={controlClass}
                      aria-label="Удалить"
                      disabled={remove.isPending}
                      onClick={() => {
                        if (window.confirm(`Удалить «${e.title}»?`)) remove.mutate(e.id);
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                )}
              </div>
              {e.details && (
                <p className="mt-2 whitespace-pre-line text-sm text-slate-600">{e.details}</p>
              )}
            </article>
          ),
        )}
        {!events.length && !canEdit && (
          <p className="py-6 text-center text-sm text-slate-500">В этот день событий нет.</p>
        )}
        {editing === "new" ? (
          <EventForm day={day} onDone={() => (events.length ? setEditing(null) : onClose())} />
        ) : (
          canEdit && (
            <button className={`${primaryClass} w-full`} onClick={() => setEditing("new")}>
              <Plus size={18} />
              Добавить событие
            </button>
          )
        )}
      </div>
    </BottomSheet>
  );
}

function EventForm({
  day,
  event,
  onDone,
}: {
  day: string;
  event?: VenueEvent;
  onDone: () => void;
}) {
  const client = useQueryClient();
  const [title, setTitle] = useState(event?.title ?? "");
  const [time, setTime] = useState(event?.time ?? "");
  const [details, setDetails] = useState(event?.details ?? "");
  const save = useMutation({
    mutationFn: () =>
      staffApi(event ? `/agent/events/${event.id}` : "/agent/events", {
        method: event ? "PATCH" : "POST",
        body: JSON.stringify({
          date: day,
          time: time || null,
          title: title.trim(),
          details: details.trim(),
        }),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["venue-events"] });
      onDone();
    },
  });
  return (
    <form
      className="space-y-3 rounded-2xl bg-white p-4 ring-1 ring-slate-200"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <label className="block text-sm font-medium">
        Что будет
        <input
          className={inputClass}
          value={title}
          required
          maxLength={200}
          autoFocus
          placeholder="Реал Мадрид — Барселона"
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label className="block text-sm font-medium">
        Время начала <span className="font-normal text-slate-500">(необязательно)</span>
        <input
          className={inputClass}
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
        />
        <span className="mt-1 block text-xs font-normal text-slate-500">
          Если после полуночи — выберите в календаре дату, когда событие реально начнётся.
        </span>
      </label>
      <label className="block text-sm font-medium">
        Подробности и предложения на этот день
        <textarea
          className={`${inputClass} min-h-28 py-2`}
          value={details}
          maxLength={4000}
          placeholder="Трансляция на всех экранах. При брони от 30 000 ₸ — кальян в подарок."
          onChange={(e) => setDetails(e.target.value)}
        />
      </label>
      {save.error && <p className="text-sm text-red-700">{save.error.message}</p>}
      <div className="flex gap-2">
        <button className={`${primaryClass} flex-1`} disabled={!title.trim() || save.isPending}>
          {save.isPending ? "Сохраняем…" : "Сохранить"}
        </button>
        <button type="button" className={`${controlClass} min-h-12 px-4`} onClick={onDone}>
          Отмена
        </button>
      </div>
    </form>
  );
}

function promotionSchedule(p: Promotion) {
  const parts: string[] = [];
  if (p.weekdays?.length) parts.push(p.weekdays.map((d) => weekdays[d - 1]).join(", "));
  else parts.push("Каждый день");
  if (p.startsOn || p.endsOn)
    parts.push(
      [
        p.startsOn && `с ${p.startsOn.split("-").reverse().join(".")}`,
        p.endsOn && `по ${p.endsOn.split("-").reverse().join(".")}`,
      ]
        .filter(Boolean)
        .join(" "),
    );
  return parts.join(" · ");
}

function Promotions({ canEdit }: { canEdit: boolean }) {
  const client = useQueryClient();
  const [editing, setEditing] = useState<Promotion | "new" | null>(null);
  const list = useQuery({
    queryKey: ["venue-promotions"],
    queryFn: () => staffApi<{ promotions: Promotion[] }>("/agent/promotions"),
  });
  const toggle = useMutation({
    mutationFn: (p: Promotion) =>
      staffApi(`/agent/promotions/${p.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ...promotionBody(p), active: !p.active }),
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["venue-promotions"] }),
  });
  return (
    <section className="mt-5 space-y-3">
      {canEdit && (
        <button className={`${primaryClass} w-full`} onClick={() => setEditing("new")}>
          <Plus size={18} />
          Новая акция
        </button>
      )}
      {list.error && <p className="text-sm text-red-700">{list.error.message}</p>}
      {(list.data?.promotions ?? []).map((p) => (
        <article
          key={p.id}
          className={`rounded-2xl bg-white p-4 ring-1 ring-slate-200 ${p.active ? "" : "opacity-60"}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-semibold">{p.title}</h3>
              <p className="mt-0.5 text-xs text-slate-500">{promotionSchedule(p)}</p>
            </div>
            <span
              className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${p.active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"}`}
            >
              {p.active ? "Действует" : "Выключена"}
            </span>
          </div>
          {p.details && (
            <p className="mt-2 whitespace-pre-line text-sm text-slate-600">{p.details}</p>
          )}
          {canEdit && (
            <div className="mt-3 flex gap-2">
              <button className={`${controlClass} flex-1`} onClick={() => setEditing(p)}>
                Изменить
              </button>
              <button
                className={`${controlClass} flex-1`}
                disabled={toggle.isPending}
                onClick={() => toggle.mutate(p)}
              >
                {p.active ? "Выключить" : "Включить"}
              </button>
            </div>
          )}
        </article>
      ))}
      {list.data && !list.data.promotions.length && (
        <p className="rounded-2xl border border-dashed p-5 text-center text-sm text-slate-500">
          Акций пока нет. Добавьте постоянные предложения: счастливые часы, кальян по будням, скидки
          компаниям.
        </p>
      )}
      {editing && (
        <PromotionSheet
          promotion={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

const promotionBody = (p: Promotion) => ({
  title: p.title,
  details: p.details,
  active: p.active,
  startsOn: p.startsOn,
  endsOn: p.endsOn,
  weekdays: p.weekdays,
});

function PromotionSheet({ promotion, onClose }: { promotion?: Promotion; onClose: () => void }) {
  const client = useQueryClient();
  const [draft, setDraft] = useState<Promotion>(
    promotion ?? {
      id: "",
      title: "",
      details: "",
      active: true,
      startsOn: null,
      endsOn: null,
      weekdays: null,
    },
  );
  const set = (patch: Partial<Promotion>) => setDraft((d) => ({ ...d, ...patch }));
  const invalidate = () => void client.invalidateQueries({ queryKey: ["venue-promotions"] });
  const save = useMutation({
    mutationFn: () =>
      staffApi(promotion ? `/agent/promotions/${promotion.id}` : "/agent/promotions", {
        method: promotion ? "PATCH" : "POST",
        body: JSON.stringify({
          ...promotionBody(draft),
          title: draft.title.trim(),
          details: draft.details.trim(),
        }),
      }),
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: () => staffApi(`/agent/promotions/${promotion!.id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });
  const days = draft.weekdays ?? [];
  return (
    <BottomSheet
      eyebrow="Акция"
      title={promotion ? "Изменить акцию" : "Новая акция"}
      onClose={onClose}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <label className="block text-sm font-medium">
          Название
          <input
            className={inputClass}
            value={draft.title}
            required
            maxLength={200}
            placeholder="Счастливые часы"
            onChange={(e) => set({ title: e.target.value })}
          />
        </label>
        <label className="block text-sm font-medium">
          Условия — как объяснить гостю
          <textarea
            className={`${inputClass} min-h-28 py-2`}
            value={draft.details}
            maxLength={4000}
            placeholder="С 17:00 до 19:00 скидка 20% на разливное пиво"
            onChange={(e) => set({ details: e.target.value })}
          />
        </label>
        <fieldset>
          <legend className="text-sm font-medium">Дни недели</legend>
          <div className="mt-1.5 grid grid-cols-7 gap-1">
            {weekdays.map((label, i) => {
              const on = days.includes(i + 1);
              return (
                <button
                  type="button"
                  key={label}
                  aria-pressed={on}
                  onClick={() =>
                    set({
                      weekdays: on ? days.filter((d) => d !== i + 1) : [...days, i + 1].sort(),
                    })
                  }
                  className={`min-h-11 rounded-xl text-sm font-semibold ${on ? "bg-slate-900 text-white" : "bg-white ring-1 ring-slate-200"}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-xs text-slate-500">Ничего не выбрано — действует каждый день.</p>
        </fieldset>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-sm font-medium">
            Начало
            <input
              className={inputClass}
              type="date"
              value={draft.startsOn ?? ""}
              onChange={(e) => set({ startsOn: e.target.value || null })}
            />
          </label>
          <label className="block text-sm font-medium">
            Окончание
            <input
              className={inputClass}
              type="date"
              value={draft.endsOn ?? ""}
              onChange={(e) => set({ endsOn: e.target.value || null })}
            />
          </label>
        </div>
        <label className="flex min-h-12 items-center justify-between rounded-xl bg-white px-4 ring-1 ring-slate-200">
          <span className="text-sm font-medium">Акция действует</span>
          <input
            type="checkbox"
            className="size-5"
            checked={draft.active}
            onChange={(e) => set({ active: e.target.checked })}
          />
        </label>
        {(save.error || remove.error) && (
          <p className="text-sm text-red-700">{(save.error ?? remove.error)?.message}</p>
        )}
        <button
          className={`${primaryClass} w-full`}
          disabled={!draft.title.trim() || save.isPending}
        >
          {save.isPending ? "Сохраняем…" : "Сохранить"}
        </button>
        {promotion && (
          <button
            type="button"
            className="min-h-12 w-full rounded-xl text-sm font-semibold text-red-700"
            disabled={remove.isPending}
            onClick={() => {
              if (window.confirm(`Удалить акцию «${promotion.title}»?`)) remove.mutate();
            }}
          >
            Удалить акцию
          </button>
        )}
      </form>
    </BottomSheet>
  );
}
