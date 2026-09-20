import type { ReactNode } from "react";
import { X } from "lucide-react";

export function BottomSheet({
  title,
  eyebrow,
  onClose,
  children,
  aside,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/30 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        className="flex max-h-[92dvh] w-full max-w-md flex-col rounded-t-[2rem] bg-slate-50 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-slate-300" />
        <div className="flex items-start justify-between px-5 pb-3 pt-3">
          <div className="min-w-0">
            {eyebrow && <p className="text-xs uppercase tracking-wide text-slate-500">{eyebrow}</p>}
            <h2 className="truncate text-2xl font-bold">{title}</h2>
          </div>
          <div className="flex items-center gap-2">
            {aside}
            <button
              type="button"
              onClick={onClose}
              aria-label="Закрыть"
              className="rounded-full bg-white p-2 shadow-sm"
            >
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="min-h-0 overflow-y-auto px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
          {children}
        </div>
      </section>
    </div>
  );
}
