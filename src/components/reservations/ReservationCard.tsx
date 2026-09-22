import { Clock, MessageSquare, Users } from "lucide-react";
import { formatKzt } from "../../lib/formatters/money";
import { formatTimeAlmaty } from "../../lib/formatters/time";
import {
  DEPOSIT_STATUS_LABEL,
  RESERVATION_SOURCE_LABEL,
  type Reservation,
} from "../../lib/types/reservations";
import { StatusPill } from "../shared/StatusPill";

export function ReservationCard({
  reservation,
  onClick,
}: {
  reservation: Reservation;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full rounded-3xl border border-slate-200/70 bg-white p-4 text-left transition-transform active:scale-[.99]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Clock size={15} className="shrink-0 text-slate-400" />
          <span className="font-bold">{formatTimeAlmaty(reservation.startsAt)}</span>
          <span className="truncate font-semibold">{reservation.guestName}</span>
        </div>
        <StatusPill status={reservation.status} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        <span>{reservation.phone}</span>
        <span className="flex items-center gap-1">
          <Users size={13} /> {reservation.guests}
        </span>
        <span>{RESERVATION_SOURCE_LABEL[reservation.source]}</span>
      </div>
      <div className="mt-3 flex items-center justify-between text-xs">
        <span
          className={
            reservation.depositStatus === "paid"
              ? "font-semibold text-emerald-700"
              : "text-slate-500"
          }
        >
          {reservation.depositAmount ? `${formatKzt(reservation.depositAmount)} · ` : ""}
          {DEPOSIT_STATUS_LABEL[reservation.depositStatus]}
        </span>
        {reservation.preorders.length > 0 && (
          <span className="font-semibold text-slate-700">
            {reservation.preorders.length} позиция · {formatKzt(reservation.preorderTotal)}
          </span>
        )}
      </div>
      {reservation.comment && (
        <p className="mt-2 flex line-clamp-2 items-start gap-1 text-xs text-slate-500">
          <MessageSquare size={13} className="mt-0.5 shrink-0" />
          {reservation.comment}
        </p>
      )}
    </button>
  );
}
