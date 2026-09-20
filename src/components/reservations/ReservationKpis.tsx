import { CalendarDays, Users, Wallet } from "lucide-react";
import { formatKzt } from "../../lib/formatters/money";
import type { ReservationsBoard } from "../../lib/types/reservations";
import { KpiCard } from "../shared/KpiCard";

export function ReservationKpis({ kpis }: { kpis: ReservationsBoard["kpis"] }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <KpiCard
        label="Броней сегодня"
        value={String(kpis.reservationsToday)}
        icon={<CalendarDays size={15} />}
      />
      <KpiCard
        label="Ожидается гостей"
        value={String(kpis.expectedGuests)}
        icon={<Users size={15} />}
      />
      <KpiCard label="Задатков" value={formatKzt(kpis.depositsTotal)} icon={<Wallet size={15} />} />
      <KpiCard label="Предзаказов" value={formatKzt(kpis.preordersTotal)} />
    </div>
  );
}
