import { X, Users } from "lucide-react";
import { formatKzt } from "../../lib/formatters/money";
import { MOCK_TABLES } from "./mock";

export function TableSheet({ tableId, onClose }: { tableId: string; onClose: () => void }) {
  const table = MOCK_TABLES.find((item) => item.id === tableId);
  if (!table) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/30"
      onClick={onClose}
    >
      <section
        className="w-full max-w-md rounded-t-[2rem] bg-slate-50 p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Демонстрационный стол</p>
            <h2 className="text-2xl font-bold">{table.label}</h2>
          </div>
          <button onClick={onClose} className="rounded-full bg-white p-2">
            <X size={18} />
          </button>
        </div>
        <div className="space-y-2">
          {table.bookings.length ? (
            table.bookings.map((booking) => (
              <div key={booking.start} className="rounded-2xl bg-white p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold">{booking.guest}</p>
                    <p className="text-sm text-slate-500">
                      {booking.start} – {booking.end}
                    </p>
                  </div>
                  <span className="flex items-center gap-1 text-sm text-slate-500">
                    <Users size={14} /> {booking.guests}
                  </span>
                </div>
                {booking.deposit > 0 && (
                  <p className="mt-2 text-sm text-slate-500">
                    Задаток · {formatKzt(booking.deposit)}
                  </p>
                )}
              </div>
            ))
          ) : (
            <p className="rounded-2xl bg-white p-4 text-sm text-slate-500">
              Броней нет · стол доступен весь день
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
