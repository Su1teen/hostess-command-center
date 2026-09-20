import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Maximize2, Minus, Plus, Tv } from "lucide-react";
import { FLOOR_HEIGHT, FLOOR_WIDTH, HALL_TABLES, TV_SCREENS } from "../../lib/hall/layout";
import type { TableOccupancy } from "../../lib/types/reservations";
import { renderChairs } from "./renderChairs";

export const OCCUPANCY_COLOR: Record<TableOccupancy, string> = {
  free: "#9FB9A2",
  booked: "#C88484",
  seated: "#C9A96E",
};

const MIN_SCALE = 0.6;
const MAX_SCALE = 2.5;
const TAP_SLOP = 8;
const VIEW_HEIGHT = 420;

interface View {
  scale: number;
  tx: number;
  ty: number;
}

type Point = { x: number; y: number };

function clampView(view: View, width: number, height: number): View {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale));
  const contentW = FLOOR_WIDTH * scale;
  const contentH = FLOOR_HEIGHT * scale;
  // Keep at least ~35% of the floor inside the viewport on each axis.
  const slackX = Math.max(width, contentW) * 0.35;
  const slackY = Math.max(height, contentH) * 0.35;
  const tx = Math.min(width - slackX, Math.max(slackX - contentW, view.tx));
  const ty = Math.min(height - slackY, Math.max(slackY - contentH, view.ty));
  return { scale, tx, ty };
}

function fitView(width: number, height: number): View {
  const scale = Math.min(width / FLOOR_WIDTH, height / FLOOR_HEIGHT);
  return {
    scale,
    tx: (width - FLOOR_WIDTH * scale) / 2,
    ty: (height - FLOOR_HEIGHT * scale) / 2,
  };
}

