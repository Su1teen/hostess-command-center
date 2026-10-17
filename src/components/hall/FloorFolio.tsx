import { useQuery } from "@tanstack/react-query";
import { ExternalLink, ReceiptText } from "lucide-react";
import { money, staffApi, statusLabels } from "../../lib/dine-in-client";
import type { FloorFolio as Folio } from "../../lib/floor-operations";
import { formatDateTimeAlmaty } from "../../lib/formatters/time";

const visitEvents: Record<string, string> = {
  seated: "Посадка подтверждена",
  released: "Стол освобождён",
  expired: "QR-активность завершена",
  created: "Визит открыт",
  order_created: "Добавлен заказ",
};
export function FloorFolio({ sessionId }: { sessionId: string }) {
  const query = useQuery({
    queryKey: ["floor-folio", sessionId],
    queryFn: ({ signal }) =>
      staffApi<{ folio: Folio }>(`/floor/sessions/${sessionId}/folio`, { signal }),
    refetchInterval: 15_000,
  });
  const folio = query.data?.folio;
  if (query.isPending)
    return (
      <p role="status" className="py-5 text-sm text-slate-500">
        Загружаем фолио визита…
      </p>
    );
  if (query.error)
    return (
      <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
        {query.error.message}
        <button type="button" className="mt-2 block underline" onClick={() => void query.refetch()}>
          Повторить загрузку фолио
        </button>
      </div>
    );
  if (!folio) return null;
  return (
    <section aria-label="Фолио визита" className="space-y-4">
      <div className="flex items-center gap-2">
        <ReceiptText size={17} />
        <h3 className="font-semibold">Фолио визита</h3>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
        <p className="font-medium">{folio.session.guestName ?? "Гость без аккаунта"}</p>
        {folio.session.guestPhone && (
          <a className="mt-1 block text-slate-600" href={`tel:${folio.session.guestPhone}`}>
            {folio.session.guestPhone}
          </a>
        )}
        <p className="mt-2 text-xs text-slate-500">
          Начало: {formatDateTimeAlmaty(folio.session.seatedAt ?? folio.session.openedAt)}
        </p>
        {folio.session.closedAt && (
          <p className="mt-1 text-xs text-slate-500">
            Завершение: {formatDateTimeAlmaty(folio.session.closedAt)}
          </p>
        )}
        <details className="mt-2 text-xs text-slate-500">
          <summary className="cursor-pointer">Источник визита</summary>
          <p className="mt-1 break-all">dining_sessions · {folio.session.id}</p>
          {folio.session.reservationId && (
            <p className="mt-1 break-all">Бронь · {folio.session.reservationId}</p>
          )}
        </details>
      </div>
      {folio.orders.map((order) => (
        <article
          key={order.id}
          className="overflow-hidden rounded-xl border border-slate-200 bg-white"
        >
          <a
            href={`/orders?order=${encodeURIComponent(order.id)}`}
            className="flex min-h-12 items-center justify-between gap-2 border-b px-3 py-3 text-sm font-semibold hover:bg-slate-50"
            aria-label={`Открыть заказ ${order.number}`}
          >
            <span>Заказ №{order.number}</span>
            <ExternalLink size={14} />
          </a>
          <p className="px-3 pt-3 text-xs text-slate-500">
            {formatDateTimeAlmaty(order.acceptedAt)} · {statusLabels[order.status]}
          </p>
          <ul className="divide-y px-3">
            {order.items.map((item) => (
              <li key={item.id} className="py-3 text-sm">
                <div className="flex justify-between gap-3">
                  <span>
                    {item.quantity} × {item.name}
                  </span>
                  <strong className="shrink-0">{money(item.totalMinor)}</strong>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {money(item.unitPriceMinor)} за единицу · {statusLabels[order.status]}
                </p>
              </li>
            ))}
          </ul>
          <div className="border-t bg-slate-50 px-3 py-3 text-xs">
            <p>
              К оплате: <strong>{money(order.payableMinor)}</strong>
            </p>
            <p className="mt-1 text-slate-500">
              {order.manualPaymentAt
                ? `Персонал отметил получение: ${formatDateTimeAlmaty(order.manualPaymentAt)}`
                : "Получение оплаты персоналом не отмечено"}
            </p>
            <details className="mt-2">
              <summary className="cursor-pointer text-slate-500">История заказа</summary>
              <ol className="mt-2 space-y-2">
                {order.events.map((event) => (
                  <li key={event.id}>
                    {formatDateTimeAlmaty(event.createdAt)} ·{" "}
                    {statusLabels[event.type as keyof typeof statusLabels] ??
                      {
                        manual_payment_received: "Персонал отметил получение оплаты",
                        guest_linked: "Гость прикреплён",
                        created: "Заказ создан",
                      }[event.type] ??
                      event.type}{" "}
                    · {event.actor}
                  </li>
                ))}
              </ol>
            </details>
          </div>
        </article>
      ))}
      {!folio.orders.length && (
        <p className="rounded-xl border border-dashed p-4 text-sm text-slate-500">
          У этого визита пока нет QR-заказов.
        </p>
      )}
      <dl className="space-y-2 rounded-xl bg-white p-4 text-sm">
        {(
          [
            ["Стоимость позиций", "subtotalMinor"],
            ["Списано бонусов", "discountMinor"],
            ["К оплате", "payableMinor"],
            ["Начисленный кэшбэк", "cashbackMinor"],
            ["Отменённые заказы", "cancelledMinor"],
            ["Персонал отметил получение", "manualReceivedMinor"],
            ["Без отметки получения", "withoutManualReceiptMinor"],
          ] as const
        ).map(([label, key]) => (
          <div
            key={key}
            className={`flex justify-between gap-3 ${key === "payableMinor" ? "border-y py-3 font-semibold" : ""}`}
          >
            <dt>{label}</dt>
            <dd className="shrink-0 tabular-nums">{money(folio.totals[key])}</dd>
          </div>
        ))}
      </dl>
      <p className="rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
        Пилотный статус заказов: assumed_paid. Получение оплаты отмечает персонал; банковское
        подтверждение не поступает. Кэшбэк 3%, срок бонусов 14 дней.
      </p>
      {!!folio.events.length && (
        <details className="rounded-xl border bg-white p-3 text-xs">
          <summary className="cursor-pointer font-medium">История визита</summary>
          <ol className="mt-3 space-y-3">
            {folio.events.map((event) => (
              <li key={event.id}>
                <p>
                  {visitEvents[event.type] ?? event.type} · {event.actor}
                </p>
                <p className="mt-1 text-slate-500">{formatDateTimeAlmaty(event.createdAt)}</p>
                {typeof event.details.reason === "string" && (
                  <p className="mt-1">{event.details.reason}</p>
                )}
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
