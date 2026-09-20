import type { ReactNode } from "react";

export function KpiCard({
  label,
  value,
  subtitle,
  icon,
}: {
  label: string;
  value: string;
  subtitle?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-slate-200/70 bg-white p-4">
      <div className="mb-1 flex items-center justify-between text-xs font-medium text-slate-500">
        <span>{label}</span>
        {icon}
      </div>
      <p className="text-xl font-bold tracking-tight text-slate-900">{value}</p>
      {subtitle && <p className="mt-1 text-[11px] text-slate-500">{subtitle}</p>}
    </div>
  );
}
