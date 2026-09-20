import { CalendarPlus, Users } from "lucide-react";
import { formatKzt } from "../../lib/formatters/money";
import { formatTimeRangeAlmaty } from "../../lib/formatters/time";
import { findTable } from "../../lib/hall/layout";
import {
  DEPOSIT_STATUS_LABEL,
  TABLE_OCCUPANCY_LABEL,
  type Reservation,
  type TableAvailabilityEntry,
} from "../../lib/types/reservations";
import { BottomSheet } from "../shared/BottomSheet";
import { PhoneActions } from "../shared/PhoneActions";
import { StatusPill } from "../shared/StatusPill";
import { OCCUPANCY_COLOR } from "./FloorPlan";

export function TableSheet({
  tableId,
  entry,
  timeLabel,
  dayReservations,
  onClose,
  onBook,
  onOpenReservation,
}: {
  tableId: string;
  entry: TableAvailabilityEntry | undefined;
  timeLabel: string;
  dayReservations: Reservation[];
  onClose: () => void;
  onBook: () => void;
  onOpenReservation: (reservation: Reservation) => void;
}) {
  const table = findTable(tableId);
  if (!table) return null;
  const status = entry?.status ?? "free";
  const current = entry?.reservation ?? null;
  const upcoming = dayReservations.filter(
    (item) => item.tableId === tableId && item.id !== current?.id,
  );
  return (
    <BottomSheet
      eyebrow={`${table.seats} мест · ${TABLE_OCCUPANCY_LABEL[status]} в ${timeLabel}`}
      title={`Стол ${table.label}`}
      onClose={onClose}
      aside={
        <span
          className="h-3 w-3 rounded-full"
          style={{ background: OCCUPANCY_COLOR[status] }}
          aria-hidden
        />
      }
    >
      {current ? (
        <button
          type="button"
          onClick={() => onOpenReservation(current)}
          className="w-full rounded-3xl bg-white p-4 text-left shadow-sm"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-lg font-bold">{current.guestName}</p>
              <p className="text-sm text-slate-500">
                {formatTimeRangeAlmaty(current.startsAt, current.endsAt)}
              </p>
            </div>
            <StatusPill status={current.status} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
            <span className="flex items-center gap-1">
              <Users size={14} /> {current.guests}
            </span>
            <span>{current.phone}</span>
            <span className={current.depositStatus === "paid" ? "text-emerald-700" : ""}>
              {current.depositAmount ? `${formatKzt(current.depositAmount)} · ` : ""}
              {DEPOSIT_STATUS_LABEL[current.depositStatus]}
            </span>
          </div>
          {current.comment && <p className="mt-2 text-sm text-slate-500">{current.comment}</p>}
        </button>
      ) : (
        <div className="rounded-3xl bg-[#EEF4EF] p-4 text-sm text-slate-700">
          Стол свободен на выбранное время
        </div>
      )}

      {current && (
        <div className="mt-3">
          <PhoneActions phone={current.phone} />
        </div>
      )}

      {upcoming.length > 0 && (
        <section className="mt-5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Другие брони на этот день
          </p>
          <div className="space-y-2">
            {upcoming.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => onOpenReservation(item)}
                className="flex w-full items-center justify-between rounded-2xl bg-white p-3 text-left text-sm"
              >
                <span>
                  <span className="font-semibold">
                    {formatTimeRangeAlmaty(item.startsAt, item.endsAt)}
                  </span>{" "}
                  · {item.guestName}
                </span>
                <StatusPill status={item.status} />
              </button>
            ))}
          </div>
        </section>
      )}

      {status === "free" && (
        <button
          type="button"
          onClick={onBook}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 py-4 font-semibold text-white"
        >
          <CalendarPlus size={18} /> Забронировать этот стол
        </button>
      )}
    </BottomSheet>
  );
}
