import { useState } from "react";
import { formatKzt } from "../../lib/formatters/money";
import { resolveProductImage } from "../../lib/products/images";
import type { ExchangeProduct, ExchangeProductSettingsInput } from "../../lib/types/products";
import { BottomSheet } from "../shared/BottomSheet";

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white p-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  step?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        step={step}
        min={0}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="field text-base font-semibold tabular-nums"
      />
    </label>
  );
}

export function ProductEditSheet({
  product,
  onClose,
  onSave,
  pending,
  serverError,
}: {
  product: ExchangeProduct;
  onClose: () => void;
  onSave: (input: ExchangeProductSettingsInput) => void;
  pending?: boolean;
  serverError?: string | null;
}) {
  const [minPrice, setMinPrice] = useState(String(product.minPrice));
  const [maxPrice, setMaxPrice] = useState(String(product.maxPrice));
  const [priceStep, setPriceStep] = useState(String(product.priceStep));
  const [isActive, setIsActive] = useState(product.isActive);

  const min = Number(minPrice);
  const max = Number(maxPrice);
  const step = Number(priceStep);
  const localError =
    !Number.isFinite(min) || min < 0
      ? "Минимальная цена не может быть отрицательной"
      : !Number.isFinite(max) || max < min
        ? "Максимальная цена должна быть не меньше минимальной"
        : !Number.isFinite(step) || step <= 0
          ? "Шаг цены должен быть больше нуля"
          : null;

  return (
    <BottomSheet
      eyebrow={`${product.category}${product.volumeMl ? ` · ${product.volumeMl} мл` : ""}`}
      title={product.name}
      onClose={onClose}
    >
      <div className="flex items-center gap-3 rounded-3xl bg-white p-3">
        <img
          src={resolveProductImage(product)}
          alt=""
          className="h-20 w-20 rounded-2xl bg-slate-50 object-cover"
        />
        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Текущая цена</p>
          <p className="text-3xl font-bold tabular-nums">{formatKzt(product.currentPrice)}</p>
          <p className="text-xs text-slate-500">Управляется биржей · только чтение</p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <ReadOnly label="Исходная цена" value={formatKzt(product.originalPrice)} />
        <ReadOnly label="Стартовая цена" value={formatKzt(product.startPrice)} />
      </div>

      <section className="mt-5 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Коридор цены</p>
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Минимум, KZT" value={minPrice} onChange={setMinPrice} />
          <NumberField label="Максимум, KZT" value={maxPrice} onChange={setMaxPrice} />
        </div>
        <NumberField label="Шаг цены, KZT" value={priceStep} onChange={setPriceStep} />
        <button
          type="button"
          onClick={() => setIsActive((value) => !value)}
          className="flex w-full items-center justify-between rounded-2xl bg-white p-4"
          aria-pressed={isActive}
        >
          <span>
            <span className="block font-semibold">{isActive ? "Активен" : "Выключен"}</span>
            <span className="block text-xs text-slate-500">
              {isActive ? "Участвует в торгах на бирже" : "Скрыт с биржи"}
            </span>
          </span>
          <span
            className={`relative h-7 w-12 rounded-full transition-colors ${isActive ? "bg-slate-900" : "bg-slate-300"}`}
          >
            <span
              className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${isActive ? "translate-x-5" : "translate-x-0.5"}`}
            />
          </span>
        </button>
      </section>

      {(localError || serverError) && (
        <p className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {localError ?? serverError ?? "Не удалось сохранить изменения"}
        </p>
      )}

      <button
        type="button"
        disabled={pending || Boolean(localError)}
        onClick={() =>
          onSave({ id: product.id, minPrice: min, maxPrice: max, priceStep: step, isActive })
        }
        className="mt-5 w-full rounded-2xl bg-slate-900 py-4 font-semibold text-white disabled:opacity-50"
      >
        {pending ? "Сохраняем…" : "Сохранить"}
      </button>
    </BottomSheet>
  );
}
