import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { staffApi, controlClass } from "../../lib/dine-in-client";
import type {
  FloorReservationInput,
  FloorResource,
  FloorSnapshot,
} from "../../lib/floor-operations";
import {
  addMinutesIso,
  almatyDateKey,
  almatyTimeKey,
  almatyToIso,
  formatTimeAlmaty,
} from "../../lib/formatters/time";
import { operationalDate } from "../../lib/hall/operations";
import { FloorDialog } from "./FloorDialog";

export function FloorBooking({
  resource,
  at,
  duration: initialDuration,
  onClose,
}: {
  resource: FloorResource;
  at: string;
  duration: number;
  onClose: () => void;
}) {
  const [date, setDate] = useState(almatyDateKey(at)),
    [time, setTime] = useState(almatyTimeKey(at));
  const [duration, setDuration] = useState(initialDuration),
    [resourceId, setResourceId] = useState(resource.id);
  const [guestName, setName] = useState(""),
    [phone, setPhone] = useState(""),
    [guests, setGuests] = useState(2);
  const [source, setSource] = useState<FloorReservationInput["source"]>("manual"),
    [comment, setComment] = useState("");
  const key = useRef(crypto.randomUUID()),
    client = useQueryClient();
  const startsAt = date && time ? almatyToIso(date, time) : at,
    endsAt = addMinutesIso(startsAt, duration);
  const availability = useQuery({
    queryKey: ["floor-booking-availability", startsAt, endsAt],
    queryFn: ({ signal }) =>
      staffApi<FloorSnapshot>(
        `/floor?${new URLSearchParams({ date: operationalDate(startsAt), at: startsAt, endsAt })}`,
        { signal },
      ),
    staleTime: 5000,
  });
  const resources = availability.data?.zones.flatMap((zone) => zone.resources) ?? [];
  const selected = resources.find((item) => item.id === resourceId);
  const allowed =
    selected?.available &&
    selected.bookable &&
    (selected.capacity === null || selected.capacity >= guests);
  const mutation = useMutation({
    mutationFn: () =>
      staffApi("/floor/reservations", {
        method: "POST",
        body: JSON.stringify({
          resourceId,
          guestName: guestName.trim(),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          guests,
          startsAt,
          endsAt,
          source,
          comment: comment.trim(),
          idempotencyKey: key.current,
        } satisfies FloorReservationInput),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["floor"] });
      void client.invalidateQueries({ queryKey: ["reservations"] });
      onClose();
    },
    onError: () => {
      void availability.refetch();
    },
  });
  return (
    <FloorDialog
      title="Создать бронь"
      description={`${resource.name} · доступность на полный интервал`}
      onClose={onClose}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (allowed) mutation.mutate();
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs font-medium text-slate-600">
            Дата
            <input
              required
              type="date"
              aria-label="Дата новой брони"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={`${controlClass} mt-1 w-full min-w-0`}
            />
          </label>
          <label className="text-xs font-medium text-slate-600">
            Начало
            <input
              required
              type="time"
              step="900"
              aria-label="Начало новой брони"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className={`${controlClass} mt-1 w-full min-w-0`}
            />
          </label>
        </div>
        <label className="block text-xs font-medium text-slate-600">
          Продолжительность
          <select
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className={`${controlClass} mt-1 w-full`}
          >
            <option value={60}>1 час</option>
            <option value={90}>1 час 30 минут</option>
            <option value={120}>2 часа</option>
            <option value={180}>3 часа</option>
            <option value={240}>4 часа</option>
          </select>
        </label>
        <p className="text-xs text-slate-500">
          {formatTimeAlmaty(startsAt)}–{formatTimeAlmaty(endsAt)} · Asia/Almaty · проверяется весь
          интервал
        </p>
        <label className="block text-xs font-medium text-slate-600">
          Стол
          <select
            value={resourceId}
            onChange={(e) => setResourceId(e.target.value)}
            className={`${controlClass} mt-1 w-full`}
          >
            {!resources.some((item) => item.id === resource.id) && (
              <option value={resource.id}>{resource.name}</option>
            )}
            {availability.data?.zones.map((zone) => (
              <optgroup key={zone.id} label={zone.name}>
                {zone.resources.map((item) => (
                  <option
                    key={item.id}
                    value={item.id}
                    disabled={!item.available || !item.bookable}
                  >
                    {item.name} ·{" "}
                    {item.capacity ? `${item.capacity} мест` : "Вместимость не задана"} ·{" "}
                    {item.available ? "Свободен" : "Недоступен"}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        {availability.isPending && (
          <p role="status" className="text-xs text-slate-500">
            Проверяем доступность…
          </p>
        )}
        {availability.error && (
          <p role="alert" className="text-sm text-red-800">
            {availability.error.message}
          </p>
        )}
        {selected && !allowed && (
          <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
            Стол недоступен для указанного интервала или количества гостей. Выберите свободный стол
            в списке либо измените время.
          </p>
        )}
        <label className="block text-xs font-medium text-slate-600">
          Имя гостя
          <input
            required
            maxLength={100}
            autoComplete="name"
            aria-label="Имя гостя"
            value={guestName}
            onChange={(e) => setName(e.target.value)}
            className={`${controlClass} mt-1 w-full`}
          />
        </label>
        <label className="block text-xs font-medium text-slate-600">
          Телефон, если известен
          <input
            type="tel"
            autoComplete="tel"
            aria-label="Телефон гостя"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className={`${controlClass} mt-1 w-full`}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs font-medium text-slate-600">
            Гостей
            <input
              required
              type="number"
              min={1}
              max={50}
              aria-label="Количество гостей"
              value={guests}
              onChange={(e) => setGuests(Number(e.target.value))}
              className={`${controlClass} mt-1 w-full`}
            />
          </label>
          <label className="text-xs font-medium text-slate-600">
            Источник
            <select
              value={source}
              onChange={(e) => setSource(e.target.value as FloorReservationInput["source"])}
              className={`${controlClass} mt-1 w-full`}
            >
              <option value="manual">Сотрудник</option>
              <option value="phone">Телефон</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="website">Сайт</option>
              <option value="instagram">Instagram</option>
              <option value="other">Другое</option>
            </select>
          </label>
        </div>
        <label className="block text-xs font-medium text-slate-600">
          Комментарий
          <textarea
            maxLength={1000}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className={`${controlClass} mt-1 min-h-24 w-full py-3`}
          />
        </label>
        {mutation.error && (
          <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
            {mutation.error.message}
          </p>
        )}
        <button
          disabled={mutation.isPending || !allowed || !guestName.trim()}
          className="min-h-12 w-full rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-40"
        >
          {mutation.isPending ? "Сохраняем…" : "Создать бронь"}
        </button>
      </form>
    </FloorDialog>
  );
}
