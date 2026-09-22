import { useMemo, useState } from "react";
import { Plus, Users } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import {
  addMinutesIso,
  almatyToIso,
  formatDateKeyHuman,
  formatTimeAlmaty,
} from "../../lib/formatters/time";
import { DEFAULT_RESERVATION_MINUTES, HALL_TABLES } from "../../lib/hall/layout";
import { tableAvailabilityQuery } from "../../lib/queries/reservations";
import type {
  DepositStatus,
  ReservationSource,
  TableOccupancy,
} from "../../lib/types/reservations";
import { BottomSheet } from "../shared/BottomSheet";
import { DateTimeWheel } from "../shared/DateTimeWheel";
import { ErrorBanner } from "../shared/ErrorBanner";

interface FormValues {
  guestName: string;
  phone: string;
  guests: number;
  source: ReservationSource;
  depositAmount: number;
  depositStatus: DepositStatus;
  comment: string;
}
interface Preorder {
  productName: string;
  quantity: number;
  unitPrice: number;
  comment?: string;
}

export interface CreateReservationValues extends FormValues {
  tableId: string;
  startsAt: string;
  endsAt: string;
  preorders: Preorder[];
}

const DURATIONS = [60, 90, 120, 180, 240];

const TABLE_STYLE: Record<TableOccupancy | "selected", string> = {
  free: "bg-[#EEF4EF] text-slate-800 active:bg-[#dfe9e1]",
  booked: "bg-rose-50 text-rose-300 line-through",
  seated: "bg-amber-50 text-amber-300 line-through",
  selected: "bg-slate-900 text-white shadow-md",
};

