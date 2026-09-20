import { useState } from "react";
import { Eye, MapPin } from "lucide-react";
import { FloorPlan } from "./FloorPlan";
import { TableSheet } from "./TableSheet";
import { TimelineStrip } from "./TimelineStrip";

export function HallScreen() {
  const [time, setTime] = useState("18:00");
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <div className="space-y-5 px-4 pt-6">
      <header>
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
          <MapPin size={13} /> Основной зал
        </div>
        <div className="mt-1 flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">Зал</h1>
          <span
            title="Столы и посадка — демонстрационные данные, не связаны с бронями из базы"
            className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold text-amber-800"
          >
            Демо-раскладка
          </span>
        </div>
        <p className="mt-1 text-xs text-slate-500">Столы и посадка не связаны с бронями из базы</p>
      </header>
      <TimelineStrip value={time} onChange={setTime} />
      <FloorPlan time={time} onSelect={setSelected} />
      <div className="grid grid-cols-3 gap-2 text-center text-xs text-slate-500">
        <div className="rounded-2xl bg-white p-3">
          <span className="mx-auto mb-1 block h-3 w-3 rounded-full bg-[#9FB9A2]" />
          Свободен
        </div>
        <div className="rounded-2xl bg-white p-3">
          <span className="mx-auto mb-1 block h-3 w-3 rounded-full bg-[#C88484]" />
          Бронь
        </div>
        <div className="rounded-2xl bg-white p-3">
          <span className="mx-auto mb-1 block h-3 w-3 rounded-full bg-[#C9A96E]" />
          <Eye size={12} className="mx-auto -mt-4 mb-1 text-transparent" />
          Посадка
        </div>
      </div>
      {selected && <TableSheet tableId={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
