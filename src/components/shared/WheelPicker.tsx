import { useEffect, useRef } from "react";

export interface WheelOption<T extends string = string> {
  value: T;
  label: string;
}

const ROW = 44;
const VISIBLE = 5;

/**
 * iOS-style wheel column: native scroll with CSS scroll-snap (inertial on touch),
 * centred selected row, faded edges via mask-image.
 */
export function WheelColumn<T extends string>({
  options,
  value,
  onChange,
  align = "center",
  className = "",
}: {
  options: WheelOption<T>[];
  value: T;
  onChange: (value: T) => void;
  align?: "center" | "left" | "right";
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEmitted = useRef<T>(value);

  useEffect(() => {
    const el = ref.current;
    if (!el || lastEmitted.current === value) return;
    const index = options.findIndex((option) => option.value === value);
    if (index >= 0) el.scrollTo({ top: index * ROW, behavior: "smooth" });
    lastEmitted.current = value;
  }, [value, options]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const index = options.findIndex((option) => option.value === value);
    el.scrollTop = Math.max(0, index) * ROW;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const settle = () => {
    const el = ref.current;
    if (!el) return;
    const index = Math.min(options.length - 1, Math.max(0, Math.round(el.scrollTop / ROW)));
    const next = options[index]?.value;
    if (next !== undefined && next !== lastEmitted.current) {
      lastEmitted.current = next;
      onChange(next);
    }
  };

  const handleScroll = () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(settle, 90);
  };

  const pad = ((VISIBLE - 1) / 2) * ROW;
  const textAlign =
    align === "left"
      ? "justify-start pl-3"
      : align === "right"
        ? "justify-end pr-3"
        : "justify-center";

  return (
    <div className={`relative ${className}`} style={{ height: ROW * VISIBLE }}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-2xl bg-white/80"
        style={{ height: ROW }}
      />
      <div
        ref={ref}
        onScroll={handleScroll}
        onScrollEnd={settle}
        className="wheel-scroll relative h-full overflow-y-auto"
        style={{
          scrollSnapType: "y mandatory",
          WebkitOverflowScrolling: "touch",
          maskImage:
            "linear-gradient(to bottom, transparent 0%, black 30%, black 70%, transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to bottom, transparent 0%, black 30%, black 70%, transparent 100%)",
        }}
      >
        <div style={{ height: pad }} />
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              type="button"
              key={option.value}
              onClick={() => {
                lastEmitted.current = option.value;
                onChange(option.value);
                const index = options.findIndex((item) => item.value === option.value);
                ref.current?.scrollTo({ top: index * ROW, behavior: "smooth" });
              }}
              className={`flex w-full items-center ${textAlign} whitespace-nowrap tabular-nums transition-colors ${
                active ? "text-[22px] font-semibold text-slate-900" : "text-[19px] text-slate-400"
              }`}
              style={{ height: ROW, scrollSnapAlign: "center" }}
            >
              {option.label}
            </button>
          );
        })}
        <div style={{ height: pad }} />
      </div>
    </div>
  );
}
