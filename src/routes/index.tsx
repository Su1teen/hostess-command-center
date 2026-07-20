import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, useRef, useEffect } from "react";
import {
  Map as MapIcon,
  BarChart3,
  ShoppingCart,
  X,
  Phone,
  MessageCircle,
  Plus,
  Minus,
  Users,
  Clock,
  Wallet,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Send,
  ChevronRight,
  Tv,
  Search,
} from "lucide-react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

export const Route = createFileRoute("/")({
  component: HostessApp,
});

// ————————————————————— MOCK DATA —————————————————————
type TableStatus = "free" | "booked" | "served";
type TableShape = "round" | "rect" | "bar";

interface TableDef {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  seats: number;
  shape: TableShape;
  bookings: { start: string; end: string; guest: string; phone: string; deposit: number; bill?: number; guests: number }[];
}

const TIME_SLOTS = Array.from({ length: 20 }, (_, i) => {
  const totalMin = 12 * 60 + i * 30;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
});

const MOCK_TABLES: TableDef[] = [
  // Main hall — round tables
  { id: "A1", label: "A1", x: 60, y: 90, w: 68, h: 68, seats: 4, shape: "round",
    bookings: [{ start: "18:00", end: "21:00", guest: "Иван Соколов", phone: "+7 903 111 22 33", deposit: 5000, bill: 8400, guests: 4 }] },
  { id: "A2", label: "A2", x: 160, y: 90, w: 68, h: 68, seats: 4, shape: "round",
    bookings: [{ start: "19:30", end: "23:00", guest: "Мария П.", phone: "+7 916 222 33 44", deposit: 3000, guests: 3 }] },
  { id: "A3", label: "A3", x: 260, y: 90, w: 68, h: 68, seats: 4, shape: "round", bookings: [] },
  { id: "A4", label: "A4", x: 360, y: 90, w: 68, h: 68, seats: 4, shape: "round",
    bookings: [{ start: "20:00", end: "23:30", guest: "Корп. Спорт-Клуб", phone: "+7 495 700 10 20", deposit: 15000, bill: 22300, guests: 6 }] },

  // Row 2 — rectangular
  { id: "B1", label: "B1", x: 60, y: 210, w: 90, h: 60, seats: 6, shape: "rect",
    bookings: [{ start: "17:00", end: "20:00", guest: "Дмитрий К.", phone: "+7 925 100 20 30", deposit: 4000, bill: 6200, guests: 5 }] },
  { id: "B2", label: "B2", x: 180, y: 210, w: 90, h: 60, seats: 6, shape: "rect", bookings: [] },
  { id: "B3", label: "B3", x: 300, y: 210, w: 90, h: 60, seats: 6, shape: "rect",
    bookings: [{ start: "21:00", end: "23:30", guest: "Артём В.", phone: "+7 999 555 44 33", deposit: 6000, guests: 6 }] },

  // Row 3 — VIP round
  { id: "C1", label: "C1", x: 90, y: 320, w: 80, h: 80, seats: 6, shape: "round", bookings: [] },
  { id: "C2", label: "C2", x: 230, y: 320, w: 80, h: 80, seats: 6, shape: "round",
    bookings: [{ start: "19:00", end: "23:00", guest: "Ольга Н.", phone: "+7 903 444 55 66", deposit: 8000, bill: 11500, guests: 5 }] },
  { id: "C3", label: "C3", x: 370, y: 320, w: 60, h: 60, seats: 2, shape: "round", bookings: [] },

  // Bar stools
  { id: "Bar1", label: "Bar 1", x: 60, y: 460, w: 40, h: 40, seats: 1, shape: "bar",
    bookings: [{ start: "18:30", end: "22:00", guest: "Гость у бара", phone: "+7 900 000 00 01", deposit: 0, bill: 2400, guests: 1 }] },
  { id: "Bar2", label: "Bar 2", x: 115, y: 460, w: 40, h: 40, seats: 1, shape: "bar", bookings: [] },
  { id: "Bar3", label: "Bar 3", x: 170, y: 460, w: 40, h: 40, seats: 1, shape: "bar", bookings: [] },
  { id: "Bar4", label: "Bar 4", x: 225, y: 460, w: 40, h: 40, seats: 1, shape: "bar",
    bookings: [{ start: "20:00", end: "23:00", guest: "Никита", phone: "+7 916 111 22 33", deposit: 0, guests: 2 }] },
  { id: "Bar5", label: "Bar 5", x: 280, y: 460, w: 40, h: 40, seats: 1, shape: "bar", bookings: [] },
  { id: "Bar6", label: "Bar 6", x: 335, y: 460, w: 40, h: 40, seats: 1, shape: "bar", bookings: [] },
  { id: "Bar7", label: "Bar 7", x: 390, y: 460, w: 40, h: 40, seats: 1, shape: "bar", bookings: [] },
];