export function FloorPlan({
  occupancy,
  selectedId,
  onSelect,
  stale,
}: {
  occupancy: Map<string, TableOccupancy>;
  selectedId?: string | null;
  onSelect: (id: string) => void;
  stale?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: VIEW_HEIGHT });
  const [view, setView] = useState<View>({ scale: 0.8, tx: 0, ty: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;

  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ start: Point; view: View; dist: number; mid: Point } | null>(null);
  const moved = useRef(false);

  const fit = useCallback(() => {
    if (!size.width) return;
    setView(fitView(size.width, size.height));
  }, [size]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      setSize((prev) => (prev.width === width ? prev : { width, height: VIEW_HEIGHT }));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fitted = useRef(false);
  useEffect(() => {
    if (size.width && !fitted.current) {
      fitted.current = true;
      fit();
    }
  }, [size, fit]);

  const apply = (next: View) => setView(clampView(next, size.width, size.height));

  const zoomAround = (factor: number, center: Point, base = viewRef.current) => {
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, base.scale * factor));
    const ratio = scale / base.scale;
    apply({
      scale,
      tx: center.x - (center.x - base.tx) * ratio,
      ty: center.y - (center.y - base.ty) * ratio,
    });
  };

  const localPoint = (event: ReactPointerEvent): Point => {
    const rect = containerRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const snapshot = () => {
    const pts = [...pointers.current.values()];
    if (pts.length >= 2) {
      const [a, b] = pts;
      return {
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        dist: Math.hypot(a.x - b.x, a.y - b.y),
      };
    }
    return { mid: pts[0] ?? { x: 0, y: 0 }, dist: 0 };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    containerRef.current?.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, localPoint(event));
    if (pointers.current.size === 1) moved.current = false;
    const { mid, dist } = snapshot();
    gesture.current = { start: mid, view: viewRef.current, dist, mid };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId) || !gesture.current) return;
    pointers.current.set(event.pointerId, localPoint(event));
    const g = gesture.current;
    const { mid, dist } = snapshot();
    if (Math.hypot(mid.x - g.start.x, mid.y - g.start.y) > TAP_SLOP) moved.current = true;

    if (pointers.current.size >= 2 && g.dist > 0) {
      moved.current = true;
      const factor = dist / g.dist;
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, g.view.scale * factor));
      const ratio = scale / g.view.scale;
      apply({
        scale,
        tx: mid.x - (g.mid.x - g.view.tx) * ratio,
        ty: mid.y - (g.mid.y - g.view.ty) * ratio,
      });
    } else {
      apply({
        scale: g.view.scale,
        tx: g.view.tx + (mid.x - g.start.x),
        ty: g.view.ty + (mid.y - g.start.y),
      });
    }
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const wasSingle = pointers.current.size === 1;
    pointers.current.delete(event.pointerId);
    if (pointers.current.size === 0) {
      gesture.current = null;
      if (wasSingle && !moved.current && event.type === "pointerup") {
        // Pointer capture redirects the event to the container, so hit-test manually.
        const hit = document
          .elementFromPoint(event.clientX, event.clientY)
          ?.closest<SVGGElement>("[data-table-id]");
        const id = hit?.dataset.tableId;
        if (id) onSelect(id);
      }
    } else {
      const { mid, dist } = snapshot();
      gesture.current = { start: mid, view: viewRef.current, dist, mid };
    }
  };

  const zoomAroundRef = useRef(zoomAround);
  zoomAroundRef.current = zoomAround;
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAroundRef.current(event.deltaY < 0 ? 1.1 : 0.9, {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const center = { x: size.width / 2, y: size.height / 2 };

  return (
    <div className="relative overflow-hidden rounded-3xl bg-white shadow-sm">
      <div className="absolute right-3 top-3 z-10 flex gap-1 rounded-full bg-white/90 p-1 shadow-sm backdrop-blur">
        <button
          type="button"
          aria-label="Уменьшить"
          onClick={() => zoomAround(0.8, center)}
          className="rounded-full p-2.5 active:bg-slate-100"
        >
          <Minus size={16} />
        </button>
        <button
          type="button"
          aria-label="Увеличить"
          onClick={() => zoomAround(1.25, center)}
          className="rounded-full p-2.5 active:bg-slate-100"
        >
          <Plus size={16} />
        </button>
        <button
          type="button"
          aria-label="Показать весь зал"
          onClick={fit}
          className="rounded-full p-2.5 active:bg-slate-100"
        >
          <Maximize2 size={16} />
        </button>
      </div>
      <div
        ref={containerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={`relative w-full select-none overflow-hidden transition-opacity ${stale ? "opacity-70" : ""}`}
        style={{ height: VIEW_HEIGHT, touchAction: "none" }}
      >
        <svg
          width={FLOOR_WIDTH}
          height={FLOOR_HEIGHT}
          viewBox={`0 0 ${FLOOR_WIDTH} ${FLOOR_HEIGHT}`}
          className="absolute left-0 top-0 will-change-transform"
          style={{
            transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
            transformOrigin: "0 0",
          }}
        >
          <rect x="12" y="12" width="476" height="526" rx="22" fill="#f8fafc" stroke="#e2e8f0" />
          {TV_SCREENS.map((tv) => (
            <g key={tv.id}>
              <polygon points={tv.cone} fill="#c9a96e" opacity=".08" />
              <Tv x={tv.x - 14} y={tv.y - 14} size={16} color="#94a3b8" />
            </g>
          ))}
          {HALL_TABLES.map((table) => {
            const status = occupancy.get(table.id) ?? "free";
            const selected = selectedId === table.id;
            const cx = table.x + table.w / 2;
            const cy = table.y + table.h / 2;
            return (
              <g key={table.id} data-table-id={table.id} className="cursor-pointer">
                {table.shape === "round" &&
                  renderChairs(table.seats, cx, cy, Math.max(table.w, table.h) / 2 + 11)}
                <rect
                  x={table.x}
                  y={table.y}
                  width={table.w}
                  height={table.h}
                  rx={table.shape === "round" ? table.w / 2 : 10}
                  fill={OCCUPANCY_COLOR[status]}
                  opacity={selected ? 1 : 0.85}
                  stroke={selected ? "#0f172a" : "none"}
                  strokeWidth={selected ? 3 : 0}
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
        </svg>
      </div>
    </div>
  );
}