export function CreateReservationSheet({
  initialDate,
  initialTime,
  initialTableId,
  onClose,
  onSubmit,
  pending,
  serverError,
}: {
  initialDate: string;
  initialTime: string;
  initialTableId?: string | null;
  onClose: () => void;
  onSubmit: (values: CreateReservationValues) => void;
  pending?: boolean;
  serverError?: string | null;
}) {
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState(initialTime);
  const [duration, setDuration] = useState(DEFAULT_RESERVATION_MINUTES);
  const [tableId, setTableId] = useState<string | null>(initialTableId ?? null);
  const [tableError, setTableError] = useState(false);
  const [preorders, setPreorders] = useState<Preorder[]>([]);

  const startsAt = useMemo(() => almatyToIso(date, time), [date, time]);
  const endsAt = useMemo(() => addMinutesIso(startsAt, duration), [startsAt, duration]);
  const availability = useQuery(tableAvailabilityQuery(startsAt, endsAt));
  const statusOf = useMemo(() => {
    const map = new Map<string, TableOccupancy>();
    availability.data?.tables.forEach((entry) => map.set(entry.tableId, entry.status));
    return map;
  }, [availability.data]);

  const selectedStatus = tableId ? (statusOf.get(tableId) ?? "free") : null;
  const selectedBlocked = selectedStatus !== null && selectedStatus !== "free";

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: { guests: 2, source: "manual", depositAmount: 0, depositStatus: "none" },
  });

  return (
    <BottomSheet eyebrow="Новая бронь" title="Добавить гостя" onClose={onClose}>
      <form
        onSubmit={handleSubmit((values) => {
          if (!tableId || selectedBlocked) {
            setTableError(true);
            return;
          }
          onSubmit({
            ...values,
            guests: Number(values.guests),
            depositAmount: Number(values.depositAmount),
            tableId,
            startsAt,
            endsAt,
            preorders,
          });
        })}
        className="space-y-4 pb-2"
      >
        <section>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Дата и время
          </p>
          <DateTimeWheel
            date={date}
            time={time}
            onChange={(next) => {
              setDate(next.date);
              setTime(next.time);
            }}
          />
          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="flex gap-1.5 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
              {DURATIONS.map((minutes) => (
                <button
                  type="button"
                  key={minutes}
                  onClick={() => setDuration(minutes)}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${
                    duration === minutes ? "bg-slate-900 text-white" : "bg-white text-slate-600"
                  }`}
                >
                  {minutes % 60 === 0 ? `${minutes / 60} ч` : `${minutes} мин`}
                </button>
              ))}
            </div>
          </div>
          <p className="mt-2 text-sm text-slate-600">
            {formatDateKeyHuman(date)} · {formatTimeAlmaty(startsAt)} – {formatTimeAlmaty(endsAt)}
          </p>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Стол</p>
            {availability.isFetching && (
              <span className="text-[11px] text-slate-400">Обновляем…</span>
            )}
          </div>
          <div className="grid grid-cols-4 gap-2">
            {HALL_TABLES.map((table) => {
              const status = statusOf.get(table.id) ?? "free";
              const selected = tableId === table.id;
              const disabled = status !== "free";
              return (
                <button
                  type="button"
                  key={table.id}
                  disabled={disabled && !selected}
                  onClick={() => {
                    setTableId(table.id);
                    setTableError(false);
                  }}
                  className={`flex flex-col items-center rounded-2xl py-2.5 text-sm font-semibold transition-colors ${
                    TABLE_STYLE[selected ? "selected" : status]
                  } disabled:cursor-not-allowed`}
                >
                  {table.label}
                  <span
                    className={`mt-0.5 flex items-center gap-0.5 text-[10px] font-medium ${selected ? "text-slate-300" : "opacity-70"}`}
                  >
                    <Users size={10} /> {table.seats}
                  </span>
                </button>
              );
            })}
          </div>
          {selectedBlocked && (
            <p className="mt-2 text-xs text-rose-600">
              Этот стол занят на выбранное время — выберите другое время или стол
            </p>
          )}
          {tableError && !tableId && <p className="mt-2 text-xs text-rose-600">Выберите стол</p>}
        </section>

        <section className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Гость</p>
          <input
            {...register("guestName", { required: true })}
            placeholder="Имя гостя"
            className="field"
            autoComplete="off"
          />
          {errors.guestName && <p className="text-xs text-rose-600">Введите имя</p>}
          <input
            {...register("phone", { required: true, minLength: 5 })}
            placeholder="Телефон"
            type="tel"
            inputMode="tel"
            className="field"
          />
          {errors.phone && <p className="text-xs text-rose-600">Введите телефон</p>}
          <div className="grid grid-cols-2 gap-2">
            <input
              type="number"
              inputMode="numeric"
              {...register("guests", { valueAsNumber: true, min: 1 })}
              placeholder="Гостей"
              className="field"
            />
            <select {...register("source")} className="field">
              <option value="manual">Вручную</option>
              <option value="phone">Телефон</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="instagram">Instagram</option>
              <option value="website">Сайт</option>
              <option value="other">Другое</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="number"
              inputMode="numeric"
              {...register("depositAmount", { valueAsNumber: true, min: 0 })}
              placeholder="Задаток, KZT"
              className="field"
            />
            <select {...register("depositStatus")} className="field">
              <option value="none">Без задатка</option>
              <option value="pending">Ожидается</option>
              <option value="paid">Получен</option>
            </select>
          </div>
          <textarea
            {...register("comment")}
            placeholder="Комментарий"
            className="field min-h-20 resize-none"
          />
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Предзаказ
            </p>
            <button
              type="button"
              onClick={() =>
                setPreorders((items) => [...items, { productName: "", quantity: 1, unitPrice: 0 }])
              }
              className="flex items-center gap-1 text-xs font-semibold text-slate-700"
            >
              <Plus size={14} /> Добавить
            </button>
          </div>
          {preorders.map((item, index) => (
            <div key={index} className="mb-2 grid grid-cols-[1fr_52px_80px_28px] gap-1">
              <input
                value={item.productName}
                onChange={(event) =>
                  setPreorders((items) =>
                    items.map((row, i) =>
                      i === index ? { ...row, productName: event.target.value } : row,
                    ),
                  )
                }
                placeholder="Позиция"
                className="field min-w-0"
              />
              <input
                type="number"
                min="1"
                value={item.quantity}
                onChange={(event) =>
                  setPreorders((items) =>
                    items.map((row, i) =>
                      i === index ? { ...row, quantity: Number(event.target.value) } : row,
                    ),
                  )
                }
                className="field"
              />
              <input
                type="number"
                min="0"
                value={item.unitPrice}
                onChange={(event) =>
                  setPreorders((items) =>
                    items.map((row, i) =>
                      i === index ? { ...row, unitPrice: Number(event.target.value) } : row,
                    ),
                  )
                }
                placeholder="₸"
                className="field"
              />
              <button
                type="button"
                onClick={() => setPreorders((items) => items.filter((_, i) => i !== index))}
                className="rounded-xl bg-white text-slate-500"
              >
                ×
              </button>
            </div>
          ))}
        </section>

        {serverError && <ErrorBanner>{serverError}</ErrorBanner>}

        <button
          disabled={pending}
          className="w-full rounded-2xl bg-slate-900 py-4 font-semibold text-white disabled:opacity-50"
        >
          {pending ? "Сохраняем…" : "Создать бронь"}
        </button>
      </form>
    </BottomSheet>
  );
}
