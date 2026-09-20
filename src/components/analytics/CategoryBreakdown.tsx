import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { SalesCategory } from "../../lib/types/sales";
import { formatKzt } from "../../lib/formatters/money";
import { ChartCard } from "../shared/ChartCard";

const colors = ["#334155", "#94a3b8", "#c9a96e", "#9fb9a2", "#c88484", "#64748b"];

export function CategoryBreakdown({ categories }: { categories: SalesCategory[] }) {
  return (
    <ChartCard title="Категории" subtitle="Доля выручки">
      <div className="flex items-center gap-3">
        <ResponsiveContainer width="48%" height={160}>
          <PieChart>
            <Pie
              data={categories}
              dataKey="revenue"
              nameKey="category"
              innerRadius={40}
              outerRadius={65}
              paddingAngle={3}
            >
              {categories.map((item, index) => (
                <Cell key={item.category} fill={colors[index % colors.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(value) => formatKzt(Number(value))} />
          </PieChart>
        </ResponsiveContainer>
        <div className="min-w-0 flex-1 space-y-2">
          {categories.length ? (
            categories.slice(0, 5).map((item, index) => (
              <div key={item.category} className="flex items-center justify-between gap-2 text-xs">
                <span className="flex min-w-0 items-center gap-2 truncate">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: colors[index % colors.length] }}
                  />
                  {item.category}
                </span>
                <span className="shrink-0 font-semibold">
                  {Math.round(item.share * 100)}% · {formatKzt(item.revenue)}
                </span>
              </div>
            ))
          ) : (
            <p className="text-sm text-slate-500">Нет продаж</p>
          )}
        </div>
      </div>
    </ChartCard>
  );
}
