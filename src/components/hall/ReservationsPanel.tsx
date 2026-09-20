import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronUp, Plus, Users } from "lucide-react";
import { formatKzt } from "../../lib/formatters/money";
import { formatTimeAlmaty } from "../../lib/formatters/time";
import {
  DEPOSIT_STATUS_LABEL,
  type Reservation,
  type ReservationsBoard,
} from "../../lib/types/reservations";
import { StatusPill } from "../shared/StatusPill";

const SWIPE = 40;

/**
 * Bottom operational block for the Hall screen. Collapsed: a handle strip above
 * the nav; expanded: the day's reservations list with a "new reservation" CTA.
 * Tap or vertical swipe on the handle toggles it.
 */
export function ReservationsPanel({
  board,
  open,
  onToggle,
  onCreate,
  onOpen,
  stale,
}: {
  board: ReservationsBoard | undefined;
  open: boolean;
  onToggle: (open: boolean) => void;
  onCreate: () => void;
  onOpen: (reservation: Reservation) => void;
  stale?: boolean;
}) {
  const startY = useRef<number | null>(null);
  const swiped = useRef(false);

  const onPointerDown = (event: ReactPointerEvent) => {
    startY.current = event.clientY;
    swiped.current = false;
  };
  const onPointerMove = (event: ReactPointerEvent) => {
    if (startY.current === null || swiped.current) return;
    const delta = event.clientY - startY.current;
    if (delta < -SWIPE) {
      swiped.current = true;
      onToggle(true);
    } else if (delta > SWIPE) {
      swiped.current = true;
      onToggle(false);
    }
  };
  const onPointerUp = () => {
    if (startY.current !== null && !swiped.current) onToggle(!open);
    startY.current = null;
  };

  const items = board?.upcoming ?? [];
  const active = items.filter((item) => item.status !== "cancelled" && item.status !== "no_show");

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/20 backdrop-blur-[1px]"
          onClick={() => onToggle(false)}
        />
      )}
      <section
        className={`fixed inset-x-0 bottom-0 z-40 mx-auto flex w-full max-w-md flex-col rounded-t-[2rem] bg-white shadow-[0_-12px_40px_-12px_rgba(15,23,42,.25)] transition-[max-height] duration-300 ease-out ${
          open ? "max-h-[78dvh]" : "max-h-[11rem]"
        }`}
        style={{ paddingBottom: "calc(5.5rem + env(safe-area-inset-bottom))" }}
      >
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => (startY.current = null)}
          className="shrink-0 cursor-grab select-none px-5 pb-3 pt-2.5"
          style={{ touchAction: "none" }}
          role="button"
          aria-expanded={open}
        >
          <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-300" />
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold">Брони</h2>
              <p className="text-xs text-slate-500">
                {board ? `${board.dateLabel} · ${active.length} активных` : "Загружаем…"}
                {board && board.kpis.expectedGuests > 0 && ` · ${board.kpis.expectedGuests} гостей`}
              </p>
            </div>
            <ChevronUp
              size={20}
              className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
            />
          </div>
        </div>

        <div
          className={`min-h-0 flex-1 overflow-y-auto px-4 transition-opacity ${stale ? "opacity-70" : ""} ${open ? "" : "pointer-events-none"}`}
        >
          <button
            type="button"
            onClick={onCreate}
            className="mb-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 py-3.5 font-semibold text-white"
          >
            <Plus size={18} /> Новая бронь
          </button>
          {items.length === 0 ? (
            <p className="rounded-2xl bg-slate-50 p-6 text-center text-sm text-slate-500">
              На эту дату броней нет
            </p>
          ) : (
            <ul className="space-y-2 pb-3">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(item)}
                    className="flex w-full items-center gap-3 rounded-2xl bg-slate-50 p-3 text-left active:bg-slate-100"
                  >
                    <div className="w-12 shrink-0">
                      <p className="text-base font-bold tabular-nums">
                        {formatTimeAlmaty(item.startsAt)}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {item.tableLabel ? `Стол ${item.tableLabel}` : "Без стола"}
                      </p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{item.guestName}</p>
                      <p className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                        <span className="flex items-center gap-1">
                          <Users size={12} /> {item.guests}
                        </span>
                        <span className={item.depositStatus === "paid" ? "text-emerald-700" : ""}>
                          {item.depositAmount ? `${formatKzt(item.depositAmount)} · ` : ""}
                          {DEPOSIT_STATUS_LABEL[item.depositStatus]}
                        </span>
                      </p>
                    </div>
                    <StatusPill status={item.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}
