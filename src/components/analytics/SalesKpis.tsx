import { ShoppingBag, Wallet } from "lucide-react";
import { formatKzt } from "../../lib/formatters/money";
import type { SalesKpis as SalesKpisType } from "../../lib/types/sales";
import { KpiCard } from "../shared/KpiCard";

export function SalesKpis({ kpis }: { kpis: SalesKpisType }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <KpiCard
        label="Выручка сегодня"
        value={formatKzt(kpis.revenue)}
        icon={<Wallet size={15} />}
      />
      <KpiCard
        label="Заказов"
        value={kpis.ordersCount === null ? "—" : String(kpis.ordersCount)}
        subtitle={
          kpis.ordersCount === null
            ? "нет данных iiko"
            : kpis.averageCheck !== null
              ? `Средний чек (iiko) ${formatKzt(kpis.averageCheck)}`
              : undefined
        }
        icon={<ShoppingBag size={15} />}
      />
      <KpiCard label="Продано позиций" value={String(kpis.itemsSold)} />
      <KpiCard label="Алкоголь" value={formatKzt(kpis.alcoholRevenue)} />
    </div>
  );
}
