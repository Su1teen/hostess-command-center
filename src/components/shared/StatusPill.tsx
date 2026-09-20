import { RESERVATION_STATUS_LABEL, type ReservationStatus } from "../../lib/types/reservations";

const colors: Record<ReservationStatus, string> = {
  confirmed: "bg-emerald-100 text-emerald-700",
  expected: "bg-blue-100 text-blue-700",
  arrived: "bg-violet-100 text-violet-700",
  cancelled: "bg-rose-100 text-rose-700",
  no_show: "bg-slate-200 text-slate-600",
};

export function StatusPill({ status }: { status: ReservationStatus }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${colors[status]}`}>
      {RESERVATION_STATUS_LABEL[status]}
    </span>
  );
}
