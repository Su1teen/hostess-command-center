import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "../ui/sheet";
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
export function OrderDrawer({ orderId, onClose }: { orderId: string | null; onClose: () => void }) {
  const role = useStaffRole(),
    canWrite = role === "operator" || role === "manager",
    client = useQueryClient();
  const [reason, setReason] = useState(""),
    [guestSearch, setGuestSearch] = useState("");
  const detail = useQuery({
    queryKey: ["dining-order", orderId],
    queryFn: () => staffApi<{ order: DineOrder }>(`/dine-in/orders/${orderId}`),
    enabled: !!orderId,
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
      void client.invalidateQueries({ queryKey: ["service-operations"] });
      void client.invalidateQueries({ queryKey: ["floor"] });
      void client.invalidateQueries({ queryKey: ["dining-orders"] });
      void client.invalidateQueries({ queryKey: ["dining-order"] });
      void client.invalidateQueries({ queryKey: ["floor-folio"] });
      void client.invalidateQueries({ queryKey: ["floor-operations"] });
    },
  });

  const order = detail.data?.order;
  function change(path: string, data: unknown, method = "PATCH") {
    mutation.mutate({ path: `/dine-in/orders/${order!.id}/${path}`, method, data });
  }
  return (
    <Sheet
      open={!!orderId}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent side="right" className="w-full overflow-y-auto px-3 pb-24 pt-12 sm:max-w-xl">
        <SheetTitle>Карточка заказа</SheetTitle>
        <SheetDescription>Стол, состав и серверный расчёт заказа.</SheetDescription>
        {detail.isPending && (
          <p role="status" className="py-5">
            Загружаем заказ…
          </p>
        )}
        {(detail.error || mutation.error) && (
          <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-red-800">
            {(detail.error ?? mutation.error)?.message}
          </p>
        )}
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
                onClick={() => onClose()}
              >
                ×
              </button>
            </div>
            <p className="mt-4 font-medium">{order.guestName ?? "Гость без аккаунта"}</p>
            <p className="mt-1 text-xs text-slate-500">
              {order.source === "staff"
                ? "Оформлен сотрудником"
                : order.source === "web_app"
                  ? "Заказ через сайт · проверьте у гостей за столом"
                  : order.source === "table_code"
                    ? "Оформлен гостем по коду стола"
                    : "Оформлен гостем по QR"}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {dateTime(order.acceptedAt)} · {statusLabels[order.status]}
            </p>
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
                    {money(i.unitPriceMinor)} за ед. ·{" "}
                    {i.itemType === "REGULAR_MENU" ? "Основное меню" : "Биржа напитков"}
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
                <dt>К получению</dt>
                <dd>{money(order.payableMinor)}</dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-amber-800">
              Примите оплату через терминал и отметьте получение.
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
                      Оплата получена
                    </button>
                  )}
                </div>
                {(role === "manager" || (order.status === "new" && !order.manualPaymentAt)) && (
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
                        manual_payment_received: "Оплата получена",
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
      </SheetContent>
    </Sheet>
  );
}
