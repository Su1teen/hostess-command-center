import type { SalesFilter } from "../../lib/types/sales";

export function SalesFilterTabs({
  value,
  onChange,
}: {
  value: SalesFilter;
  onChange: (value: SalesFilter) => void;
}) {
  return (
    <div className="flex gap-2">
      {(
        [
          ["all", "Все"],
          ["alcohol", "Алкоголь"],
          ["kitchen", "Кухня"],
        ] as const
      ).map(([key, label]) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={`rounded-full px-4 py-2 text-sm font-medium ${value === key ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-600"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
