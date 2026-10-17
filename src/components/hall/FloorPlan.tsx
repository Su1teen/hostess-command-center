import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import type { FloorResource } from "../../lib/floor-operations";
import type { MapPosition } from "../../lib/hall/operations";
import {
  resourcePosition,
  FLOOR_STATE_STYLE,
  FLOOR_STATE_LABEL,
} from "../../lib/hall/presentation";

const WIDTH = 1000,
  HEIGHT = 700;
type Point = { x: number; y: number };
export function FloorPlan({
  resources,
  selectedId,
  onSelect,
  editing = false,
  positions,
  onPosition,
}: {
  resources: FloorResource[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  editing?: boolean;
  positions?: Record<string, MapPosition>;
  onPosition?: (id: string, position: MapPosition) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    svg = useRef<SVGSVGElement>(null);
  const [zoom, setZoom] = useState(1),
    [pan, setPan] = useState({ x: 0, y: 0 });
  const [viewport, setViewport] = useState({ width: WIDTH, scale: 1 });
  const pointers = useRef(new Map<number, Point>());
  const pinch = useRef<{ distance: number; zoom: number; midpoint: Point; pan: Point } | null>(
    null,
  );
  const dragging = useRef<{ id: string; start: Point; layout: MapPosition } | null>(null);
  const gestureMoved = useRef(false);
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const rect = element.getBoundingClientRect();
      setViewport({
        width: rect.width,
        scale: Math.max(0.01, Math.min(rect.width / WIDTH, rect.height / HEIGHT)),
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const zoneId = resources[0]?.zoneId;
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [zoneId]);
  const changeZoom = (value: number) => setZoom(Math.min(3, Math.max(0.8, value)));
  const point = (e: PointerEvent): Point => ({ x: e.clientX, y: e.clientY });
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.set(e.pointerId, point(e));
    gestureMoved.current = false;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = {
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        zoom,
        midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        pan,
      };
      for (const id of pointers.current.keys()) e.currentTarget.setPointerCapture(id);
      dragging.current = null;
    }
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, point(e));
    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()],
        original = pinch.current;
      changeZoom(
        (original.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / Math.max(1, original.distance),
      );
      const rect = host.current?.getBoundingClientRect();
      setPan({
        x: Math.max(
          -WIDTH,
          Math.min(
            WIDTH,
            original.pan.x +
              (((a.x + b.x) / 2 - original.midpoint.x) * WIDTH) / (rect?.width ?? WIDTH),
          ),
        ),
        y: Math.max(
          -HEIGHT,
          Math.min(
            HEIGHT,
            original.pan.y +
              (((a.y + b.y) / 2 - original.midpoint.y) * HEIGHT) / (rect?.height ?? HEIGHT),
          ),
        ),
      });
      gestureMoved.current = true;
    } else if (editing && dragging.current && svg.current) {
      const drag = dragging.current,
        matrix = svg.current.getScreenCTM();
      if (!matrix) return;
      const dx = (e.clientX - drag.start.x) / matrix.a / zoom;
      const dy = (e.clientY - drag.start.y) / matrix.d / zoom;
      if (Math.hypot(dx, dy) > 4) gestureMoved.current = true;
      onPosition?.(drag.id, {
        ...drag.layout,
        x: Math.round(Math.max(0, Math.min(WIDTH - drag.layout.width, drag.layout.x + dx))),
        y: Math.round(Math.max(0, Math.min(HEIGHT - drag.layout.height, drag.layout.y + dy))),
      });
    }
  };
  const finish = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (!pointers.current.size) dragging.current = null;
  };
  const missing = resources.some(
    (resource) => resource.layout.x === null || resource.layout.y === null,
  );
  return (
    <section
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white"
      aria-label="Интерактивная карта зоны"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <p className="text-xs text-slate-500">
          {editing
            ? "Перетащите стол или используйте стрелки клавиатуры"
            : "Выберите стол · масштаб двумя пальцами"}
        </p>
        <div className="flex gap-1">
          <button
            type="button"
            aria-label="Уменьшить карту"
            className="min-h-11 rounded-lg p-3 hover:bg-slate-100"
            onClick={() => changeZoom(zoom / 1.2)}
          >
            <Minus size={16} />
          </button>
          <button
            type="button"
            aria-label="Увеличить карту"
            className="min-h-11 rounded-lg p-3 hover:bg-slate-100"
            onClick={() => changeZoom(zoom * 1.2)}
          >
            <Plus size={16} />
          </button>
          <button
            type="button"
            aria-label="Показать всю карту"
            className="min-h-11 rounded-lg p-3 hover:bg-slate-100"
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
          >
            <Maximize2 size={16} />
          </button>
        </div>
      </div>
      {missing && (
        <p className="border-b border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          Расположение не настроено. Столы без координат показаны в схематической сетке; она не
          описывает помещение.
        </p>
      )}
      <div
        ref={host}
        className="relative overflow-hidden bg-slate-50/50"
        style={{
          touchAction: editing ? "none" : "pan-y",
          aspectRatio: "10 / 7",
          minHeight: 280,
          maxHeight: 600,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
      >
        <svg
          ref={svg}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-full min-h-[280px] w-full"
          aria-label="Столы выбранной зоны"
        >
          <defs>
            <pattern id="floor-dots" width="25" height="25" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="1" fill="#dce3eb" />
            </pattern>
          </defs>
          <rect width={WIDTH} height={HEIGHT} fill="url(#floor-dots)" />
          <g
            transform={`translate(${WIDTH / 2 + pan.x},${HEIGHT / 2 + pan.y}) scale(${zoom}) translate(${-WIDTH / 2},${-HEIGHT / 2})`}
          >
            {resources.map((resource, index) => {
              const p = positions?.[resource.id] ?? resourcePosition(resource, index),
                style = FLOOR_STATE_STYLE[resource.state];
              const pixelsPerUnit = viewport.scale * zoom;
              const hitWidth = Math.max(p.width, 45 / pixelsPerUnit);
              const hitHeight = Math.max(p.height, 45 / pixelsPerUnit);
              const compact = viewport.width < 640;
              return (
                <g
                  key={resource.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${resource.name}: ${FLOOR_STATE_LABEL[resource.state]}`}
                  aria-pressed={selectedId === resource.id}
                  className="cursor-pointer outline-none focus:drop-shadow-lg"
                  transform={`translate(${p.x},${p.y}) rotate(${p.rotation},${p.width / 2},${p.height / 2})`}
                  onClick={() => {
                    if (!gestureMoved.current) onSelect(resource.id);
                  }}
                  onPointerDown={(e) => {
                    e.currentTarget.focus();
                    if (editing && pointers.current.size < 2) {
                      onSelect(resource.id);
                      dragging.current = { id: resource.id, start: point(e), layout: p };
                      host.current?.setPointerCapture(e.pointerId);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(resource.id);
                    }
                    if (
                      editing &&
                      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
                    ) {
                      e.preventDefault();
                      const step = e.shiftKey ? 20 : 5;
                      onPosition?.(resource.id, {
                        ...p,
                        x: Math.max(
                          0,
                          Math.min(
                            WIDTH - p.width,
                            p.x +
                              (e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0),
                          ),
                        ),
                        y: Math.max(
                          0,
                          Math.min(
                            HEIGHT - p.height,
                            p.y + (e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0),
                          ),
                        ),
                      });
                    }
                  }}
                >
                  <title>
                    {resource.name} · {FLOOR_STATE_LABEL[resource.state]}
                    {resource.capacity ? ` · ${resource.capacity} мест` : ""}
                  </title>
                  <rect
                    data-floor-hit-target=""
                    x={(p.width - hitWidth) / 2}
                    y={(p.height - hitHeight) / 2}
                    width={hitWidth}
                    height={hitHeight}
                    fill="transparent"
                    pointerEvents="all"
                  />
                  <rect
                    x={-4}
                    y={-4}
                    width={p.width + 8}
                    height={p.height + 8}
                    rx={p.shape === "round" ? p.width / 2 : 18}
                    fill="none"
                    stroke={selectedId === resource.id ? "#0f172a" : "transparent"}
                    strokeWidth={3}
                  />
                  <rect
                    width={p.width}
                    height={p.height}
                    rx={p.shape === "round" ? Math.min(p.width, p.height) / 2 : 14}
                    fill={style.fill}
                    stroke={style.stroke}
                    strokeWidth={2}
                  />
                  {compact ? (
                    <text
                      x={p.width / 2}
                      y={p.height / 2 + 5 / pixelsPerUnit}
                      textAnchor="middle"
                      fontSize={14 / pixelsPerUnit}
                      fontWeight={600}
                      aria-hidden="true"
                    >
                      <tspan fill="#172033">{resource.code}</tspan>
                      <tspan fill={style.text}> {style.mark}</tspan>
                    </text>
                  ) : (
                    <>
                      <text
                        x={p.width / 2}
                        y={p.height / 2 - 3}
                        textAnchor="middle"
                        fill="#172033"
                        fontSize={17}
                        fontWeight={600}
                      >
                        {resource.name.length > 19
                          ? `${resource.name.slice(0, 18)}…`
                          : resource.name}
                      </text>
                      <text
                        x={p.width / 2}
                        y={p.height / 2 + 20}
                        textAnchor="middle"
                        fill={style.text}
                        fontSize={11}
                      >
                        {style.mark}{" "}
                        {resource.state === "qr_activity"
                          ? "QR · без посадки"
                          : resource.state === "unconfigured"
                            ? "Нужна настройка"
                            : FLOOR_STATE_LABEL[resource.state]}
                      </text>
                    </>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      </div>
      {!resources.length && (
        <p className="p-6 text-center text-sm text-slate-500">
          В этой зоне нет назначенных QR-точек. Распределение настраивается в управлении столами.
        </p>
      )}
    </section>
  );
}
