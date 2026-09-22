import type { TopSale } from "../../lib/types/sales";
import { formatKzt } from "../../lib/formatters/money";
import { ChartCard } from "../shared/ChartCard";

export function TopProducts({ items }: { items: TopSale[] }) {
  return (
    <ChartCard title="Топ позиций" subtitle="По выручке">
      <div className="space-y-1">
        {items.length ? (
          items.map((item, index) => (
            <div
              key={`${item.name}-${item.source}`}
              className="flex items-center justify-between gap-3 border-b border-slate-100 py-2.5 last:border-0"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{item.name}</p>
                  <p className="truncate text-xs text-slate-500">
                    {item.category} · {item.quantity} шт
                  </p>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-semibold">{formatKzt(item.revenue)}</p>
                <span
                  className={`text-[9px] font-bold uppercase ${item.source === "exchange" ? "text-amber-700" : "text-slate-500"}`}
                >
                  биржа
                </span>
              </div>
            </div>
          ))
        ) : (
          <p className="py-4 text-sm text-slate-500">Нет продаж за сегодня</p>
        )}
      </div>
    </ChartCard>
  );
}
