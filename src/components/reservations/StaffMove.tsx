import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { HALL_TABLES } from "../../lib/hall/layout";
import { RESERVATIONS_KEY } from "../../lib/queries/reservations";
import type { Reservation } from "../../lib/types/reservations";
export function StaffMove({
  reservation,
  onMoved,
}: {
  reservation: Reservation;
  onMoved?: (r: Reservation) => void;
}) {
  const client = useQueryClient();
  const [table, setTable] = useState(reservation.tableId ?? "A1"),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false);
  return (
    <div className="mt-5 rounded-2xl bg-white p-4">
      <p className="text-xs font-semibold uppercase text-slate-500">
        Пересадить гостя · проверка пересечений
      </p>
      <label className="mt-3 block text-sm">
        Новый стол
        <select
          className="mt-2 min-h-11 w-full rounded-xl border px-3"
          value={table}
          onChange={(e) => setTable(e.target.value)}
        >
          {HALL_TABLES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label} · {t.seats} мест
            </option>
          ))}
        </select>
      </label>
      <label className="mt-3 block text-sm">
        Причина изменения
        <input
          className="mt-2 min-h-11 w-full rounded-xl border px-3"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={300}
        />
      </label>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <button
        disabled={pending || reason.trim().length < 3}
        className="mt-3 min-h-11 w-full rounded-xl border px-3 text-sm disabled:opacity-40"
        onClick={async () => {
          setPending(true);
          setError("");
          try {
            const r = await fetch(`/api/staff/v1/reservations/${reservation.id}/move`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ tableIds: [table], reason: reason.trim() }),
            });
            const data = await r.json();
            if (!r.ok) throw new Error(data.error?.message ?? "Пересадка недоступна");
            await client.invalidateQueries({ queryKey: RESERVATIONS_KEY });
            onMoved?.(data.reservation);
            setError("");
          } catch (e) {
            setError(e instanceof Error ? e.message : "Ошибка");
          } finally {
            setPending(false);
          }
        }}
      >
        Сохранить новый стол
      </button>
    </div>
  );
}
