import { useEffect, useState } from "react";
import { GuestCrmTools } from "./GuestCrmTools";
type Guest = {
  id: string;
  name: string;
  phone: string | null;
  provisional: boolean;
  source?: string;
  reservations: number;
  visits: number;
};
type GuestBooking = {
  id: string;
  startsAt: string;
  status: string;
  tableIds: string[];
  guests: number;
};
export function GuestsScreen() {
  const [guests, setGuests] = useState<Guest[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<Guest | null>(null),
    [bookings, setBookings] = useState<GuestBooking[]>([]),
    [query, setQuery] = useState(""),
    [reservationId, setReservationId] = useState(""),
    [reason, setReason] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/staff/v1/guests", { cache: "no-store", signal: controller.signal })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error?.message ?? "Гости недоступны");
        setGuests(body.guests);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);
  async function open(guest: Guest) {
    setSelected(guest);
    setBookings([]);
    setError("");
    try {
      const r = await fetch(`/api/staff/v1/guests/${guest.id}`, { cache: "no-store" });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error?.message ?? "История недоступна");
      setBookings(body.reservations);
    } catch (e) {
      setError(e instanceof Error ? e.message : "История недоступна");
    }
  }
  return (
    <div className="mx-auto max-w-3xl px-4 pb-24 pt-6">
      <p className="text-xs uppercase tracking-wide text-slate-500">Гости XOXO</p>
      <h1 className="mt-2 text-2xl font-semibold">Гостевые аккаунты</h1>
      <label className="mt-5 block text-sm">
        Найти по имени или телефону
        <input
          className="mt-2 min-h-11 w-full rounded-xl border px-3"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <GuestCrmTools
        key={selected?.id ?? "new"}
        selected={selected}
        onSaved={() => {
          void fetch("/api/staff/v1/guests", { cache: "no-store" })
            .then(async (r) => {
              const data = await r.json();
              if (!r.ok) throw new Error(data.error?.message ?? "Не удалось обновить гостей");
              setGuests(data.guests);
              if (selected)
                setSelected(data.guests.find((g: Guest) => g.id === selected.id) ?? null);
            })
            .catch((e) => setError(e.message));
        }}
      />
      {error && (
        <p role="alert" className="mt-4 text-sm text-red-700">
          {error}
        </p>
      )}
      {loading ? (
        <p className="mt-5" role="status">
          Загрузка…
        </p>
      ) : (
        <div className="mt-5 space-y-2">
          {guests
            .filter((g) => `${g.name} ${g.phone ?? ""}`.toLowerCase().includes(query.toLowerCase()))
            .map((g) => (
              <button
                key={g.id}
                onClick={() => void open(g)}
                className="min-h-16 w-full rounded-2xl bg-white p-4 text-left"
              >
                <span className="font-medium">{g.name}</span>
                {g.source && <span className="ml-2 text-xs text-slate-400">{g.source}</span>}
                <span className="mt-1 block text-xs text-slate-500">
                  {g.provisional ? "Телефон не подтверждён" : "WhatsApp identity подтверждена"} ·{" "}
                  {g.reservations} броней · {g.visits} подтверждённых визитов
                </span>
              </button>
            ))}
          {!guests.length && <p className="text-sm text-slate-500">Аккаунтов пока нет</p>}
        </div>
      )}
      {selected && (
        <section className="mt-6 rounded-2xl bg-white p-5">
          <h2 className="text-xl font-medium">{selected.name}</h2>
          <p className="mt-2 text-sm">{selected.phone}</p>
          <p className="mt-1 break-all text-xs text-slate-500">Guest ID: {selected.id}</p>
          <div className="mt-4 space-y-3">
            {bookings.map((b) => (
              <div key={b.id} className="rounded-xl border p-3 text-sm">
                <p>
                  {new Intl.DateTimeFormat("ru-RU", {
                    timeZone: "Asia/Almaty",
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(b.startsAt))}{" "}
                  · {b.status}
                </p>
                <p className="mt-1">
                  {b.guests} гостей · {(b.tableIds ?? []).join(" + ")}
                </p>
                <p className="mt-1 break-all text-xs text-slate-500">{b.id}</p>
              </div>
            ))}
          </div>
          {!selected.provisional && (
            <div className="mt-6 border-t pt-4">
              <p className="text-sm font-medium">Привязать старую бронь · только менеджер</p>
              <p className="mt-2 text-xs text-slate-500">
                Нужна проверенная принадлежность старой записи этому гостю; номер должен совпасть с
                verified identity. Другие verified аккаунты не объединяются.
              </p>
              <label className="mt-3 block text-sm">
                Reservation ID
                <input
                  className="mt-1 min-h-11 w-full rounded-xl border px-3"
                  value={reservationId}
                  onChange={(e) => setReservationId(e.target.value)}
                />
              </label>
              <label className="mt-3 block text-sm">
                Основание проверки
                <input
                  className="mt-1 min-h-11 w-full rounded-xl border px-3"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <button
                className="mt-3 min-h-11 rounded-xl border px-4 text-sm"
                disabled={reason.trim().length < 10}
                onClick={async () => {
                  try {
                    const r = await fetch(`/api/staff/v1/guests/${selected.id}/link-reservation`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ reservationId, reason: reason.trim() }),
                    });
                    const body = await r.json();
                    if (!r.ok) throw new Error(body.error?.message ?? "Привязка недоступна");
                    setReason("");
                    setReservationId("");
                    await open(selected);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Ошибка привязки");
                  }
                }}
              >
                Привязать с записью в аудит
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
