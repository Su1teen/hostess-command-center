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
        label="Сделок биржи"
        value={kpis.ordersCount === null ? "—" : String(kpis.ordersCount)}
        subtitle={
          kpis.ordersCount === null
            ? "только барные продажи"
            : kpis.averageCheck !== null
              ? `Средняя продажа · ${formatKzt(kpis.averageCheck)}`
              : undefined
        }
        icon={<ShoppingBag size={15} />}
      />
      <KpiCard label="Продано позиций" value={String(kpis.itemsSold)} />
      <KpiCard label="Барная выручка" value={formatKzt(kpis.alcoholRevenue)} />
    </div>
  );
}
