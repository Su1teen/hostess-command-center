import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { SalesHourlyPoint } from "../../lib/types/sales";
import { formatKzt } from "../../lib/formatters/money";
import { ChartCard } from "../shared/ChartCard";

export function HourlyRevenueChart({ data }: { data: SalesHourlyPoint[] }) {
  return (
    <ChartCard title="Выручка по часам" subtitle="Сегодня · Алматы">
      <ResponsiveContainer width="100%" height={210}>
        <BarChart data={data} margin={{ top: 8, right: 0, left: -22, bottom: 0 }}>
          <CartesianGrid stroke="#e2e8f0" strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: "#64748b" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "#64748b" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(value) => `${Math.round(value / 1000)}k`}
          />
          <Tooltip
            formatter={(value) => formatKzt(Number(value))}
            contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }}
          />
          <Bar dataKey="revenue" fill="#334155" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
