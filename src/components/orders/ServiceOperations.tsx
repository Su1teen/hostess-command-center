import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { staffApi, type DineOrder, controlClass } from "../../lib/dine-in-client";
import { StaffOrderComposer } from "./StaffOrderComposer";

export type Operations = {
  orders: DineOrder[];
  newCount: number;
  workingCount: number;
  unpaidCount: number;
  hasMore: boolean;
  asOf: string;
};
const Context = createContext<ReturnType<typeof useOperationsQuery> | null>(null);
function useOperationsQuery() {
  return useQuery({
    queryKey: ["service-operations"],
    queryFn: ({ signal }) => staffApi<Operations>("/dine-in/operations", { signal }),
    refetchInterval: 4000,
    refetchIntervalInBackground: true,
    retry: 2,
  });
}
export function useOperations() {
  return useContext(Context);
}
export function openStaffOrder(sessionId?: string) {
  window.dispatchEvent(new CustomEvent("hostess:create-order", { detail: sessionId }));
}
export function ServiceOperations({ children }: { children: ReactNode }) {
  const query = useOperationsQuery();
  const [composer, setComposer] = useState<{ sessionId?: string } | null>(null);
  const [sound, setSound] = useState(false),
    [notice, setNotice] = useState<DineOrder | null>(null);
  const [now, setNow] = useState(Date.now());
  const seen = useRef<Set<string> | null>(null),
    audio = useRef<AudioContext | null>(null);
  useEffect(() => {
    try {
      setSound(localStorage.getItem("hostess:service-sound") === "yes");
      if (sessionStorage.getItem("hostess:staff-checkout")) setComposer({});
    } catch {
      /* Storage may be disabled by the browser. */
    }
    const open = (e: Event) =>
      setComposer({ sessionId: (e as CustomEvent<string | undefined>).detail });
    const timer = setInterval(() => setNow(Date.now()), 1000);
    window.addEventListener("hostess:create-order", open);
    return () => {
      clearInterval(timer);
      window.removeEventListener("hostess:create-order", open);
      void audio.current?.close();
    };
  }, []);
  useEffect(() => {
    if (!query.data) return;
    const fresh = query.data.orders.filter(
      (o) => o.status === "new" && seen.current && !seen.current.has(o.id),
    );
    if (fresh.length) {
      setNotice(fresh[0]);
      if (sound && audio.current?.state === "running") {
        const osc = audio.current.createOscillator(),
          gain = audio.current.createGain();
        osc.connect(gain);
        gain.connect(audio.current.destination);
        gain.gain.value = 0.1;
        osc.frequency.value = 880;
        osc.start();
        osc.stop(audio.current.currentTime + 0.15);
      }
    }
    seen.current = new Set([...(seen.current ?? []), ...query.data.orders.map((o) => o.id)]);
  }, [query.data, sound]);
  const stale = query.isError || (!!query.dataUpdatedAt && now - query.dataUpdatedAt > 15000);
  return (
    <Context.Provider value={query}>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-2 text-xs">
        <a className="min-h-11 content-center font-semibold" href="/shift">
          Смена · новых: {query.data?.newCount ?? "…"}
        </a>
        <span role="status" className={stale ? "text-red-700" : "text-slate-500"}>
          {stale
            ? `Связь потеряна · обновлено ${query.dataUpdatedAt ? Math.floor((now - query.dataUpdatedAt) / 1000) : "—"} сек. назад`
            : "Заказы обновляются автоматически"}
        </span>
        <button
          className={controlClass}
          aria-pressed={sound}
          onClick={async () => {
            audio.current ??= new AudioContext();
            await audio.current.resume();
            const next = !sound;
            setSound(next);
            try {
              localStorage.setItem("hostess:service-sound", next ? "yes" : "no");
            } catch {
              /* Sound still works for this tab. */
            }
          }}
        >
          Звук {sound ? "вкл." : "выкл."}
        </button>
        {stale && (
          <button className={controlClass} onClick={() => void query.refetch()}>
            Повторить
          </button>
        )}
      </div>
      {notice && (
        <div
          role="status"
          className="fixed inset-x-4 top-4 z-50 mx-auto flex max-w-lg items-center justify-between gap-3 rounded-2xl bg-slate-900 p-4 text-sm text-white shadow-xl"
        >
          <a href={`/orders?order=${notice.id}`}>
            Новый заказ №{notice.number} · Стол {notice.tableCode}
            <span className="block text-xs">{notice.zoneName}</span>
          </a>
          <button
            aria-label="Скрыть уведомление"
            className="min-h-11 px-2"
            onClick={() => setNotice(null)}
          >
            Закрыть
          </button>
        </div>
      )}
      {children}
      {composer && (
        <StaffOrderComposer sessionId={composer.sessionId} onClose={() => setComposer(null)} />
      )}
    </Context.Provider>
  );
}