// TV screens with visibility cones (polygons)
const TV_SCREENS = [
  { id: "TV1", x: 245, y: 30, cone: "60,90 430,90 380,200 105,200" },
  { id: "TV2", x: 40, y: 380, cone: "40,395 90,395 200,470 40,470" },
];

const REVENUE_HOURLY = [
  { h: "12", today: 12000, yesterday: 9000 },
  { h: "14", today: 22000, yesterday: 18000 },
  { h: "16", today: 34000, yesterday: 28000 },
  { h: "18", today: 68000, yesterday: 54000 },
  { h: "20", today: 128000, yesterday: 96000 },
  { h: "22", today: 184000, yesterday: 142000 },
  { h: "00", today: 214000, yesterday: 178000 },
];

const OCCUPANCY = [
  { h: "12", guests: 8 },
  { h: "14", guests: 18 },
  { h: "16", guests: 34 },
  { h: "18", guests: 62 },
  { h: "20", guests: 96 },
  { h: "22", guests: 108 },
  { h: "00", guests: 74 },
];

const SALES_MIX = [
  { name: "Бар", value: 48, color: "#334155" },
  { name: "Кухня", value: 36, color: "#94a3b8" },
  { name: "Кальяны", value: 16, color: "#C9A96E" },
];

const TOP_ITEMS = [
  { name: "Крафт лагер 0.5", sold: 142, revenue: 71000 },
  { name: "Стейк Рибай", sold: 38, revenue: 133000 },
  { name: "Крылья BBQ", sold: 96, revenue: 67200 },
  { name: "Кальян Классик", sold: 44, revenue: 88000 },
  { name: "Бургер Prime", sold: 71, revenue: 63900 },
];

const MENU_STOCK = [
  { name: "Кега светлого крафта", left: 4, unit: "порций", severity: "high", note: "Хватит до вечера" },
  { name: "Стейк Рибай", left: 6, unit: "порций", severity: "med", note: "Закупить к пятнице" },
  { name: "Лайм свежий", left: 12, unit: "шт", severity: "low", note: "В норме" },
  { name: "Табак Al Fakher Grape", left: 2, unit: "пачки", severity: "high", note: "Срочно" },
];

const SUPPLIERS = [
  { id: "s1", name: "Крафт-Депо", category: "Алкоголь", schedule: "Заказ до 12:00", phone: "+74957001010", priority: 1, items: "5 кег лагера" },
  { id: "s2", name: "Мясной Двор", category: "Мясо", schedule: "Заказ до 09:00", phone: "+74957002020", priority: 2, items: "10 кг рибай" },
  { id: "s3", name: "Фреш-Ово", category: "Овощи", schedule: "Ежедневно", phone: "+74957003030", priority: 3, items: "Стандартный набор" },
  { id: "s4", name: "SmokeHouse", category: "Табак", schedule: "Заказ до 14:00", phone: "+74957004040", priority: 1, items: "2 пачки Al Fakher Grape" },
];

