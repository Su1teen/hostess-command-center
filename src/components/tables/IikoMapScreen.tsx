import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Copy } from "lucide-react";
import { controlClass } from "../../lib/dine-in-client";
import { IIKO_FLOOR, QR_POINTS, qrPointFor, qrPointsCsv } from "../../lib/iiko/xoxo-tables";

// Sections shown on the map; "Бар" has no schema and "НА ВЫНОС" is not seating.
const SHOWN = ["Зал (Барная)", "Общий зал", "PS (Общий зал)", "ВИП"];

export function IikoMapScreen() {
  const sections = SHOWN.map((name) => IIKO_FLOOR.sections.find((s) => s.name === name)!).filter(
    Boolean,
  );
  const [active, setActive] = useState(sections[0].name);
  const [copied, setCopied] = useState(false);
  const section = sections.find((s) => s.name === active)!;
  // iiko lets tables sit below the declared canvas height (first hall: tables 4–6), so grow to fit.
  const width = Math.max(section.width, ...section.tables.map((t) => t.x + t.width + 20));
  const height = Math.max(section.height, ...section.tables.map((t) => t.y + t.height + 20));
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/tables/qr" className="flex items-center gap-1 text-xs text-slate-500">
            <ArrowLeft size={12} /> Столы и QR
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Рассадка как в iiko</h1>
          <p className="mt-1 text-xs text-slate-500">
            {IIKO_FLOOR.organization} · снимок от {IIKO_FLOOR.exportedAt.slice(0, 10)} · без
            запросов к iiko
          </p>
        </div>
        <button
          type="button"
          className={`${controlClass} inline-flex items-center gap-2`}
          onClick={() => {
            void navigator.clipboard.writeText(qrPointsCsv()).then(() => setCopied(true));
          }}
        >
          <Copy size={14} /> {copied ? "Скопировано" : "Скопировать таблицу для QR"}
        </button>
      </header>

      <div className="flex flex-wrap gap-2">
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setActive(s.name)}
            className={`${controlClass} ${s.name === active ? "bg-slate-900! text-white" : ""}`}
          >
            {s.name}
          </button>
        ))}
      </div>

      <div className="overflow-auto rounded-xl border border-slate-200 bg-white p-2">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="mx-auto w-full max-w-3xl"
          role="img"
          aria-label={`Схема: ${section.name}`}
        >
          <rect width={width} height={height} fill="#f8fafc" />
          {section.labels.map((label, i) => (
            <text key={i} x={label.x} y={label.y + 18} fontSize={16} fill="#64748b">
              {label.text}
            </text>
          ))}
          {section.tables.map((table) => {
            const point = qrPointFor(section.name, table.number);
            const cx = table.x + table.width / 2;
            const cy = table.y + table.height / 2;
            return (
              <g key={table.id} transform={`rotate(${table.angle} ${cx} ${cy})`}>
                <rect
                  x={table.x}
                  y={table.y}
                  width={table.width}
                  height={table.height}
                  rx={10}
                  fill={point ? "#dbeafe" : "#f1f5f9"}
                  stroke={point ? "#2563eb" : "#cbd5e1"}
                  strokeWidth={2}
                  strokeDasharray={point ? undefined : "5 4"}
                />
                <text
                  x={cx}
                  y={cy - 2}
                  textAnchor="middle"
                  fontSize={15}
                  fontWeight={600}
                  fill="#0f172a"
                >
                  {point?.name ?? (table.name || `№${table.number}`)}
                </text>
                <text x={cx} y={cy + 16} textAnchor="middle" fontSize={11} fill="#475569">
                  {point ? `QR ${point.qrCode}` : "нет QR"}
                </text>
              </g>
            );
          })}
        </svg>
        {section.unplacedTables.length > 0 && (
          <p className="px-2 pb-1 text-xs text-slate-500">
            В iiko заведено ещё {section.unplacedTables.length} столов этой секции, на схему они не
            вынесены.
          </p>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {["QR", "Название", "Зона", "Секция iiko", "№", "Мест"].map((h) => (
                <th key={h} className="px-3 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {QR_POINTS.map((p) => (
              <tr key={p.qrCode} className="border-t border-slate-100">
                <td className="px-3 py-2 tabular-nums">{p.qrCode}</td>
                <td className="px-3 py-2 font-medium">{p.name}</td>
                <td className="px-3 py-2">{p.zoneName}</td>
                <td className="px-3 py-2">{p.iikoSection}</td>
                <td className="px-3 py-2 tabular-nums">{p.iikoNumber}</td>
                <td className="px-3 py-2">{p.seats ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
