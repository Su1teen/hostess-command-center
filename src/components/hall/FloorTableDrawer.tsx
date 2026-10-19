import { useRef, useState } from "react";
import { openStaffOrder } from "../orders/ServiceOperations";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Clock3, ExternalLink, Users } from "lucide-react";
import { staffApi, controlClass } from "../../lib/dine-in-client";
import type {
  FloorEvent,
  FloorReservation,
  FloorResource,
  FloorSession,
  FloorSnapshot,
  ReleaseInput,
  SeatInput,
} from "../../lib/floor-operations";
import {
  addMinutesIso,
  almatyDateKey,
  almatyTimeKey,
  almatyToIso,
  formatDateTimeAlmaty,
  formatTimeAlmaty,
} from "../../lib/formatters/time";
import {
  RESERVATION_SOURCE_LABEL,
  RESERVATION_STATUS_LABEL,
  type ReservationSource,
} from "../../lib/types/reservations";
import { FloorDialog } from "./FloorDialog";
import { operationalDate } from "../../lib/hall/operations";
import { FloorFolio } from "./FloorFolio";
import { FLOOR_STATE_LABEL, FLOOR_STATE_STYLE } from "../../lib/hall/presentation";

function BookingSummary({
  reservation,
  onOpen,
}: {
  reservation: FloorReservation;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className="w-full rounded-xl border border-blue-100 bg-blue-50/50 p-3 text-left"
      onClick={onOpen}
    >
      <span className="block text-sm font-semibold">
        {formatTimeAlmaty(reservation.startsAt)}–{formatTimeAlmaty(reservation.endsAt)} ·{" "}
        {reservation.guestName || "Имя не указано"}
      </span>
      <span className="mt-1 block text-xs text-slate-500">
        {reservation.guests} гостей · {RESERVATION_STATUS_LABEL[reservation.status]}
      </span>
    </button>
  );
}
function VisitSummary({ session, onOpen }: { session: FloorSession; onOpen: () => void }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3 text-sm">
      <p className="font-semibold">
        {session.seatedAt ? "Гости на месте" : "QR-активность · посадка не подтверждена"}
      </p>
      <p className="mt-2 text-xs text-slate-600">
        {session.guestName ?? "Гость без аккаунта"}
        {session.guests ? ` · ${session.guests} гостей` : ""}
      </p>
      <p className="mt-1 text-xs text-slate-500">
        {session.seatedAt ? "Посадка" : "Начало активности"}:{" "}
        {formatDateTimeAlmaty(session.seatedAt ?? session.openedAt)}
      </p>
      {session.expectedEndAt && (
        <p className="mt-1 text-xs text-slate-500">
          Ожидаемое освобождение: {formatDateTimeAlmaty(session.expectedEndAt)}
        </p>
      )}
      <p className="mt-2 text-xs">
        Заказов: {session.orderCount} · активных: {session.activeOrderCount}
      </p>
      <button
        type="button"
        onClick={onOpen}
        className="mt-3 min-h-11 w-full rounded-lg bg-white px-3 text-left text-sm font-medium"
      >
        Открыть фолио визита →
      </button>
    </div>
  );
}

