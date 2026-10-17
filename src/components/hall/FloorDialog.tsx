import { useRef, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

/** Radix provides focus trapping, Escape dismissal and focus restoration on every floor drawer. */
export function FloorDialog({
  title,
  description,
  onClose,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const opener = useRef<Element | null>(
    typeof document === "undefined" ? null : document.activeElement,
  );
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/30 backdrop-blur-[2px]" />
        <Dialog.Content
          onCloseAutoFocus={(event) => {
            if (opener.current?.isConnected && "focus" in opener.current) {
              event.preventDefault();
              (opener.current as HTMLElement).focus();
            }
          }}
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-3xl bg-slate-50 shadow-2xl outline-none md:inset-y-0 md:left-auto md:right-0 md:max-h-screen md:w-[430px] md:rounded-none"
        >
          <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-5 py-5">
            <div>
              <Dialog.Title className="text-xl font-semibold tracking-tight">{title}</Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-slate-500">
                {description ?? "Операционная карточка стола · Asia/Almaty"}
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="Закрыть карточку"
              className="rounded-full border bg-white p-3"
            >
              <X size={16} />
            </Dialog.Close>
          </header>
          <div className="min-h-0 overflow-y-auto overscroll-contain px-5 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-5">
            {children}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
