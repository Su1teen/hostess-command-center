import { formatKzt } from "../../lib/formatters/money";
import { resolveProductImage } from "../../lib/products/images";
import type { ExchangeProduct } from "../../lib/types/products";

export function ProductCard({
  product,
  onClick,
}: {
  product: ExchangeProduct;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-3xl bg-white p-3 text-left transition-transform active:scale-[.99] ${
        product.isActive ? "" : "opacity-60"
      }`}
    >
      <img
        src={resolveProductImage(product)}
        alt=""
        loading="lazy"
        className="h-16 w-16 shrink-0 rounded-2xl bg-slate-50 object-cover"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{product.name}</p>
        <p className="truncate text-xs text-slate-500">
          {product.category}
          {product.volumeMl ? ` · ${product.volumeMl} мл` : ""}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          мин. <span className="font-medium text-slate-700">{formatKzt(product.minPrice)}</span>
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-lg font-bold tabular-nums">{formatKzt(product.currentPrice)}</p>
        <span
          className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            product.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
          }`}
        >
          {product.isActive ? "Активен" : "Выключен"}
        </span>
      </div>
    </button>
  );
}
