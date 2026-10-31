import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ExternalLink,
  Gift,
  MessageCircle,
  Plus,
  Search,
  Send,
  UserRound,
} from "lucide-react";
import { staffApi, useStaffRole, dateTime, controlClass } from "../../lib/dine-in-client";
import { BottomSheet } from "../shared/BottomSheet";

type Regular = {
  id: string;
  name: string;
  phone: string;
  note: string;
  active: boolean;
  optedOut: boolean;
  balanceMinor: string;
  welcomeBonusMinor: string;
  signedIn: boolean;
  createdAt: string;
  lastOrderAt: string | null;
};
type Campaign = {
  id: string;
  title: string;
  body: string;
  status: "queued" | "done" | "cancelled";
  createdAt: string;
  total: number;
  sent: number;
  failed: number;
  pending: number;
};
type Recipient = {
  id: string;
  name: string;
  phone: string;
  message: string;
  status: "pending" | "sent" | "failed" | "skipped";
  sentAt: string | null;
};

const tenge = (minor: string | number) =>
  `${Math.round(Number(minor) / 100).toLocaleString("ru-RU")} ₸`;
const prettyPhone = (phone: string) =>
  phone.replace(/^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/, "+7 $1 $2 $3 $4");
const inputClass =
  "mt-1.5 min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-base";
const primaryClass =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white disabled:opacity-40";
const waLink = (phone: string, text: string) =>
  `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;

export function RegularsScreen() {
  const role = useStaffRole();
  const [tab, setTab] = useState<"guests" | "broadcasts">("guests");
  if (role && role !== "manager")
    return (
      <div className="mx-auto max-w-3xl px-4 pt-10 text-center text-sm text-slate-600">
        Раздел «Постоянники» доступен только менеджеру.
      </div>
    );
  return (
    <div className="mx-auto max-w-3xl px-4 pb-28 pt-6">
      <p className="text-xs uppercase tracking-wide text-slate-500">XOXO · гости</p>
      <h1 className="mt-2 text-2xl font-semibold">Постоянники</h1>
      <p className="mt-2 flex items-start gap-2 rounded-2xl bg-white p-3 text-sm text-slate-600 ring-1 ring-slate-200">
        <Gift size={16} className="mt-0.5 shrink-0 text-amber-500" />
        Добавьте гостя по имени и номеру — ему сразу начислится приветственный бонус. Когда он
        зайдёт в аккаунт по QR с этим номером WhatsApp, бонусы уже будут на счёте.
      </p>
      <div className="mt-5 grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1" role="tablist">
        {(
          [
            ["guests", "Гости"],
            ["broadcasts", "Рассылки"],
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
      {tab === "guests" ? <Guests /> : <Broadcasts />}
    </div>
  );
}

function useRegulars(search = "") {
  return useQuery({
    queryKey: ["regulars", search],
    queryFn: () => staffApi<{ regulars: Regular[] }>(`/regulars?q=${encodeURIComponent(search)}`),
  });
}

function Guests() {
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<Regular | null>(null);
  const list = useRegulars(search);
  const regulars = list.data?.regulars ?? [];
  return (
    <section className="mt-5">
      <button className={`${primaryClass} w-full`} onClick={() => setAdding(true)}>
        <Plus size={18} /> Добавить постоянника
      </button>
      <label className="relative mt-3 block">
        <Search
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
        />
        <input
          className={`${inputClass} mt-0 pl-9`}
          placeholder="Найти по имени или номеру"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      {list.error && <p className="mt-3 text-sm text-red-700">{list.error.message}</p>}
      <div className="mt-3 space-y-2">
        {regulars.map((r) => (
          <button
            key={r.id}
            onClick={() => setOpen(r)}
            className={`flex w-full items-start gap-3 rounded-2xl bg-white p-4 text-left ring-1 ring-slate-200 ${r.active ? "" : "opacity-60"}`}
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-600">
              <UserRound size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <strong className="truncate">{r.name}</strong>
                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  {tenge(r.balanceMinor)}
                </span>
              </span>
              <span className="block text-sm text-slate-500">{prettyPhone(r.phone)}</span>
              <span className="mt-1.5 flex flex-wrap gap-1.5 text-xs font-semibold">
                <span
                  className={`rounded-full px-2 py-0.5 ${r.signedIn ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}
                >
                  {r.signedIn ? "Вошёл в аккаунт" : "Ждёт первого входа"}
                </span>
                {r.optedOut && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
                    Без рассылок
                  </span>
                )}
                {!r.active && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
                    Выключен
                  </span>
                )}
              </span>
            </span>
          </button>
        ))}
        {list.data && !regulars.length && (
          <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-slate-500">
            {search
              ? "Никого не нашли."
              : "Пока никого. Добавьте первого постоянника — ему начислится приветственный бонус."}
          </p>
        )}
      </div>
      {adding && <AddRegular onClose={() => setAdding(false)} />}
      {open && (
        <RegularSheet
          r={regulars.find((x) => x.id === open.id) ?? open}
          onClose={() => setOpen(null)}
        />
      )}
    </section>
  );
}

