import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { HALL_TABLES } from "../../lib/hall/layout";
import { RESERVATIONS_KEY, tableAvailabilityQuery } from "../../lib/queries/reservations";
import type { Reservation } from "../../lib/types/reservations";

export function StaffMove({
  reservation,
  onMoved,
}: {
  reservation: Reservation;
  onMoved?: (r: Reservation) => void;
}) {
  const client = useQueryClient();
  const endsAt =
    reservation.endsAt ?? new Date(Date.parse(reservation.startsAt) + 2 * 3600_000).toISOString();
  const availability = useQuery(tableAvailabilityQuery(reservation.startsAt, endsAt));
  const [choice, setChoice] = useState(
      reservation.resourceId
        ? `resource:${reservation.resourceId}`
        : `table:${reservation.tableId ?? "A1"}`,
    ),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false);
  const resourceId = choice.startsWith("resource:") ? choice.slice("resource:".length) : null;
  const tableId = choice.startsWith("table:") ? choice.slice("table:".length) : null;

  return (
    <div className="mt-5 rounded-2xl bg-white p-4">
      <p className="text-xs font-semibold uppercase text-slate-500">
        Пересадить гостя · проверка пересечений
      </p>
      <label className="mt-3 block text-sm">
        Новое место
        <select
          className="mt-2 min-h-11 w-full rounded-xl border px-3"
          value={choice}
          onChange={(event) => setChoice(event.target.value)}
        >
          <optgroup label="Старые ID · требуют сверки">
            {HALL_TABLES.map((table) => (
              <option key={table.id} value={`table:${table.id}`}>
                {table.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Подтверждённые ресурсы">
            {availability.data?.resources.map((resource) => (
              <option
                key={resource.id}
                value={`resource:${resource.id}`}
                disabled={!resource.available && resource.id !== reservation.resourceId}
              >
                {resource.zoneName} · {resource.name} · {resource.capacity} мест
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      <label className="mt-3 block text-sm">
        Причина изменения
        <input
          className="mt-2 min-h-11 w-full rounded-xl border px-3"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
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
            const response = await fetch(`/api/staff/v1/reservations/${reservation.id}/move`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ...(resourceId ? { resourceId } : { tableIds: [tableId] }),
                reason: reason.trim(),
              }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error?.message ?? "Пересадка недоступна");
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
        Сохранить новое место
      </button>
    </div>
  );
}
