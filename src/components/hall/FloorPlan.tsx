import { useState } from "react";
import { Minus, Plus, Tv } from "lucide-react";
import { MOCK_TABLES, STATUS_COLOR, statusAt, TV_SCREENS } from "./mock";
import { renderChairs } from "./renderChairs";

export function FloorPlan({ time, onSelect }: { time: string; onSelect: (id: string) => void }) {
  const [scale, setScale] = useState(0.9);
  return (
    <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-2">
      <div className="absolute right-4 top-4 z-10 flex gap-1 rounded-full bg-white/90 p-1 shadow-sm">
        <button
          onClick={() => setScale((v) => Math.max(0.65, v - 0.1))}
          className="rounded-full p-2"
        >
          <Minus size={14} />
        </button>
        <button
          onClick={() => setScale((v) => Math.min(1.3, v + 0.1))}
          className="rounded-full p-2"
        >
          <Plus size={14} />
        </button>
      </div>
      <svg
        viewBox="0 0 500 550"
        className="h-[440px] w-full"
        style={{ transform: `scale(${scale})`, transformOrigin: "center" }}
      >
        <rect x="12" y="12" width="476" height="526" rx="22" fill="#f8fafc" stroke="#e2e8f0" />
        {TV_SCREENS.map((tv) => (
          <g key={tv.id}>
            <polygon points={tv.cone} fill="#c9a96e" opacity=".08" />
            <text x={tv.x} y={tv.y} fontSize="14" fill="#64748b">
              <tspan>▣</tspan>
            </text>
            <Tv x={tv.x - 14} y={tv.y - 14} size={16} color="#94a3b8" />
          </g>
        ))}
        {MOCK_TABLES.map((table) => {
          const status = statusAt(table, time);
          const cx = table.x + table.w / 2;
          const cy = table.y + table.h / 2;
          return (
            <g key={table.id} onClick={() => onSelect(table.id)} className="cursor-pointer">
              {table.shape === "round" &&
                renderChairs(table.seats, cx, cy, Math.max(table.w, table.h) / 2 + 11)}
              <rect
                x={table.x}
                y={table.y}
                width={table.w}
                height={table.h}
                rx={table.shape === "round" ? table.w / 2 : 10}
                fill={STATUS_COLOR[status]}
                opacity=".85"
              />
              <text
                x={cx}
                y={cy + 4}
                textAnchor="middle"
                fontSize="12"
                fontWeight="700"
                fill="#334155"
              >
                {table.label}
              </text>
            </g>
          );
        })}
        <text x="32" y="525" fontSize="10" fill="#94a3b8">
          Демонстрационная схема зала
        </text>
      </svg>
    </div>
  );
}