function AddRegular({ onClose }: { onClose: () => void }) {
  const client = useQueryClient();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [bonus, setBonus] = useState(300);
  const [days, setDays] = useState(90);
  const [custom, setCustom] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      staffApi("/regulars", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim(),
          note: note.trim(),
          bonus,
          bonusDays: days,
        }),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["regulars"] });
      onClose();
    },
  });
  return (
    <BottomSheet eyebrow="Новый постоянник" title="Добавить гостя" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <label className="block text-sm font-medium">
          Имя
          <input
            className={inputClass}
            required
            maxLength={100}
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="block text-sm font-medium">
          Номер WhatsApp
          <input
            className={inputClass}
            type="tel"
            inputMode="tel"
            required
            placeholder="+7 701 000 00 00"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <span className="mt-1 block text-xs font-normal text-slate-500">
            По этому номеру гость войдёт в аккаунт, и бонусы окажутся у него.
          </span>
        </label>
        <label className="block text-sm font-medium">
          Заметка <span className="font-normal text-slate-500">(необязательно)</span>
          <input
            className={inputClass}
            maxLength={500}
            placeholder="Любит стол у экрана"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <div className="rounded-xl bg-amber-50 p-3 text-sm ring-1 ring-amber-200">
          <p className="flex items-center gap-2 font-semibold text-amber-900">
            <Gift size={16} /> Приветственный бонус: {tenge(bonus * 100)}
          </p>
          <p className="mt-0.5 text-xs text-amber-900/80">
            Действует {days} дн. и списывается при оплате заказа.
          </p>
          {custom ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="block text-xs font-medium">
                Сумма, ₸
                <input
                  className={inputClass}
                  type="number"
                  min={0}
                  max={100000}
                  value={bonus}
                  onChange={(e) => setBonus(Number(e.target.value))}
                />
              </label>
              <label className="block text-xs font-medium">
                Дней
                <input
                  className={inputClass}
                  type="number"
                  min={1}
                  max={365}
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                />
              </label>
            </div>
          ) : (
            <button
              type="button"
              className="mt-2 min-h-10 text-sm font-semibold text-amber-900 underline"
              onClick={() => setCustom(true)}
            >
              Изменить сумму или срок
            </button>
          )}
        </div>
        {save.error && <p className="text-sm text-red-700">{save.error.message}</p>}
        <button
          className={`${primaryClass} w-full`}
          disabled={!name.trim() || !phone.trim() || save.isPending}
        >
          {save.isPending ? "Сохраняем…" : "Добавить и начислить бонус"}
        </button>
      </form>
    </BottomSheet>
  );
}

