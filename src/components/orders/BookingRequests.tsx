import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { staffApi, useStaffRole, dateTime, controlClass } from "../../lib/dine-in-client";
import type { FloorSnapshot } from "../../lib/floor-operations";
type Request = {
  id: string;
  startsAt: string;
  guests: number;
  guestName: string;
  guestPhone: string;
  note: string;
};
export function BookingRequests() {
  const role = useStaffRole(),
    client = useQueryClient();
  const [selection, setSelection] = useState<Record<string, string>>({});
  const requests = useQuery({
    queryKey: ["booking-requests"],
    queryFn: () => staffApi<{ requests: Request[] }>("/dine-in/booking-requests"),
    refetchInterval: 4000,
  });
  const floor = useQuery({
    queryKey: ["shift-floor"],
    queryFn: () => staffApi<FloorSnapshot>("/floor"),
    refetchInterval: 15000,
  });
  const action = useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) =>
      staffApi(`/dine-in/booking-requests/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["booking-requests"] });
      void client.invalidateQueries({ queryKey: ["shift-floor"] });
    },
  });
  if (!requests.data?.requests.length && !requests.error) return null;
  const resources =
    floor.data?.zones.flatMap((z) =>
      z.resources
        .filter((r) => r.bookable && r.bookingResourceId)
        .map((r) => ({ id: r.bookingResourceId!, label: `${r.name} · ${z.name}` })),
    ) ?? [];
  return (
    <section className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <h2 className="font-semibold">
        Заявки на бронирование · {requests.data?.requests.length ?? 0}
      </h2>
      {(requests.error || action.error) && (
        <p role="alert" className="text-sm text-red-700">
          {requests.error?.message || action.error?.message}
        </p>
      )}
      {requests.data?.requests.map((r) => (
        <article key={r.id} className="rounded-xl bg-white p-3 text-sm">
          <p className="font-medium">
            {dateTime(r.startsAt)} · {r.guests} гостей · {r.guestName}
          </p>
          <a href={`tel:${r.guestPhone}`} className="mt-2 block min-h-11 content-center underline">
            {r.guestPhone}
          </a>
          {r.note && <p>{r.note}</p>}
          <p className="text-xs text-slate-500">
            Место пока не выделено. Доступность проверится при подтверждении.
          </p>
          {role === "manager" && (
            <div className="mt-3 flex flex-wrap gap-2">
              <select
                aria-label={`Место для заявки ${r.guestName}`}
                className={`${controlClass} min-w-0 grow`}
                value={selection[r.id] ?? ""}
                onChange={(e) => setSelection((s) => ({ ...s, [r.id]: e.target.value }))}
              >
                <option value="">Выберите подтверждённое место</option>
                {resources.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
              <button
                disabled={action.isPending || !selection[r.id]}
                className={controlClass}
                onClick={() =>
                  action.mutate({
                    id: r.id,
                    body: { action: "confirm", resourceId: selection[r.id] },
                  })
                }
              >
                Подтвердить бронь
              </button>
              <button
                disabled={action.isPending}
                className={controlClass}
                onClick={() =>
                  action.mutate({
                    id: r.id,
                    body: {
                      action: "reject",
                      reason:
                        "Нет подходящего места; свяжитесь с заведением для выбора другого времени",
                    },
                  })
                }
              >
                Отклонить
              </button>
            </div>
          )}
        </article>
      ))}
    </section>
  );
}
