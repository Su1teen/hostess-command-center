import { useState } from "react";
import { Plus, X } from "lucide-react";
import { useForm } from "react-hook-form";
import type { ReservationSource } from "../../lib/types/reservations";

interface FormValues {
  guestName: string;
  phone: string;
  guests: number;
  startsAt: string;
  source: ReservationSource;
  depositAmount: number;
  depositStatus: "none" | "pending" | "paid" | "refunded";
  comment: string;
}
interface Preorder {
  productName: string;
  quantity: number;
  unitPrice: number;
  comment?: string;
}

export function CreateReservationSheet({
  onClose,
  onSubmit,
  pending,
}: {
  onClose: () => void;
  onSubmit: (values: FormValues & { preorders: Preorder[] }) => void;
  pending?: boolean;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: { guests: 2, source: "manual", depositAmount: 0, depositStatus: "none" },
  });
  const [preorders, setPreorders] = useState<Preorder[]>([]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/30"
      onClick={onClose}
    >
      <section
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-[2rem] bg-slate-50 p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Новая бронь</p>
            <h2 className="text-2xl font-bold">Добавить гостя</h2>
          </div>
          <button onClick={onClose} className="rounded-full bg-white p-2">
            <X size={18} />
          </button>
        </div>
        <form
          onSubmit={handleSubmit((values) =>
            onSubmit({
              ...values,
              guests: Number(values.guests),
              depositAmount: Number(values.depositAmount),
              preorders,
            }),
          )}
          className="space-y-3"
        >
          <input
            {...register("guestName", { required: true })}
            placeholder="Имя гостя"
            className="field"
          />
          {errors.guestName && <p className="text-xs text-rose-600">Введите имя</p>}
          <input
            {...register("phone", { required: true, minLength: 5 })}
            placeholder="Телефон"
            className="field"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="number"
              {...register("guests", { valueAsNumber: true, min: 1 })}
              placeholder="Гостей"
              className="field"
            />
            <input
              type="datetime-local"
              {...register("startsAt", { required: true })}
              className="field"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select {...register("source")} className="field">
              <option value="manual">Вручную</option>
              <option value="phone">Телефон</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="instagram">Instagram</option>
              <option value="website">Сайт</option>
            </select>
            <input
              type="number"
              {...register("depositAmount", { valueAsNumber: true, min: 0 })}
              placeholder="Задаток, ₸"
              className="field"
            />
          </div>
          <select {...register("depositStatus")} className="field">
            <option value="none">Без задатка</option>
            <option value="pending">Задаток ожидается</option>
            <option value="paid">Задаток получен</option>
          </select>
          <textarea
            {...register("comment")}
            placeholder="Комментарий"
            className="field min-h-20 resize-none"
          />
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold">Предзаказ</p>
              <button
                type="button"
                onClick={() =>
                  setPreorders((items) => [
                    ...items,
                    { productName: "", quantity: 1, unitPrice: 0 },
                  ])
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
                  placeholder="Блюдо"
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
          </div>
          <button
            disabled={pending}
            className="w-full rounded-2xl bg-slate-900 py-4 font-semibold text-white disabled:opacity-50"
          >
            {pending ? "Сохраняем…" : "Создать бронь"}
          </button>
        </form>
      </section>
    </div>
  );
}