export function FloorTableDrawer({
  resource,
  zoneName,
  at,
  now,
  live,
  canWrite,
  canManage,
  event,
  onClose,
  onBook,
  onTimeline,
}: {
  resource: FloorResource;
  zoneName: string;
  at: string;
  now: string;
  live: boolean;
  canWrite: boolean;
  canManage: boolean;
  event?: FloorEvent | null;
  onClose: () => void;
  onBook: () => void;
  onTimeline: () => void;
}) {
  const client = useQueryClient(),
    current = resource.currentSession;
  const actualVisit =
    resource.projectedSession ??
    resource.sessions.find(
      (session) => session.seatedAt && !session.closedAt && session.seatedAt <= now,
    );
  const forecasting = !live && Date.parse(at) > Date.parse(now);
  const [selectedReservation, setReservation] = useState<string | null>(
    event?.reservationId ?? null,
  );
  const [folioId, setFolio] = useState<string | null>(event?.sessionId ?? null);
  const [seating, setSeating] = useState(false),
    [guests, setGuests] = useState(current?.guests ?? resource.currentReservation?.guests ?? 2);
  const [release, setRelease] = useState<FloorSession | null>(null),
    [reason, setReason] = useState("");
  const [expectedDate, setExpectedDate] = useState(almatyDateKey(addMinutesIso(now, 120))),
    [expectedTime, setExpectedTime] = useState(almatyTimeKey(addMinutesIso(now, 120)));
  const idempotency = useRef(crypto.randomUUID());
  const mutation = useMutation({
    mutationFn: ({ path, data }: { path: string; data: unknown }) =>
      staffApi(path, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      idempotency.current = crypto.randomUUID();
      setSeating(false);
      setRelease(null);
      setReason("");
      void client.invalidateQueries({ queryKey: ["floor"] });
      void client.invalidateQueries({ queryKey: ["floor-folio"] });
      void client.invalidateQueries({ queryKey: ["reservations"] });
    },
  });
  const style = FLOOR_STATE_STYLE[resource.state];
  const focusedReservation = resource.reservations.find((item) => item.id === selectedReservation);
  const nextMinutes = resource.nextReservation
    ? Math.ceil((Date.parse(resource.nextReservation.startsAt) - Date.parse(now)) / 60000)
    : null;
  const activeSession =
    resource.sessions.find((item) => item.id === folioId) ??
    (current?.id === folioId ? current : null);
  const expectedIso = expectedDate && expectedTime ? almatyToIso(expectedDate, expectedTime) : null;
  const canSeat =
    live &&
    canWrite &&
    resource.enabled &&
    resource.relationship !== "pending" &&
    !current?.seatedAt;
  const bookable = canManage && resource.bookable;
  return (
    <FloorDialog
      title={resource.name}
      description={`${zoneName} · ${resource.capacity ? `${resource.capacity} мест` : "Вместимость не задана"}`}
      onClose={onClose}
    >
      <div className="space-y-5">
        <div
          className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-medium"
          style={{ background: style.fill, color: style.text }}
        >
          <span aria-hidden>{style.mark}</span>
          {FLOOR_STATE_LABEL[resource.state]}
        </div>
        {!live && (
          <p className="rounded-xl bg-slate-100 p-3 text-xs text-slate-600">
            {forecasting ? "Плановый прогноз" : "Исторический просмотр"}: {formatDateTimeAlmaty(at)}
            . {forecasting && "Ожидаемое освобождение не подтверждает фактический уход гостей. "}
            Чтобы подтвердить фактическую посадку или освобождение, вернитесь в режим «Сейчас».
          </p>
        )}
        {forecasting && actualVisit && actualVisit.id !== current?.id && (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Фактически сейчас · визит ещё открыт
            </h3>
            <VisitSummary
              session={actualVisit}
              onOpen={() => {
                setFolio(actualVisit.id);
                setReservation(null);
              }}
            />
          </section>
        )}
        {resource.state === "free" && !resource.available && (
          <p className="rounded-xl bg-blue-50 p-3 text-xs text-blue-900">
            В выбранный момент стол свободен, но на полный запрошенный интервал есть ограничение.
            Проверьте расписание перед созданием брони.
          </p>
        )}
        {event?.source === "hold" && (
          <section className="rounded-xl border bg-white p-3">
            <h3 className="text-sm font-semibold">Временное удержание</h3>
            <p className="mt-2 text-xs text-slate-600">
              {formatDateTimeAlmaty(event.startsAt)}–{formatDateTimeAlmaty(event.endsAt)}
            </p>
            <p className="mt-2 break-all text-[10px] text-slate-400">hostess_holds · {event.id}</p>
          </section>
        )}
        {!!resource.warnings.length && (
          <div className="rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
            {resource.warnings.map((warning) => (
              <p key={warning} className="mb-1 last:mb-0">
                {warning}
              </p>
            ))}
          </div>
        )}
        {current && (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Текущий визит
            </h3>
            <VisitSummary
              session={current}
              onOpen={() => {
                setFolio(current.id);
                setReservation(null);
              }}
            />
          </section>
        )}
        {resource.currentReservation && (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Бронь на выбранное время
            </h3>
            <BookingSummary
              reservation={resource.currentReservation}
              onOpen={() => {
                setReservation(resource.currentReservation!.id);
                setFolio(null);
              }}
            />
          </section>
        )}
        {resource.nextReservation && (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Следующая бронь
            </h3>
            <BookingSummary
              reservation={resource.nextReservation}
              onOpen={() => {
                setReservation(resource.nextReservation!.id);
                setFolio(null);
              }}
            />
            {live && nextMinutes !== null && (
              <p
                className={`mt-2 flex items-center gap-1 text-xs ${current && nextMinutes <= 30 ? "text-rose-800" : "text-slate-500"}`}
              >
                <Clock3 size={13} />
                {nextMinutes > 0
                  ? `До следующей брони ${nextMinutes} мин`
                  : "Время следующей брони наступило"}
              </p>
            )}
            {current?.expectedEndAt &&
              Date.parse(current.expectedEndAt) > Date.parse(resource.nextReservation.startsAt) && (
                <p className="mt-2 rounded-xl bg-rose-50 p-3 text-xs text-rose-800">
                  Ожидаемый визит пересекает следующую бронь. Освобождение стола и решение конфликта
                  подтверждает сотрудник.
                </p>
              )}
          </section>
        )}
        <div className="grid grid-cols-2 gap-2">
          {canWrite && current?.seatedAt && live && (
            <button
              className={`${controlClass} col-span-2`}
              onClick={() => openStaffOrder(current.id)}
            >
              Создать заказ / код гостю
            </button>
          )}
          {bookable && (
            <button
              type="button"
              className={`${controlClass} col-span-2 bg-slate-900! text-white`}
              onClick={onBook}
            >
              Создать бронь
            </button>
          )}
          {canSeat && (
            <button
              type="button"
              className={`${controlClass} col-span-2`}
              onClick={() => {
                mutation.reset();
                setSeating((value) => !value);
              }}
            >
              Посадить гостей
            </button>
          )}
          {live && canWrite && current && (
            <button
              type="button"
              className={`${controlClass} col-span-2`}
              onClick={() => {
                mutation.reset();
                setRelease((value) => (value ? null : current));
              }}
            >
              Завершить визит
            </button>
          )}
          <a
            href={resource.qrUrl}
            target="_blank"
            rel="noreferrer"
            className={`${controlClass} flex items-center justify-center gap-1`}
          >
            Открыть QR <ExternalLink size={12} />
          </a>
          <button
            type="button"
            className={`${controlClass} flex items-center justify-center gap-1`}
            onClick={onTimeline}
          >
            <CalendarDays size={14} />
            Расписание
          </button>
        </div>
        {seating && (
          <form
            className="space-y-3 rounded-xl border bg-white p-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!expectedIso) return;
              mutation.mutate({
                path: "/floor/seat",
                data: {
                  resourceId: resource.id,
                  ...(focusedReservation
                    ? { reservationId: focusedReservation.id }
                    : resource.currentReservation
                      ? { reservationId: resource.currentReservation.id }
                      : {}),
                  guests,
                  expectedEndAt: expectedIso,
                  idempotencyKey: idempotency.current,
                } satisfies SeatInput,
              });
            }}
          >
            <h3 className="text-sm font-semibold">Подтвердить фактическую посадку</h3>
            <label className="block text-xs">
              Количество гостей
              <input
                required
                type="number"
                min={1}
                max={resource.capacity ?? 50}
                value={guests}
                onChange={(e) => setGuests(Number(e.target.value))}
                className={`${controlClass} mt-1 w-full`}
              />
            </label>
            <p className="text-xs text-slate-500">Ожидаемое освобождение</p>
            <div className="grid grid-cols-2 gap-2">
              <input
                required
                type="date"
                aria-label="Дата ожидаемого освобождения"
                value={expectedDate}
                onChange={(e) => setExpectedDate(e.target.value)}
                className={`${controlClass} min-w-0`}
              />
              <input
                required
                type="time"
                aria-label="Время ожидаемого освобождения"
                value={expectedTime}
                onChange={(e) => setExpectedTime(e.target.value)}
                className={`${controlClass} min-w-0`}
              />
            </div>
            <button
              disabled={
                mutation.isPending || !expectedIso || Date.parse(expectedIso) <= Date.parse(now)
              }
              className="min-h-11 w-full rounded-xl bg-slate-900 px-3 text-sm font-semibold text-white disabled:opacity-40"
            >
              Подтвердить посадку
            </button>
          </form>
        )}
        {release && (
          <form
            className="space-y-3 rounded-xl border bg-white p-4"
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate({
                path: `/floor/sessions/${release.id}/release`,
                data: {
                  reason: reason.trim(),
                  version: release.version,
                  idempotencyKey: idempotency.current,
                } satisfies ReleaseInput,
              });
            }}
          >
            <h3 className="text-sm font-semibold">Гости освободили стол</h3>
            <p className="text-xs text-slate-500">
              Визит от {formatDateTimeAlmaty(release.seatedAt ?? release.openedAt)} ·{" "}
              {release.guestName ?? "Гость без аккаунта"}
            </p>
            {release.activeOrderCount > 0 && (
              <p className="text-xs text-amber-900">
                Остались активные заказы: {release.activeOrderCount}. Они сохранятся в фолио этого
                визита.
              </p>
            )}
            <label className="block text-xs">
              Комментарий к завершению
              <input
                required
                minLength={3}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className={`${controlClass} mt-1 w-full`}
              />
            </label>
            <button
              disabled={mutation.isPending || reason.trim().length < 3}
              className="min-h-11 w-full rounded-xl bg-slate-900 px-3 text-sm font-semibold text-white disabled:opacity-40"
            >
              Подтвердить освобождение
            </button>
          </form>
        )}
        {mutation.error && (
          <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
            {mutation.error.message}
          </p>
        )}
        {focusedReservation && (
          <FloorReservationDetail
            key={focusedReservation.id}
            reservation={focusedReservation}
            resource={resource}
            canWrite={canManage}
            onSeat={
              canSeat
                ? () => {
                    setGuests(focusedReservation.guests);
                    setSeating(true);
                  }
                : undefined
            }
            onVisit={(id) => {
              setFolio(id);
              setReservation(null);
            }}
          />
        )}
        {folioId && (
          <>
            <div className="border-t pt-4">
              {activeSession?.closedAt && (
                <p className="mb-3 text-xs text-slate-500">
                  Исторический визит · завершён {formatDateTimeAlmaty(activeSession.closedAt)}
                </p>
              )}
              <FloorFolio sessionId={folioId} />
            </div>
          </>
        )}
        <details className="border-t pt-4">
          <summary className="cursor-pointer text-sm font-medium">
            Брони и визиты за операционный день
          </summary>
          <div className="mt-3 space-y-2">
            {resource.reservations.map((reservation) => (
              <BookingSummary
                key={reservation.id}
                reservation={reservation}
                onOpen={() => {
                  setReservation(reservation.id);
                  setFolio(null);
                }}
              />
            ))}
            {resource.sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                className={`${controlClass} w-full text-left`}
                onClick={() => {
                  setFolio(session.id);
                  setReservation(null);
                }}
              >
                Визит · {formatTimeAlmaty(session.seatedAt ?? session.openedAt)} ·{" "}
                {session.orderCount} заказов{session.closedAt ? " · завершён" : ""}
              </button>
            ))}
            {!resource.reservations.length && !resource.sessions.length && (
              <p className="text-xs text-slate-500">На этот день броней и визитов нет.</p>
            )}
          </div>
        </details>
      </div>
    </FloorDialog>
  );
}

