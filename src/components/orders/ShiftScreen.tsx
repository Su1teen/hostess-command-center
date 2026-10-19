import { useState } from "react";
import { BookingRequests } from "./BookingRequests";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOperations, openStaffOrder, openOrder } from "./ServiceOperations";
import {
  staffApi,
  useStaffRole,
  money,
  statusLabels,
  controlClass,
} from "../../lib/dine-in-client";
import type { FloorSnapshot } from "../../lib/floor-operations";
import { formatTimeAlmaty } from "../../lib/formatters/time";

const next = {
  new: ["accepted", "Принять заказ"],
  accepted: ["preparing", "Передать на приготовление"],
  preparing: ["delivered", "Отметить подачу"],
  delivered: ["closed", "Завершить заказ"],
} as const;
export function ShiftScreen() {
  const query = useOperations(),
    client = useQueryClient(),
    role = useStaffRole();
  const canWrite = role === "operator" || role === "manager";
  const [filter, setFilter] = useState("all");
  const floor = useQuery({
    queryKey: ["shift-floor"],
    queryFn: () => staffApi<FloorSnapshot>("/floor"),
    refetchInterval: 15000,
  });
  const action = useMutation({
    mutationFn: ({ id, data }: { id: string; data: unknown }) =>
      staffApi(`/dine-in/orders/${id}/status`, { method: "PATCH", body: JSON.stringify(data) }),
    onSettled: () => {
      for (const key of [
        "service-operations",
        "dining-orders",
        "dining-order",
        "floor-folio",
        "floor-operations",
      ])
        void client.invalidateQueries({ queryKey: [key] });
    },
  });
  const data = query?.data;
  const orders = (data?.orders ?? []).filter(
    (o) =>
      filter === "all" ||
      (filter === "new"
        ? o.status === "new"
        : filter === "working"
          ? !["new", "closed", "cancelled"].includes(o.status)
          : !o.manualPaymentAt),
  );
  const upcoming =
    floor.data?.zones.flatMap((z) =>
      z.resources
        .filter(
          (r) =>
            r.nextReservation && Date.parse(r.nextReservation.startsAt) - Date.now() <= 30 * 60000,
        )
        .map((r) => ({ r, z })),
    ) ?? [];
  return (
    <div className="space-y-5 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-slate-500">XOXO · сейчас</p>
          <h1 className="mt-2 text-3xl font-semibold">Смена</h1>
          <p className="mt-2 text-sm text-slate-500">
            Стол, заказ и следующее действие — в одной очереди.
          </p>
        </div>
        {canWrite && (
          <button
            className={`${controlClass} bg-slate-900! text-white`}
            onClick={() => openStaffOrder()}
          >
            Создать заказ
          </button>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[
          ["new", "Новые", data?.newCount],
          ["working", "В работе", data?.workingCount],
          ["unpaid", "К оплате", data?.unpaidCount],
        ].map(([key, label, n]) => (
          <button
            key={key}
            aria-pressed={filter === key}
            onClick={() => setFilter(String(key))}
            className={`rounded-2xl border p-3 text-left ${filter === key ? "border-slate-900 bg-white" : "border-slate-200"}`}
          >
            <span className="block text-xs text-slate-500">{label}</span>
            <strong className="mt-1 block text-2xl">{n ?? "…"}</strong>
          </button>
        ))}
      </div>
      <button
        className={controlClass}
        aria-pressed={filter === "all"}
        onClick={() => setFilter("all")}
      >
        Все задачи
      </button>
      {query?.error && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
          {query.error.message} · Данные могут быть устаревшими
        </p>
      )}
      {action.error && (
        <p role="alert" className="text-red-700">
          {action.error.message}
        </p>
      )}
      <BookingRequests />
      {upcoming.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <h2 className="font-semibold">Скоро прибытие</h2>
          {upcoming.map(({ r, z }) => (
            <a key={r.id} href="/?reservations=true" className="mt-2 block min-h-11 text-sm">
              Стол {r.code} · {z.name} · {formatTimeAlmaty(r.nextReservation!.startsAt)} ·{" "}
              {r.nextReservation!.guests} гостей{" "}
              {r.currentSession ? "· текущий визит ещё открыт" : ""}
            </a>
          ))}
        </section>
      )}
      {query?.isPending && <p role="status">Загружаем смену…</p>}
      {data?.hasMore && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm">
          Показаны первые 200 задач. Остальные доступны в разделе «Заказы».
        </p>
      )}
      <section
        aria-label="Очередь обслуживания"
        className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"
      >
        {orders.map((o) => {
          const age = Math.max(0, Math.floor((Date.now() - Date.parse(o.acceptedAt)) / 60000));
          const step = next[o.status as keyof typeof next];
          return (
            <article
              key={o.id}
              className={`rounded-2xl border bg-white p-4 ${o.status === "new" ? "border-amber-300" : "border-slate-200"}`}
            >
              <button onClick={() => openOrder(o.id)} className="block w-full text-left">
                <h2 className="text-lg font-semibold">
                  Стол {o.tableCode} · {o.zoneName}
                </h2>
                <p
                  className={`mt-1 text-sm ${o.status === "new" && age >= 10 ? "font-semibold text-red-700" : "text-slate-500"}`}
                >
                  №{o.number} · {statusLabels[o.status]} · {age} мин.
                </p>
                <p className="mt-3 text-sm">
                  {o.items.map((i) => `${i.quantity} × ${i.name}`).join(", ")}
                </p>
                <p className="mt-4 flex justify-between text-sm font-semibold">
                  <span>{o.manualPaymentAt ? "Оплата отмечена" : "К получению"}</span>
                  <span>{money(o.payableMinor)}</span>
                </p>
                {o.source === "web_app" && (
                  <p className="mt-2 text-xs font-medium text-amber-800">
                    Через сайт · подтвердите у гостей
                  </p>
                )}
              </button>
              {canWrite && (
                <div className="mt-4 grid gap-2">
                  {step && (
                    <button
                      disabled={action.isPending || query?.isError}
                      className={`${controlClass} bg-slate-900! text-white`}
                      onClick={() => action.mutate({ id: o.id, data: { status: step[0] } })}
                    >
                      {step[1]}
                    </button>
                  )}
                  {!o.manualPaymentAt && (
                    <button
                      className={`${controlClass} content-center text-center`}
                      onClick={() => openOrder(o.id)}
                    >
                      Проверить и отметить оплату
                    </button>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </section>
      {data && !orders.length && (
        <p className="rounded-2xl border border-dashed p-8 text-center text-slate-500">
          В этой очереди нет задач
        </p>
      )}
      <a className={`${controlClass} inline-flex items-center`} href="/?reservations=true">
        Бронирования и прибытия
      </a>
    </div>
  );
}