// ————————————————————— HELPERS —————————————————————
function timeToMin(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function statusAt(table: TableDef, time: string): TableStatus {
  const t = timeToMin(time);
  for (const b of table.bookings) {
    const s = timeToMin(b.start);
    const e = timeToMin(b.end);
    if (t >= s && t < e) {
      // "Serving" if within first hour of booking and there's a bill
      if (b.bill && t - s < 120) return "served";
      return "booked";
    }
  }
  return "free";
}
const STATUS_COLOR: Record<TableStatus, string> = {
  free: "#9FB9A2",
  booked: "#C88484",
  served: "#C9A96E",
};
const STATUS_LABEL: Record<TableStatus, string> = {
  free: "Свободен",
  booked: "Забронирован",
  served: "Обслуживается",
};

// ————————————————————— APP —————————————————————
function HostessApp() {
  const [tab, setTab] = useState<"map" | "analytics" | "supply">("map");
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-32">
      <div className="max-w-md mx-auto">
        {tab === "map" && <MapScreen />}
        {tab === "analytics" && <AnalyticsScreen />}
        {tab === "supply" && <SupplyScreen />}
      </div>
      <BottomNav tab={tab} setTab={setTab} />
    </div>
  );
}

// ————————————————————— BOTTOM NAV —————————————————————
function BottomNav({ tab, setTab }: { tab: string; setTab: (t: any) => void }) {
  const items = [
    { id: "map", label: "Зал", icon: MapIcon },
    { id: "analytics", label: "Аналитика", icon: BarChart3 },
    { id: "supply", label: "Закупки", icon: ShoppingCart },
  ] as const;
  return (
    <nav className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
      <div className="glass rounded-full px-2 py-2 shadow-[0_20px_60px_-20px_rgba(15,23,42,0.35)] flex items-center gap-1">
        {items.map((it) => {
          const active = tab === it.id;
          const Icon = it.icon;
          return (
            <button
              key={it.id}
              onClick={() => setTab(it.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-full transition-all duration-300 ${
                active ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-white/50"
              }`}
            >
              <Icon size={18} strokeWidth={2} />
              <span className={`text-sm font-medium ${active ? "" : "hidden"}`}>{it.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

// ————————————————————— MAP SCREEN —————————————————————
function MapScreen() {
  const [selectedTime, setSelectedTime] = useState("20:00");
  const [selected, setSelected] = useState<TableDef | null>(null);

  // Pan & Zoom
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const gestureRef = useRef<{ x: number; y: number; startX: number; startY: number; dist?: number; startScale?: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    gestureRef.current = { x: e.clientX, y: e.clientY, startX: pan.x, startY: pan.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!gestureRef.current) return;
    const dx = e.clientX - gestureRef.current.x;
    const dy = e.clientY - gestureRef.current.y;
    setPan({ x: gestureRef.current.startX + dx, y: gestureRef.current.startY + dy });
  };
  const onPointerUp = () => { gestureRef.current = null; };

  const timelineRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = timelineRef.current?.querySelector<HTMLButtonElement>(`[data-t="${selectedTime}"]`);
    el?.scrollIntoView({ inline: "center", behavior: "smooth", block: "nearest" });
  }, []); // eslint-disable-line

  return (
    <div className="px-4 pt-6">
      <header className="flex items-end justify-between mb-4">
        <div>
          <p className="text-xs text-slate-500 font-medium tracking-wide uppercase">Sportbar Prime · Сегодня</p>
          <h1 className="text-2xl font-bold tracking-tight">Карта зала</h1>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-500">На {selectedTime}</p>
          <p className="text-sm font-semibold">
            {MOCK_TABLES.filter((t) => statusAt(t, selectedTime) !== "free").length}/{MOCK_TABLES.length} занято
          </p>
        </div>
      </header>

      {/* Timeline */}
      <div className="mb-4 -mx-4 px-4">
        <div
          ref={timelineRef}
          className="flex gap-2 overflow-x-auto pb-2 scrollbar-none"
          style={{ scrollbarWidth: "none" }}
        >
          {TIME_SLOTS.map((t) => {
            const active = t === selectedTime;
            return (
              <button
                key={t}
                data-t={t}
                onClick={() => setSelectedTime(t)}
                className={`shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-all duration-300 ${
                  active
                    ? "bg-slate-900 text-white shadow-lg shadow-slate-900/20"
                    : "bg-white text-slate-600 border border-slate-200/70"
                }`}
              >
                {t}
              </button>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex gap-3 mb-3 text-xs">
        {(["free", "booked", "served"] as TableStatus[]).map((s) => (
          <div key={s} className="flex items-center gap-1.5 text-slate-600">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: STATUS_COLOR[s] }} />
            {STATUS_LABEL[s]}
          </div>
        ))}
      </div>

      {/* Floorplan */}
      <div
        className="rounded-3xl overflow-hidden bg-white border border-slate-200/70 shadow-sm relative touch-none select-none"
        style={{ height: 520 }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="absolute top-3 right-3 z-10 flex flex-col gap-1.5">
          <button
            onClick={() => setScale((s) => Math.min(2.5, s + 0.2))}
            className="w-9 h-9 rounded-full bg-white border border-slate-200 shadow-sm flex items-center justify-center"
          >
            <Plus size={16} />
          </button>
          <button
            onClick={() => setScale((s) => Math.max(0.6, s - 0.2))}
            className="w-9 h-9 rounded-full bg-white border border-slate-200 shadow-sm flex items-center justify-center"
          >
            <Minus size={16} />
          </button>
          <button
            onClick={() => { setScale(1); setPan({ x: 0, y: 0 }); }}
            className="w-9 h-9 rounded-full bg-white border border-slate-200 shadow-sm flex items-center justify-center text-[10px] font-semibold"
          >
            1:1
          </button>
        </div>

        <svg
          viewBox="0 0 490 540"
          className="w-full h-full"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`, transformOrigin: "center", transition: gestureRef.current ? "none" : "transform 0.3s ease" }}
        >
          {/* Room outline */}
          <rect x="20" y="20" width="450" height="500" rx="24" fill="#fafaf9" stroke="#e2e8f0" strokeWidth="1.5" />

          {/* Entrance */}
          <rect x="200" y="510" width="90" height="14" rx="4" fill="#e2e8f0" />
          <text x="245" y="521" textAnchor="middle" fontSize="8" fill="#64748b" fontWeight="600">ВХОД</text>

          {/* TV cones */}
          {TV_SCREENS.map((tv) => (
            <polygon key={tv.id + "cone"} points={tv.cone} fill="#0f172a" opacity="0.05" />
          ))}
          {/* TV screens */}
          {TV_SCREENS.map((tv) => (
            <g key={tv.id}>
              <rect x={tv.x} y={tv.y} width="60" height="14" rx="3" fill="#0f172a" />
              <text x={tv.x + 30} y={tv.y + 10} textAnchor="middle" fontSize="8" fill="#f8fafc" fontWeight="700">{tv.id}</text>
            </g>
          ))}

          {/* Bar counter */}
          <rect x="45" y="430" width="410" height="18" rx="6" fill="#1e293b" opacity="0.9" />
          <text x="250" y="443" textAnchor="middle" fontSize="9" fill="#f8fafc" fontWeight="600" letterSpacing="1">БАР</text>

          {/* Tables */}
          {MOCK_TABLES.map((t) => {
            const st = statusAt(t, selectedTime);
            const color = STATUS_COLOR[st];
            const cx = t.x + t.w / 2;
            const cy = t.y + t.h / 2;
            return (
              <g key={t.id} onClick={() => setSelected(t)} style={{ cursor: "pointer" }}>
                {/* Chairs */}
                {renderChairs(t, color)}
                {/* Table */}
                {t.shape === "round" ? (
                  <circle cx={cx} cy={cy} r={t.w / 2} fill={color} stroke="#fff" strokeWidth="2" />
                ) : t.shape === "rect" ? (
                  <rect x={t.x} y={t.y} width={t.w} height={t.h} rx="8" fill={color} stroke="#fff" strokeWidth="2" />
                ) : (
                  <circle cx={cx} cy={cy} r={t.w / 2 - 4} fill={color} stroke="#fff" strokeWidth="1.5" />
                )}
                <text x={cx} y={cy + 3} textAnchor="middle" fontSize={t.shape === "bar" ? 8 : 11} fontWeight="700" fill="#fff">
                  {t.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Bottom sheet */}
      <TableSheet table={selected} time={selectedTime} onClose={() => setSelected(null)} />
    </div>
  );
}

function renderChairs(t: TableDef, color: string) {
  if (t.shape === "bar") return null;
  const chairs: JSX.Element[] = [];
  const cx = t.x + t.w / 2;
  const cy = t.y + t.h / 2;
  if (t.shape === "round") {
    const r = t.w / 2 + 10;
    for (let i = 0; i < t.seats; i++) {
      const a = (i / t.seats) * Math.PI * 2 - Math.PI / 2;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      chairs.push(<circle key={i} cx={x} cy={y} r={5} fill="#fff" stroke={color} strokeWidth="1.5" />);
    }
  } else {
    const per = Math.ceil(t.seats / 2);
    for (let i = 0; i < per; i++) {
      const x = t.x + ((i + 0.5) / per) * t.w;
      chairs.push(<circle key={"t" + i} cx={x} cy={t.y - 8} r={5} fill="#fff" stroke={color} strokeWidth="1.5" />);
      chairs.push(<circle key={"b" + i} cx={x} cy={t.y + t.h + 8} r={5} fill="#fff" stroke={color} strokeWidth="1.5" />);
    }
  }
  return chairs;
}

function TableSheet({ table, time, onClose }: { table: TableDef | null; time: string; onClose: () => void }) {
  const status = table ? statusAt(table, time) : "free";
  const current = table?.bookings.find((b) => {
    const t = timeToMin(time);
    return t >= timeToMin(b.start) && t < timeToMin(b.end);
  });
  return (
    <>
      <div
        className={`fixed inset-0 bg-slate-900/20 z-40 transition-opacity duration-300 ${
          table ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />
      <div
        className={`fixed bottom-0 left-0 right-0 z-40 transition-transform duration-500 ease-out ${
          table ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div className="max-w-md mx-auto glass rounded-t-[2rem] p-6 pb-32 shadow-[0_-20px_60px_-10px_rgba(15,23,42,0.2)]">
          <div className="flex items-start justify-between mb-5">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ background: STATUS_COLOR[status] }}
                />
                <p className="text-xs text-slate-600 font-medium">{STATUS_LABEL[status]}</p>
              </div>
              <h2 className="text-2xl font-bold">Стол {table?.label}</h2>
              <p className="text-sm text-slate-500 mt-0.5">{table?.seats} мест · Обзор ТВ отличный</p>
            </div>
            <button onClick={onClose} className="w-9 h-9 rounded-full bg-white/60 flex items-center justify-center">
              <X size={18} />
            </button>
          </div>

          {current ? (
            <div className="space-y-4">
              <div className="bg-white/70 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-xs text-slate-500">Гость</p>
                    <p className="font-semibold text-lg">{current.guest}</p>
                  </div>
                  <div className="flex items-center gap-1 text-sm text-slate-600">
                    <Users size={14} /> {current.guests}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3 pt-3 border-t border-slate-200/70">
                  <MetricSmall icon={<Clock size={14} />} label="Время" value={`${current.start}–${current.end}`} />
                  <MetricSmall icon={<Wallet size={14} />} label="Депозит" value={`${current.deposit.toLocaleString("ru")}₽`} />
                  <MetricSmall icon={<TrendingUp size={14} />} label="Счёт" value={current.bill ? `${current.bill.toLocaleString("ru")}₽` : "—"} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <a href={`tel:${current.phone}`} className="flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-slate-900 text-white font-medium">
                  <Phone size={16} /> Позвонить
                </a>
                <a href={`https://wa.me/${current.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-white border border-slate-200 font-medium">
                  <MessageCircle size={16} /> WhatsApp
                </a>
              </div>
            </div>
          ) : (
            <button className="w-full py-4 rounded-2xl bg-slate-900 text-white font-medium flex items-center justify-center gap-2">
              <Plus size={18} /> Посадить гостей / Добавить бронь
            </button>
          )}

          {/* Day schedule */}
          <div className="mt-6">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Расписание на сегодня</p>
            <div className="space-y-2">
              {table?.bookings.length ? table.bookings.map((b, i) => (
                <div key={i} className="flex items-center justify-between bg-white/60 rounded-xl px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">{b.guest}</p>
                    <p className="text-xs text-slate-500">{b.start} – {b.end}</p>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-slate-600">
                    <Users size={12} /> {b.guests}
                  </div>
                </div>
              )) : <p className="text-sm text-slate-500">Броней нет · стол доступен весь день</p>}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function MetricSmall({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div>
      <div className="flex items-center gap-1 text-slate-500 text-[10px] uppercase tracking-wide mb-0.5">
        {icon} {label}
      </div>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  );
}

// ————————————————————— ANALYTICS —————————————————————
function AnalyticsScreen() {
  return (
    <div className="px-4 pt-6 space-y-5">
      <header>
        <p className="text-xs text-slate-500 font-medium tracking-wide uppercase">Дашборд · Сегодня</p>
        <h1 className="text-2xl font-bold tracking-tight">Аналитика</h1>
      </header>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3">
        <KPI label="Выручка" value="214 380 ₽" delta="+21%" positive />
        <KPI label="Средний чек" value="3 240 ₽" delta="+4%" positive />
        <KPI label="Гостей" value="128" delta="+12" positive />
        <KPI label="Отдача кухни" value="14 мин" delta="+2 мин" positive={false} live />
      </div>

      {/* Revenue Line */}
      <ChartCard title="Выручка по часам" subtitle="Сегодня vs вчера">
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={REVENUE_HOURLY} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="2 4" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="h" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v / 1000}k`} />
            <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }} />
            <Line type="monotone" dataKey="yesterday" stroke="#cbd5e1" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="today" stroke="#0f172a" strokeWidth={2.5} dot={{ r: 3, fill: "#0f172a" }} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Occupancy Bar */}
      <ChartCard title="Загруженность" subtitle="Гостей по часам · пики">
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={OCCUPANCY} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="2 4" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="h" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }} />
            <Bar dataKey="guests" fill="#C9A96E" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Sales Mix Donut */}
      <ChartCard title="Структура продаж" subtitle="Бар · Кухня · Кальяны">
        <div className="flex items-center gap-4">
          <ResponsiveContainer width="55%" height={160}>
            <PieChart>
              <Pie data={SALES_MIX} innerRadius={45} outerRadius={70} paddingAngle={3} dataKey="value">
                {SALES_MIX.map((s) => <Cell key={s.name} fill={s.color} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="flex-1 space-y-2">
            {SALES_MIX.map((s) => (
              <div key={s.name} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />
                  <span className="text-slate-600">{s.name}</span>
                </div>
                <span className="font-semibold">{s.value}%</span>
              </div>
            ))}
          </div>
        </div>
      </ChartCard>

      {/* ABC */}
      <ChartCard title="Топ-5 позиций" subtitle="ABC-анализ · по выручке">
        <div className="space-y-2">
          {TOP_ITEMS.map((it, i) => (
            <div key={it.name} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
              <div className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-700 text-xs font-bold flex items-center justify-center">{i + 1}</span>
                <div>
                  <p className="text-sm font-medium">{it.name}</p>
                  <p className="text-xs text-slate-500">{it.sold} шт</p>
                </div>
              </div>
              <p className="text-sm font-semibold">{it.revenue.toLocaleString("ru")} ₽</p>
            </div>
          ))}
        </div>
      </ChartCard>

      {/* Stock alerts */}
      <ChartCard title="Остатки · Smart Alerts" subtitle="База меню">
        <div className="space-y-2">
          {MENU_STOCK.map((m) => (
            <div key={m.name} className="flex items-center justify-between bg-slate-50 rounded-xl px-3 py-3">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`w-8 h-8 rounded-full shrink-0 flex items-center justify-center ${
                    m.severity === "high" ? "bg-rose-100 text-rose-700" :
                    m.severity === "med" ? "bg-amber-100 text-amber-700" :
                    "bg-emerald-100 text-emerald-700"
                  }`}
                >
                  <AlertTriangle size={14} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{m.name}</p>
                  <p className="text-xs text-slate-500 truncate">Осталось {m.left} {m.unit} · {m.note}</p>
                </div>
              </div>
              <ChevronRight size={16} className="text-slate-400 shrink-0" />
            </div>
          ))}
        </div>
      </ChartCard>
    </div>
  );
}

function KPI({ label, value, delta, positive, live }: { label: string; value: string; delta: string; positive: boolean; live?: boolean }) {
  return (
    <div className="bg-white rounded-3xl p-4 border border-slate-200/70">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs text-slate-500 font-medium">{label}</p>
        {live && <span className="flex items-center gap-1 text-[10px] text-emerald-600 font-semibold"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />LIVE</span>}
      </div>
      <p className="text-xl font-bold tracking-tight">{value}</p>
      <div className={`flex items-center gap-0.5 text-xs mt-1 ${positive ? "text-emerald-600" : "text-rose-600"}`}>
        {positive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
        {delta}
      </div>
    </div>
  );
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-3xl p-5 border border-slate-200/70">
      <div className="mb-3">
        <h3 className="font-semibold">{title}</h3>
        <p className="text-xs text-slate-500">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

// ————————————————————— SUPPLY —————————————————————
function SupplyScreen() {
  const [cart, setCart] = useState(MENU_STOCK.filter((m) => m.severity !== "low").map((m) => m.name));
  const draft = (s: typeof SUPPLIERS[number]) =>
    `Привет! Нам как обычно: ${s.items}. Адрес тот же. Спасибо!`;

  const categories = useMemo(() => Array.from(new Set(SUPPLIERS.map((s) => s.category))), []);
  const [cat, setCat] = useState<string>("Все");

  const visible = SUPPLIERS.filter((s) => cat === "Все" || s.category === cat);

  return (
    <div className="px-4 pt-6 space-y-5">
      <header>
        <p className="text-xs text-slate-500 font-medium tracking-wide uppercase">Операции · Автозаказ</p>
        <h1 className="text-2xl font-bold tracking-tight">Закупки</h1>
      </header>

      {/* Smart cart */}
      <div className="bg-slate-900 text-white rounded-3xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-wide">Умная корзина</p>
            <p className="text-lg font-semibold mt-0.5">К закупке: {cart.length} позиции</p>
          </div>
          <ShoppingCart size={22} />
        </div>
        <div className="space-y-1.5 mb-4">
          {cart.map((c) => (
            <div key={c} className="flex items-center justify-between text-sm bg-white/10 rounded-lg px-3 py-2">
              <span>{c}</span>
              <button onClick={() => setCart(cart.filter((x) => x !== c))} className="text-slate-400 hover:text-white">
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
        <button className="w-full py-3.5 rounded-2xl bg-white text-slate-900 font-medium flex items-center justify-center gap-2">
          <Send size={16} /> Сформировать заказы
        </button>
      </div>

      {/* Category filter */}
      <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1" style={{ scrollbarWidth: "none" }}>
        {["Все", ...categories].map((c) => (
          <button
            key={c}
            onClick={() => setCat(c)}
            className={`shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-all duration-300 ${
              cat === c ? "bg-slate-900 text-white" : "bg-white text-slate-600 border border-slate-200/70"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Suppliers */}
      <div className="space-y-3">
        {visible.map((s) => (
          <div key={s.id} className="bg-white rounded-3xl p-5 border border-slate-200/70">
            <div className="flex items-start justify-between mb-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 uppercase tracking-wide">{s.category}</span>
                  <span className="text-[10px] font-semibold text-slate-500">Приоритет {s.priority}</span>
                </div>
                <p className="font-semibold text-lg truncate">{s.name}</p>
                <p className="text-xs text-slate-500 mt-0.5">{s.schedule}</p>
              </div>
            </div>

            <div className="bg-slate-50 rounded-2xl p-3 mb-3">
              <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1">Черновик автозаказа</p>
              <p className="text-sm text-slate-700 leading-snug">{draft(s)}</p>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <a href={`tel:${s.phone}`} className="flex items-center justify-center gap-1.5 py-3 rounded-2xl bg-white border border-slate-200 text-sm font-medium">
                <Phone size={14} /> Звонок
              </a>
              <a href={`https://wa.me/${s.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-1.5 py-3 rounded-2xl bg-white border border-slate-200 text-sm font-medium">
                <MessageCircle size={14} /> WhatsApp
              </a>
              <a
                href={`https://wa.me/${s.phone.replace(/\D/g, "")}?text=${encodeURIComponent(draft(s))}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-1.5 py-3 rounded-2xl bg-slate-900 text-white text-sm font-medium"
              >
                <Send size={14} /> Бот
              </a>
            </div>
          </div>
        ))}
      </div>

      <div className="h-4" />
    </div>
  );
}