function FloorReservationDetail({
  reservation,
  resource,
  canWrite,
  onSeat,
  onVisit,
}: {
  reservation: FloorReservation;
  resource: FloorResource;
  canWrite: boolean;
  onSeat?: () => void;
  onVisit: (id: string) => void;
}) {
  const [reason, setReason] = useState(""),
    [editing, setEditing] = useState(false);
  const [date, setDate] = useState(almatyDateKey(reservation.startsAt)),
    [time, setTime] = useState(almatyTimeKey(reservation.startsAt));
  const [endDate, setEndDate] = useState(almatyDateKey(reservation.endsAt)),
    [endTime, setEndTime] = useState(almatyTimeKey(reservation.endsAt));
  const [targetId, setTargetId] = useState(resource.id);
  const changedStart = date && time ? almatyToIso(date, time) : reservation.startsAt;
  const changedEnd = endDate && endTime ? almatyToIso(endDate, endTime) : reservation.endsAt;
  const availability = useQuery({
    queryKey: ["floor-reschedule", changedStart, changedEnd],
    enabled: editing && Date.parse(changedEnd) > Date.parse(changedStart),
    queryFn: ({ signal }) =>
      staffApi<FloorSnapshot>(
        `/floor?${new URLSearchParams({ date: operationalDate(changedStart), at: changedStart, endsAt: changedEnd })}`,
        { signal },
      ),
  });
  const client = useQueryClient(),
    key = useRef(crypto.randomUUID());
  const editingVersion = useRef(reservation.version);
  const mutation = useMutation({
    mutationFn: (change: Record<string, unknown>) =>
      staffApi(`/floor/reservations/${reservation.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...change,
          version: editingVersion.current,
          reason: reason.trim(),
          idempotencyKey: key.current,
        }),
      }),
    onSuccess: () => {
      key.current = crypto.randomUUID();
      setEditing(false);
      setReason("");
      void client.invalidateQueries({ queryKey: ["floor"] });
      void client.invalidateQueries({ queryKey: ["reservations"] });
    },
  });
  const linkedSession = resource.sessions.find(
    (session) => session.reservationId === reservation.id,
  );
  return (
    <section className="space-y-3 border-t pt-5" aria-label="Полная карточка брони">
      <h3 className="font-semibold">Бронь · {reservation.guestName || "Имя не указано"}</h3>
      <p className="text-sm">
        {formatDateTimeAlmaty(reservation.startsAt)}–{formatDateTimeAlmaty(reservation.endsAt)}
      </p>
      <p className="flex items-center gap-1 text-xs text-slate-500">
        <Users size={13} />
        {reservation.guests} гостей · {RESERVATION_STATUS_LABEL[reservation.status]} ·{" "}
        {RESERVATION_SOURCE_LABEL[reservation.source as ReservationSource] ?? reservation.source}
      </p>
      {reservation.phone && (
        <a className="block min-h-8 text-sm" href={`tel:${reservation.phone}`}>
          {reservation.phone}
        </a>
      )}
      {reservation.guestId && (
        <a
          className="block text-sm underline"
          href={`/guests?guest=${encodeURIComponent(reservation.guestId)}`}
        >
          Открыть профиль гостя
        </a>
      )}
      {reservation.comment && (
        <p className="rounded-xl bg-white p-3 text-sm text-slate-600">{reservation.comment}</p>
      )}
      {!!reservation.preorders.length && (
        <div className="rounded-xl bg-white p-3">
          <p className="mb-2 text-xs font-semibold">Предзаказ</p>
          {reservation.preorders.map((item, index) => (
            <p key={index} className="mt-1 text-sm">
              {item.quantity} × {item.productName}
              {item.comment ? ` · ${item.comment}` : ""}
            </p>
          ))}
        </div>
      )}
      {linkedSession && (
        <button
          type="button"
          className={`${controlClass} w-full`}
          onClick={() => onVisit(linkedSession.id)}
        >
          Открыть связанный визит
        </button>
      )}
      {canWrite && !["cancelled", "no_show"].includes(reservation.status) && (
        <div className="space-y-3">
          {onSeat && (
            <button type="button" className={`${controlClass} w-full`} onClick={onSeat}>
              Отметить приход по брони
            </button>
          )}
          <button
            type="button"
            className={`${controlClass} w-full`}
            onClick={() => {
              if (!editing) {
                editingVersion.current = reservation.version;
                setDate(almatyDateKey(reservation.startsAt));
                setTime(almatyTimeKey(reservation.startsAt));
                setEndDate(almatyDateKey(reservation.endsAt));
                setEndTime(almatyTimeKey(reservation.endsAt));
                setTargetId(resource.id);
                mutation.reset();
              }
              setEditing((value) => !value);
            }}
          >
            Изменить время / статус брони
          </button>
          {editing && (
            <div className="space-y-3 rounded-xl border bg-white p-3">
              <label className="block text-xs">
                Стол
                <select
                  aria-label="Новое место брони"
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                  className={`${controlClass} mt-1 w-full`}
                >
                  <option value={resource.id}>{resource.name} · текущее место</option>
                  {availability.data?.zones.map((zone) => (
                    <optgroup key={zone.id} label={zone.name}>
                      {zone.resources
                        .filter((item) => item.id !== resource.id)
                        .map((item) => (
                          <option
                            key={item.id}
                            value={item.id}
                            disabled={
                              !item.available ||
                              !item.bookable ||
                              (item.capacity !== null && item.capacity < reservation.guests)
                            }
                          >
                            {item.name} · {item.available ? "Свободен" : "Недоступен"}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label className="block text-xs">
                Начало
                <div className="mt-1 grid grid-cols-2 gap-2">
                  <input
                    type="date"
                    aria-label="Новая дата брони"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className={`${controlClass} min-w-0`}
                  />
                  <input
                    type="time"
                    aria-label="Новое время брони"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    className={`${controlClass} min-w-0`}
                  />
                </div>
              </label>
              <label className="block text-xs">
                Завершение
                <div className="mt-1 grid grid-cols-2 gap-2">
                  <input
                    type="date"
                    aria-label="Новая дата завершения брони"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className={`${controlClass} min-w-0`}
                  />
                  <input
                    type="time"
                    aria-label="Новое время завершения брони"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className={`${controlClass} min-w-0`}
                  />
                </div>
              </label>
              <label className="block text-xs">
                Причина изменения
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={500}
                  className={`${controlClass} mt-1 w-full`}
                />
              </label>
              <button
                type="button"
                disabled={
                  mutation.isPending ||
                  reason.trim().length < 3 ||
                  !date ||
                  !time ||
                  !endDate ||
                  !endTime
                }
                className={`${controlClass} w-full`}
                onClick={() =>
                  mutation.mutate({
                    startsAt: almatyToIso(date, time),
                    endsAt: almatyToIso(endDate, endTime),
                    ...(targetId !== resource.id ? { resourceId: targetId } : {}),
                  })
                }
              >
                Сохранить новый интервал
              </button>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["confirmed", "Подтвердить"],
                    ["expected", "Ожидается"],
                    ["no_show", "Не пришли"],
                    ["cancelled", "Отменить с причиной"],
                  ] as const
                ).map(([status, label]) => (
                  <button
                    type="button"
                    key={status}
                    disabled={mutation.isPending || reason.trim().length < 3}
                    className={controlClass}
                    onClick={() => mutation.mutate({ status })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {mutation.error && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
          {mutation.error.message}
        </p>
      )}
      <p className="break-all text-[10px] text-slate-400">
        command_center_reservations · {reservation.id}
      </p>
    </section>
  );
}
