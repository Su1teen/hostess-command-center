import { X } from "lucide-react";
import { formatKzt } from "../../lib/formatters/money";
import { formatDateTimeAlmaty, formatTimeAlmaty } from "../../lib/formatters/time";
import {
  DEPOSIT_STATUS_LABEL,
  RESERVATION_SOURCE_LABEL,
  type DepositStatus,
  type Reservation,
  type ReservationStatus,
} from "../../lib/types/reservations";
import { PhoneActions } from "../shared/PhoneActions";
import { StatusPill } from "../shared/StatusPill";

const actions: [ReservationStatus, string][] = [
  ["expected", "Ожидается"],
  ["arrived", "Пришли"],
  ["no_show", "Не пришли"],
  ["cancelled", "Отменить"],
];

export function ReservationSheet({
  reservation,
  onClose,
  onStatus,
  onDeposit,
}: {
  reservation: Reservation;
  onClose: () => void;
  onStatus: (status: ReservationStatus) => void;
  onDeposit: (status: DepositStatus) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/30"
      onClick={onClose}
    >
      <section
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-[2rem] bg-slate-50 p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Детали брони</p>
            <h2 className="mt-1 text-2xl font-bold">{reservation.guestName}</h2>
          </div>
          <button onClick={onClose} className="rounded-full bg-white p-2" aria-label="Закрыть">
            <X size={18} />
          </button>
        </div>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="font-semibold">
              {formatDateTimeAlmaty(reservation.startsAt)}
              {reservation.endsAt && ` – ${formatTimeAlmaty(reservation.endsAt)}`}
            </p>
            <p className="text-sm text-slate-500">
              {reservation.tableLabel ? `Стол ${reservation.tableLabel} · ` : ""}
              {reservation.guests} гостей · {RESERVATION_SOURCE_LABEL[reservation.source]}
            </p>
          </div>
          <StatusPill status={reservation.status} />
        </div>
        <PhoneActions phone={reservation.phone} />
        <div className="mt-5 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Статус</p>
          <div className="grid grid-cols-2 gap-2">
            {actions.map(([status, label]) => (
              <button
                key={status}
                onClick={() => onStatus(status)}
                className={`rounded-2xl border py-3 text-sm font-medium ${reservation.status === status ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={() => onDeposit(reservation.depositStatus === "paid" ? "pending" : "paid")}
          className={`mt-4 w-full rounded-2xl py-3.5 text-sm font-semibold ${reservation.depositStatus === "paid" ? "bg-emerald-100 text-emerald-700" : "bg-slate-900 text-white"}`}
        >
          {reservation.depositStatus === "paid"
            ? "✓ Задаток получен"
            : `Задаток · ${formatKzt(reservation.depositAmount)} · ${DEPOSIT_STATUS_LABEL[reservation.depositStatus]}`}
        </button>
        {reservation.comment && (
          <p className="mt-5 rounded-2xl bg-white p-4 text-sm text-slate-600">
            {reservation.comment}
          </p>
        )}
        {reservation.preorders.length > 0 && (
          <div className="mt-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Предзаказ
            </p>
            <div className="space-y-2">
              {reservation.preorders.map((item) => (
                <div
                  key={item.id ?? item.productName}
                  className="flex items-center justify-between rounded-2xl bg-white p-3 text-sm"
                >
                  <span>
                    {item.productName} × {item.quantity}
                  </span>
                  <span className="font-semibold">{formatKzt(item.total)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
