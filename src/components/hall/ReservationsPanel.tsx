import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { CalendarDays, ChevronUp, Plus, Users, Wallet } from "lucide-react";
import { formatKzt } from "../../lib/formatters/money";
import { formatTimeAlmaty } from "../../lib/formatters/time";
import {
  DEPOSIT_STATUS_LABEL,
  type Reservation,
  type ReservationsBoard,
} from "../../lib/types/reservations";
import { StatusPill } from "../shared/StatusPill";

const COLLAPSED_HEIGHT = 214;
const MAX_EXPANDED_HEIGHT = 620;
const SWIPE_THRESHOLD = 48;

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
  const [viewportHeight, setViewportHeight] = useState(800);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const dragHeightRef = useRef<number | null>(null);
  const drag = useRef<{ startY: number; startHeight: number } | null>(null);
  const moved = useRef(false);
  const expandedHeight = Math.min(viewportHeight * 0.78, MAX_EXPANDED_HEIGHT);

  useEffect(() => {
    const updateHeight = () => setViewportHeight(window.innerHeight);
    updateHeight();
    window.addEventListener("resize", updateHeight);
    return () => window.removeEventListener("resize", updateHeight);
  }, []);

  useEffect(() => {
    setDragHeight(null);
    dragHeightRef.current = null;
    drag.current = null;
  }, [open]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      startY: event.clientY,
      startHeight: dragHeight ?? (open ? expandedHeight : COLLAPSED_HEIGHT),
    };
    moved.current = false;
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const delta = drag.current.startY - event.clientY;
    if (Math.abs(delta) > 8) moved.current = true;
    const nextHeight = Math.min(
      expandedHeight,
      Math.max(COLLAPSED_HEIGHT, drag.current.startHeight + delta),
    );
    dragHeightRef.current = nextHeight;
    setDragHeight(nextHeight);
  };

  const finishDrag = (event?: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const currentHeight = dragHeightRef.current ?? drag.current.startHeight;
    const delta = currentHeight - drag.current.startHeight;
    const shouldOpen =
      currentHeight > (COLLAPSED_HEIGHT + expandedHeight) / 2 ||
      (open && delta > SWIPE_THRESHOLD) ||
      (!open && delta > SWIPE_THRESHOLD);
    drag.current = null;
    dragHeightRef.current = null;
    setDragHeight(null);
    if (event && !moved.current) {
      onToggle(!open);
      return;
    }
    onToggle(shouldOpen);
  };

  const items = board?.upcoming ?? [];
  const active = items.filter((item) => item.status !== "cancelled" && item.status !== "no_show");
  const expectedGuests =
    board?.kpis.expectedGuests ?? active.reduce((sum, item) => sum + item.guests, 0);
  const depositsTotal =
    board?.kpis.depositsTotal ?? active.reduce((sum, item) => sum + item.depositAmount, 0);
  const height = dragHeight ?? (open ? expandedHeight : COLLAPSED_HEIGHT);

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/20 backdrop-blur-[1px]"
          onClick={() => onToggle(false)}
        />
      )}
      <section
        className={`fixed inset-x-0 bottom-0 z-40 mx-auto flex w-full max-w-md flex-col overflow-hidden rounded-t-[2rem] bg-white shadow-[0_-12px_40px_-12px_rgba(15,23,42,.25)] ${dragHeight === null ? "transition-[height] duration-300 ease-out" : ""}`}
        style={{
          height,
          paddingBottom: open ? "calc(5.5rem + env(safe-area-inset-bottom))" : "1rem",
        }}
      >
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finishDrag}
          onPointerCancel={() => {
            drag.current = null;
            dragHeightRef.current = null;
            setDragHeight(null);
          }}
          className="shrink-0 cursor-grab select-none px-5 pb-3 pt-2.5 active:cursor-grabbing"
          style={{ touchAction: "none" }}
          role="button"
          aria-expanded={open}
          aria-label={open ? "Скрыть брони свайпом вниз" : "Открыть брони свайпом вверх"}
        >
          <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-300" />
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold">Брони</h2>
              <p className="text-xs text-slate-500">
                {board ? `${board.dateLabel} · ${active.length} активных` : "Загружаем…"}
                {expectedGuests > 0 && ` · ${expectedGuests} гостей`}
              </p>
            </div>
            <ChevronUp
              size={20}
              className={`text-slate-400 transition-transform duration-300 ${open ? "rotate-180" : ""}`}
            />
          </div>
        </div>

        <div
          className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 ${stale ? "opacity-70" : ""}`}
        >
          <button
            type="button"
            onClick={onCreate}
            className="mb-3 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 py-3.5 font-semibold text-white transition-transform active:scale-[.99]"
          >
            <Plus size={18} /> Новая бронь
          </button>

          <div className="mb-3 grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => onToggle(true)}
              className="rounded-2xl bg-slate-50 p-2.5 text-left active:bg-slate-100"
            >
              <CalendarDays size={15} className="text-slate-500" />
              <span className="mt-1 block text-base font-bold tabular-nums">{active.length}</span>
              <span className="block text-[10px] text-slate-500">Всего</span>
            </button>
            <button
              type="button"
              onClick={() => onToggle(true)}
              className="rounded-2xl bg-slate-50 p-2.5 text-left active:bg-slate-100"
            >
              <Users size={15} className="text-slate-500" />
              <span className="mt-1 block text-base font-bold tabular-nums">{expectedGuests}</span>
              <span className="block text-[10px] text-slate-500">Гостей</span>
            </button>
            <button
              type="button"
              onClick={() => onToggle(true)}
              className="rounded-2xl bg-slate-50 p-2.5 text-left active:bg-slate-100"
            >
              <Wallet size={15} className="text-slate-500" />
              <span className="mt-1 block truncate text-xs font-bold tabular-nums">
                {formatKzt(depositsTotal)}
              </span>
              <span className="block text-[10px] text-slate-500">Задатки</span>
            </button>
          </div>

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
                    className="flex min-h-16 w-full items-center gap-3 rounded-2xl bg-slate-50 p-3 text-left active:bg-slate-100"
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
