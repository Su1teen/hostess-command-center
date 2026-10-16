import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  staffApi,
  useStaffRole,
  money,
  dateTime,
  statusLabels,
  controlClass,
  type DineOrder,
} from "../../lib/dine-in-client";
const nextStatus = {
  new: "accepted",
  accepted: "preparing",
  preparing: "delivered",
  delivered: "closed",
} as const;
export function OrdersScreen() {
  const role = useStaffRole(),
    canWrite = role === "operator" || role === "manager",
    client = useQueryClient();
  const [status, setStatus] = useState(""),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [group, setGroup] = useState(true),
    [sound, setSound] = useState(false),
    [notice, setNotice] = useState(0),
    [reason, setReason] = useState(""),
    [guestSearch, setGuestSearch] = useState("");
  const audio = useRef<AudioContext | null>(null),
    seen = useRef<Set<string> | null>(null);
  const list = useQuery({
    queryKey: ["dining-orders", status, search],
    queryFn: ({ signal }) =>
      staffApi<{ orders: DineOrder[]; outbox: { status: string; count: number }[] }>(
        `/dine-in/orders?${status ? `status=${status}&` : ""}q=${encodeURIComponent(search)}`,
        { signal },
      ),
    refetchInterval: 4000,
  });
  const detail = useQuery({
    queryKey: ["dining-order", selected],
    queryFn: () => staffApi<{ order: DineOrder }>(`/dine-in/orders/${selected}`),
    enabled: !!selected,
    refetchInterval: 4000,
  });
  const guests = useQuery({
    queryKey: ["order-guest-search", guestSearch],
    queryFn: () =>
      staffApi<{ guests: { id: string; name: string; phone: string }[] }>(
        `/guests?q=${encodeURIComponent(guestSearch)}`,
      ),
    enabled: guestSearch.trim().length >= 3,
  });
  const mutation = useMutation({
    mutationFn: ({ path, method, data }: { path: string; method: string; data: unknown }) =>
      staffApi(path, { method, body: JSON.stringify(data) }),
    onSuccess: () => {
      setReason("");
      void client.invalidateQueries({ queryKey: ["dining-orders"] });
      void client.invalidateQueries({ queryKey: ["dining-order"] });
    },
  });
  useEffect(() => {
    if (!list.data) return;
    const count = seen.current
      ? list.data.orders.filter((o) => o.status === "new" && !seen.current!.has(o.id)).length
      : 0;
    if (count) {
      setNotice((n) => n + count);
      if (sound && audio.current) {
        const osc = audio.current.createOscillator(),
          gain = audio.current.createGain();
        osc.connect(gain);
        gain.connect(audio.current.destination);
        gain.gain.value = 0.12;
        osc.frequency.value = 880;
        osc.start();
        osc.stop(audio.current.currentTime + 0.15);
      }
    }
    seen.current = new Set([...(seen.current ?? []), ...list.data.orders.map((o) => o.id)]);
  }, [list.data, sound]);
  const orders = list.data?.orders ?? [],
    order = detail.data?.order;
  const groups = group
    ? Array.from(
        orders.reduce<Map<string, DineOrder[]>>((acc, o) => {
          const rows = acc.get(o.tableCode) ?? [];
          rows.push(o);
          acc.set(o.tableCode, rows);
          return acc;
        }, new Map()),
      )
    : [["Все заказы", orders] as [string, DineOrder[]]];
  function change(path: string, data: unknown, method = "PATCH") {
    mutation.mutate({ path: `/dine-in/orders/${order!.id}/${path}`, method, data });
  }
  return (
    <div className="px-4 py-6 sm:px-6">
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest text-slate-500">XOXO · обслуживание</p>
          <h1 className="mt-2 text-3xl font-semibold">Заказы</h1>
          <p className="mt-2 text-sm text-slate-500">Обновление каждые 4 секунды.</p>
        </div>
        <Link to="/tables/qr" className={`${controlClass} inline-flex items-center`}>
          QR столов
        </Link>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <input
          aria-label="Поиск заказов"
          placeholder="Стол, имя, телефон, № заказа"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`${controlClass} grow`}
        />
        <select
          aria-label="Статус заказа"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className={controlClass}
        >
          <option value="">Все статусы</option>
          {Object.entries(statusLabels).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <button className={controlClass} onClick={() => setGroup((v) => !v)}>
          {group ? "По столам" : "Общий список"}
        </button>
        <button
          className={controlClass}
          aria-pressed={sound}
          onClick={() => {
            audio.current ??= new AudioContext();
            void audio.current.resume();
            setSound((v) => !v);
          }}
        >
          Звук {sound ? "вкл." : "выкл."}
        </button>
        <button className={controlClass} onClick={() => void list.refetch()}>
          Обновить
        </button>
      </div>
      {notice > 0 && (
        <button
          onClick={() => setNotice(0)}
          className="mt-4 w-full rounded-xl bg-emerald-100 p-3 text-sm text-emerald-900"
        >
          Новых заказов: {notice} · скрыть
        </button>
      )}
      {(list.error || mutation.error || detail.error) && (
        <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-red-700">
          {(list.error ?? mutation.error ?? detail.error)?.message}
        </p>
      )}
      {list.isPending && (
        <p role="status" className="mt-6">
          Загружаем заказы…
        </p>
      )}
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          {groups.map(([name, rows]) => (
            <section key={name}>
              <h2 className="mb-2 text-sm font-semibold text-slate-500">
                {group ? `Стол ${name}` : name} · {rows.length}
              </h2>
              <div className="space-y-2">
                {rows.map((o) => (
                  <button
                    key={o.id}
                    onClick={() => {
                      setSelected(o.id);
                      setReason("");
                      setGuestSearch("");
                      mutation.reset();
                    }}
                    className={`w-full rounded-2xl border p-4 text-left ${selected === o.id ? "border-slate-900 bg-slate-100" : "border-slate-200 bg-white"}`}
                  >
                    <div className="flex justify-between gap-3">
                      <strong>
                        №{o.number} · Стол {o.tableCode}
                      </strong>
                      <span
                        className={`rounded-full px-2 py-1 text-xs ${o.status === "new" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100"}`}
                      >
                        {statusLabels[o.status]}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-slate-500">
                      {o.guestName ?? "Неавторизованный гость"} · {dateTime(o.acceptedAt)}
                    </p>
                    <p className="mt-2 text-sm">
                      {o.items.map((i) => `${i.quantity} × ${i.name}`).join(", ")}
                    </p>
                    <p className="mt-3 flex justify-between font-semibold">
                      <span>Принять через терминал</span>
                      <span>{money(o.payableMinor)}</span>
                    </p>
                  </button>
                ))}
              </div>
            </section>
          ))}
          {!list.isPending && !orders.length && (
            <p className="rounded-2xl border border-dashed p-8 text-center text-slate-500">
              Заказов по выбранным условиям нет.
            </p>
          )}
          <p className="text-xs text-slate-400">
            Последние 100 заказов. Для истории используйте поиск и фильтр.
          </p>
          {list.data?.outbox.some((r) => r.status === "failed") && (
            <p className="text-xs text-amber-700">
              Биржа: есть события с повторной доставкой. Заказы сохранены.
              {role === "manager" && (
                <button
                  disabled={mutation.isPending}
                  className={controlClass}
                  onClick={() =>
                    mutation.mutate({
                      path: "/dine-in/outbox/retry",
                      method: "POST",
                      data: { reason: "Повторная доставка менеджером" },
                    })
                  }
                >
                  Повторить доставку
                </button>
              )}
            </p>
          )}
        </div>
        <section aria-label="Карточка заказа">
          {order ? (
            <div className="rounded-2xl border bg-white p-5">
              <div className="flex justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-semibold">
                    №{order.number} · Стол {order.tableCode}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {order.zoneName} · {order.tableName}
                  </p>
                </div>
                <button
                  aria-label="Закрыть карточку"
                  className={controlClass}
                  onClick={() => setSelected(null)}
                >
                  ×
                </button>
              </div>
              <p className="mt-4 font-medium">{order.guestName ?? "Неавторизованный гость"}</p>
              {order.guestPhone && (
                <a href={`tel:${order.guestPhone}`} className="text-sm text-slate-500">
                  {order.guestPhone}
                </a>
              )}
              <div className="mt-4 divide-y">
                {order.items.map((i) => (
                  <div key={i.id} className="py-3">
                    <div className="flex justify-between gap-2 text-sm">
                      <span>
                        {i.quantity} × {i.name}
                      </span>
                      <strong>{money(i.totalMinor)}</strong>
                    </div>
                    <p className="mt-1 break-all text-xs text-slate-400">
                      {money(i.unitPriceMinor)} за ед. · раунд {i.roundId}
                    </p>
                  </div>
                ))}
              </div>
              <dl className="mt-3 space-y-2 border-t pt-4 text-sm">
                {[
                  ["Сумма позиций", order.subtotalMinor],
                  ["Списано бонусов", order.discountMinor],
                  ["Кэшбэк начислен", order.cashbackMinor],
                ].map(([l, v]) => (
                  <div key={l} className="flex justify-between">
                    <dt>{l}</dt>
                    <dd>{money(v)}</dd>
                  </div>
                ))}
                <div className="flex justify-between rounded-xl bg-slate-900 p-4 text-base font-semibold text-white">
                  <dt>Принять через Kaspi</dt>
                  <dd>{money(order.payableMinor)}</dd>
                </div>
              </dl>
              <p className="mt-3 text-xs text-amber-800">
                Пилот: заказ условно оплачен для бонусов. Банковского подтверждения нет. Примите
                оплату через терминал.
              </p>
              <p className="mt-3 text-sm">
                {order.manualPaymentAt
                  ? `Сотрудник отметил оплату: ${dateTime(order.manualPaymentAt)}`
                  : "Оплата сотрудником ещё не отмечена"}
              </p>
              {canWrite && order.status !== "cancelled" && (
                <div className="mt-4 space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {order.status in nextStatus && (
                      <button
                        disabled={mutation.isPending}
                        className={controlClass}
                        onClick={() =>
                          change("status", {
                            status: nextStatus[order.status as keyof typeof nextStatus],
                          })
                        }
                      >
                        {statusLabels[nextStatus[order.status as keyof typeof nextStatus]]}
                      </button>
                    )}
                    {!order.manualPaymentAt && (
                      <button
                        disabled={mutation.isPending}
                        className={controlClass}
                        onClick={() => change("status", { manualPaymentReceived: true })}
                      >
                        Оплата принята вручную
                      </button>
                    )}
                  </div>
                  {role === "manager" && (
                    <form
                      className="flex flex-wrap gap-2 border-t pt-3"
                      onSubmit={(e) => {
                        e.preventDefault();
                        change("cancel", { reason }, "POST");
                      }}
                    >
                      <input
                        required
                        minLength={3}
                        maxLength={500}
                        aria-label="Причина отмены"
                        placeholder="Причина отмены"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        className={`${controlClass} min-w-0 grow`}
                      />
                      <button
                        disabled={mutation.isPending || reason.trim().length < 3}
                        className={`${controlClass} text-red-700`}
                      >
                        Отменить заказ
                      </button>
                    </form>
                  )}
                  {!order.guestId && (
                    <div className="border-t pt-3">
                      <label className="text-sm">
                        Прикрепить гостя
                        <input
                          value={guestSearch}
                          onChange={(e) => setGuestSearch(e.target.value)}
                          placeholder="Имя или телефон, от 3 символов"
                          className={`${controlClass} mt-2 w-full`}
                        />
                      </label>
                      {guests.error && <p role="alert">{guests.error.message}</p>}
                      {guestSearch.trim().length >= 3 &&
                        guests.data?.guests.slice(0, 5).map((g) => (
                          <button
                            key={g.id}
                            disabled={mutation.isPending}
                            className="block min-h-11 text-left text-sm"
                            onClick={() => change("guest", { guestId: g.id }, "POST")}
                          >
                            {g.name} · {g.phone}
                          </button>
                        ))}
                      <p className="mt-2 text-xs text-slate-500">
                        Кэшбэк задним числом не начисляется.
                      </p>
                    </div>
                  )}
                </div>
              )}
              <h3 className="mt-6 font-semibold">История действий</h3>
              <ol className="mt-3 space-y-3">
                {order.events.map((e) => (
                  <li key={e.id} className="border-l-2 pl-3 text-xs text-slate-500">
                    <p>
                      {statusLabels[e.type as keyof typeof statusLabels] ??
                        {
                          created: "Заказ создан",
                          manual_payment_received: "Оплата принята вручную",
                          guest_linked: "Гость прикреплён",
                        }[e.type] ??
                        e.type}{" "}
                      · {e.actor}
                    </p>
                    <p>{dateTime(e.createdAt)}</p>
                    {typeof e.details.reason === "string" && <p>{e.details.reason}</p>}
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-slate-500">
              Выберите заказ, чтобы увидеть состав и сумму к оплате.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