function RegularSheet({ r, onClose }: { r: Regular; onClose: () => void }) {
  const client = useQueryClient();
  const [name, setName] = useState(r.name);
  const [note, setNote] = useState(r.note);
  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      staffApi(`/regulars/${r.id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["regulars"] }),
  });
  const dirty = name.trim() !== r.name || note.trim() !== r.note;
  return (
    <BottomSheet eyebrow={prettyPhone(r.phone)} title={r.name} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2 text-center">
          <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-200">
            <p className="text-xs text-slate-500">Бонусы сейчас</p>
            <p className="text-xl font-semibold tabular-nums">{tenge(r.balanceMinor)}</p>
          </div>
          <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-200">
            <p className="text-xs text-slate-500">Аккаунт</p>
            <p className="text-sm font-semibold">{r.signedIn ? "Вошёл" : "Ещё не входил"}</p>
          </div>
        </div>
        <p className="text-xs text-slate-500">
          Добавлен {dateTime(r.createdAt)} · приветственный бонус {tenge(r.welcomeBonusMinor)}
          {r.lastOrderAt && ` · последний заказ ${dateTime(r.lastOrderAt)}`}
        </p>
        <label className="block text-sm font-medium">
          Имя
          <input
            className={inputClass}
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="block text-sm font-medium">
          Заметка
          <input
            className={inputClass}
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        {dirty && (
          <button
            className={`${primaryClass} w-full`}
            disabled={!name.trim() || patch.isPending}
            onClick={() => patch.mutate({ name: name.trim(), note: note.trim() })}
          >
            Сохранить
          </button>
        )}
        <label className="flex min-h-12 items-center justify-between rounded-xl bg-white px-4 ring-1 ring-slate-200">
          <span className="text-sm font-medium">Присылать рассылки</span>
          <input
            type="checkbox"
            className="size-5"
            checked={!r.optedOut}
            onChange={(e) => patch.mutate({ optedOut: !e.target.checked })}
          />
        </label>
        <label className="flex min-h-12 items-center justify-between rounded-xl bg-white px-4 ring-1 ring-slate-200">
          <span className="text-sm font-medium">Постоянник активен</span>
          <input
            type="checkbox"
            className="size-5"
            checked={r.active}
            onChange={(e) => patch.mutate({ active: e.target.checked })}
          />
        </label>
        {patch.error && <p className="text-sm text-red-700">{patch.error.message}</p>}
        <a
          href={waLink(r.phone, "")}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold"
        >
          <MessageCircle size={16} /> Открыть WhatsApp
        </a>
      </div>
    </BottomSheet>
  );
}

function Broadcasts() {
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<Campaign | null>(null);
  const list = useQuery({
    queryKey: ["broadcasts"],
    queryFn: () => staffApi<{ broadcasts: Campaign[] }>("/regulars/broadcasts"),
    refetchInterval: 15000,
  });
  const campaigns = list.data?.broadcasts ?? [];
  const statusLabel = { queued: "В очереди", done: "Отправлена", cancelled: "Отменена" } as const;
  return (
    <section className="mt-5 space-y-3">
      <p className="rounded-2xl bg-white p-3 text-sm text-slate-600 ring-1 ring-slate-200">
        Рассылка готовит личное сообщение каждому постояннику. Пока отправляйте вручную: кнопка
        «Открыть в WhatsApp» подставит текст сама. Автоматическую отправку подключим позже.
      </p>
      <button className={`${primaryClass} w-full`} onClick={() => setCreating(true)}>
        <Send size={18} /> Новая рассылка
      </button>
      {list.error && <p className="text-sm text-red-700">{list.error.message}</p>}
      {campaigns.map((c) => (
        <button
          key={c.id}
          onClick={() => setOpen(c)}
          className="block w-full rounded-2xl bg-white p-4 text-left ring-1 ring-slate-200"
        >
          <span className="flex items-baseline justify-between gap-2">
            <strong className="truncate">{c.title}</strong>
            <span className="shrink-0 text-xs text-slate-500">{dateTime(c.createdAt)}</span>
          </span>
          <span className="mt-1 line-clamp-2 block text-sm text-slate-600">{c.body}</span>
          <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
            <span
              className="block h-full rounded-full bg-emerald-500"
              style={{ width: `${c.total ? (c.sent / c.total) * 100 : 0}%` }}
            />
          </span>
          <span className="mt-1.5 flex justify-between text-xs text-slate-500">
            <span>
              Отправлено {c.sent} из {c.total}
              {c.failed > 0 && ` · ошибок ${c.failed}`}
            </span>
            <span className="font-semibold">{statusLabel[c.status]}</span>
          </span>
        </button>
      ))}
      {list.data && !campaigns.length && (
        <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-slate-500">
          Рассылок пока не было. Например: «{"{имя}"}, в субботу Эль-Класико — столик за вами».
        </p>
      )}
      {creating && (
        <NewBroadcast onClose={() => setCreating(false)} onCreated={() => setCreating(false)} />
      )}
      {open && (
        <CampaignSheet
          c={campaigns.find((x) => x.id === open.id) ?? open}
          onClose={() => setOpen(null)}
        />
      )}
    </section>
  );
}

function NewBroadcast({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const client = useQueryClient();
  const list = useRegulars();
  const eligible = (list.data?.regulars ?? []).filter((r) => r.active && !r.optedOut);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"all" | "pick">("all");
  const [picked, setPicked] = useState<string[]>([]);
  const audience = mode === "all" ? eligible : eligible.filter((r) => picked.includes(r.id));
  const first = audience[0];
  const create = useMutation({
    mutationFn: () =>
      staffApi("/regulars/broadcasts", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          body: text.trim(),
          ...(mode === "pick" ? { regularIds: picked } : {}),
        }),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["broadcasts"] });
      onCreated();
    },
  });
  return (
    <BottomSheet eyebrow="Рассылка" title="Новая рассылка" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <label className="block text-sm font-medium">
          Название <span className="font-normal text-slate-500">(только для вас)</span>
          <input
            className={inputClass}
            required
            maxLength={120}
            value={title}
            placeholder="Эль-Класико"
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="block text-sm font-medium">
          Текст сообщения
          <textarea
            className={`${inputClass} min-h-32 py-2`}
            required
            maxLength={1500}
            value={text}
            placeholder="{имя}, в субботу в 01:00 показываем Эль-Класико. Бронь на ваше имя — просто ответьте."
            onChange={(e) => setText(e.target.value)}
          />
          <span className="mt-1 block text-xs font-normal text-slate-500">
            {"{имя}"} заменится именем гостя.
          </span>
        </label>
        <fieldset>
          <legend className="text-sm font-medium">Кому</legend>
          <div className="mt-1.5 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
            {(
              [
                ["all", `Всем (${eligible.length})`],
                ["pick", "Выбрать"],
              ] as const
            ).map(([key, label]) => (
              <button
                type="button"
                key={key}
                aria-pressed={mode === key}
                onClick={() => setMode(key)}
                className={`min-h-11 rounded-lg text-sm font-semibold ${mode === key ? "bg-white shadow-sm" : "text-slate-500"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {mode === "pick" && (
            <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">
              {eligible.map((r) => (
                <label
                  key={r.id}
                  className="flex min-h-12 items-center gap-3 rounded-xl bg-white px-3 ring-1 ring-slate-200"
                >
                  <input
                    type="checkbox"
                    className="size-5"
                    checked={picked.includes(r.id)}
                    onChange={(e) =>
                      setPicked((p) =>
                        e.target.checked ? [...p, r.id] : p.filter((id) => id !== r.id),
                      )
                    }
                  />
                  <span className="text-sm">
                    {r.name} <span className="text-slate-500">{prettyPhone(r.phone)}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
          <p className="mt-1 text-xs text-slate-500">
            Гости с отказом от рассылок и выключенные не получат сообщение.
          </p>
        </fieldset>
        {first && text.trim() && (
          <div className="rounded-xl bg-emerald-50 p-3 text-sm ring-1 ring-emerald-200">
            <p className="text-xs font-semibold text-emerald-900">Так увидит {first.name}</p>
            <p className="mt-1 whitespace-pre-line">
              {text.replace(/\{\s*(имя|name)\s*\}/gi, first.name.split(/\s+/)[0])}
            </p>
          </div>
        )}
        {create.error && <p className="text-sm text-red-700">{create.error.message}</p>}
        <button
          className={`${primaryClass} w-full`}
          disabled={!title.trim() || !text.trim() || !audience.length || create.isPending}
        >
          {create.isPending ? "Готовим…" : `Подготовить для ${audience.length} гостей`}
        </button>
      </form>
    </BottomSheet>
  );
}

function CampaignSheet({ c, onClose }: { c: Campaign; onClose: () => void }) {
  const client = useQueryClient();
  const recipients = useQuery({
    queryKey: ["broadcast", c.id],
    queryFn: () => staffApi<{ recipients: Recipient[] }>(`/regulars/broadcasts/${c.id}`),
  });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["broadcast", c.id] });
    void client.invalidateQueries({ queryKey: ["broadcasts"] });
  };
  const mark = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Recipient["status"] }) =>
      staffApi(`/regulars/broadcasts/${c.id}/recipients/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: refresh,
  });
  const cancel = useMutation({
    mutationFn: () =>
      staffApi(`/regulars/broadcasts/${c.id}/cancel`, { method: "POST", body: JSON.stringify({}) }),
    onSuccess: refresh,
  });
  const sent = {
    pending: "Ждёт отправки",
    sent: "Отправлено",
    failed: "Ошибка",
    skipped: "Пропущено",
  } as const;
  return (
    <BottomSheet eyebrow={`Отправлено ${c.sent} из ${c.total}`} title={c.title} onClose={onClose}>
      <div className="space-y-3">
        <p className="whitespace-pre-line rounded-2xl bg-white p-3 text-sm ring-1 ring-slate-200">
          {c.body}
        </p>
        {(recipients.data?.recipients ?? []).map((r) => (
          <article key={r.id} className="rounded-2xl bg-white p-3 ring-1 ring-slate-200">
            <div className="flex items-baseline justify-between gap-2">
              <strong className="truncate text-sm">{r.name}</strong>
              <span
                className={`shrink-0 text-xs font-semibold ${r.status === "sent" ? "text-emerald-700" : r.status === "failed" ? "text-red-700" : "text-slate-500"}`}
              >
                {sent[r.status]}
              </span>
            </div>
            <p className="text-xs text-slate-500">{prettyPhone(r.phone)}</p>
            {r.status === "pending" && c.status === "queued" && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <a
                  href={waLink(r.phone, r.message)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-slate-200 text-sm font-semibold"
                >
                  <ExternalLink size={15} /> Открыть в WhatsApp
                </a>
                <button
                  className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 text-sm font-semibold text-white disabled:opacity-40"
                  disabled={mark.isPending}
                  onClick={() => mark.mutate({ id: r.id, status: "sent" })}
                >
                  <Check size={15} /> Отправил
                </button>
              </div>
            )}
          </article>
        ))}
        {recipients.isPending && (
          <p className="py-6 text-center text-sm text-slate-500">Загружаем получателей…</p>
        )}
        {(mark.error || cancel.error) && (
          <p className="text-sm text-red-700">{(mark.error ?? cancel.error)?.message}</p>
        )}
        {c.status === "queued" && (
          <button
            className="min-h-12 w-full rounded-xl text-sm font-semibold text-red-700"
            disabled={cancel.isPending}
            onClick={() => {
              if (window.confirm("Отменить рассылку? Неотправленные сообщения будут пропущены."))
                cancel.mutate();
            }}
          >
            Отменить рассылку
          </button>
        )}
      </div>
    </BottomSheet>
  );
}
