import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { staffApi, money, controlClass } from "../../lib/dine-in-client";
import type { FloorSnapshot } from "../../lib/floor-operations";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "../ui/sheet";

type Product = {
  id: string;
  name: string;
  category?: string;
  price: number;
  imageUrl?: string | null;
  isAvailable: boolean;
};
type Quote = {
  id: string;
  expiresAt: string;
  payableMinor: number;
  items: { name: string; quantity: number; totalMinor: number }[];
};
type Attempt = { quote: Quote; key: string };
const storage = "hostess:staff-checkout";
export function StaffOrderComposer({
  sessionId,
  onClose,
}: {
  sessionId?: string;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [useGuest, setUseGuest] = useState(false),
    [redeem, setRedeem] = useState(0);
  const [session, setSession] = useState(sessionId ?? ""),
    [section, setSection] = useState("regular"),
    [search, setSearch] = useState("");
  const [cart, setCart] = useState<Record<string, number>>({}),
    [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [uncertain, setUncertain] = useState(false);
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null),
    [now, setNow] = useState(Date.now());
  const attempt = useRef<Attempt | null>(null),
    lock = useRef(false);
  const floor = useQuery({
    queryKey: ["composer-floor"],
    queryFn: () => staffApi<FloorSnapshot>("/floor"),
    refetchInterval: 4000,
  });
  const catalog = useQuery({
    queryKey: ["composer-catalog"],
    queryFn: () =>
      staffApi<{
        regular: { items: Product[] };
        exchange: { products: Product[]; currentRound: { id: string; endsAt: string } } | null;
      }>("/dine-in/catalog"),
    refetchInterval: 20000,
  });
  const guestContext = useQuery({
    queryKey: ["staff-visit-context", session],
    queryFn: () =>
      staffApi<{ guest?: { id: string; name: string }; wallet: { balanceMinor: number } | null }>(
        `/dine-in/staff-context?sessionId=${encodeURIComponent(session)}`,
      ),
    enabled: !!session,
    refetchInterval: 15000,
  });
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storage) ?? "null");
      if (saved?.quote?.id && saved?.key) {
        attempt.current = saved;
        setQuote(saved.quote);
        setUncertain(true);
      }
    } catch {
      /* Ignore invalid draft. */
    }
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const tables =
    floor.data?.zones.flatMap((z) =>
      z.resources
        .filter((r) => r.currentSession?.seatedAt)
        .map((r) => ({ id: r.currentSession!.id, label: `Стол ${r.code} · ${z.name}` })),
    ) ?? [];
  const products =
    section === "regular"
      ? (catalog.data?.regular.items ?? [])
      : (catalog.data?.exchange?.products ?? []);
  const valid = quote && Date.parse(quote.expiresAt) > now;
  async function calculate() {
    if (lock.current || attempt.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setQuote(null);
    try {
      setQuote(
        await staffApi<Quote>("/dine-in/staff-quotes", {
          method: "POST",
          body: JSON.stringify({
            sessionId: session,
            useVisitGuest: useGuest,
            redeemMinor: useGuest ? redeem * 100 : 0,
            items: Object.entries(cart).map(([key, quantity]) => ({
              productId: key.slice(2),
              quantity,
              itemType: key.startsWith("r:") ? "REGULAR_MENU" : "EXCHANGE",
            })),
          }),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function submit() {
    if (lock.current || (!attempt.current && !valid)) return;
    if (!attempt.current) attempt.current = { quote: quote!, key: crypto.randomUUID() };
    try {
      sessionStorage.setItem(storage, JSON.stringify(attempt.current));
    } catch {
      setError("Не удалось сохранить запрос для безопасного повтора");
      return;
    }
    lock.current = true;
    setBusy(true);
    setUncertain(true);
    setError("");
    try {
      const result = await staffApi<{ order: { id: string } }>("/dine-in/staff-orders", {
        method: "POST",
        body: JSON.stringify({
          quoteId: attempt.current.quote.id,
          idempotencyKey: attempt.current.key,
        }),
      });
      sessionStorage.removeItem(storage);
      attempt.current = null;
      setUncertain(false);
      for (const key of ["service-operations", "dining-orders", "floor-folio", "floor-operations"])
        void client.invalidateQueries({ queryKey: [key] });
      location.assign(`/orders?order=${result.order.id}`);
    } catch (e) {
      if (
        e instanceof Error &&
        "code" in e &&
        [
          "REQUOTE",
          "SESSION_CHANGED",
          "OWNER_CHANGED",
          "BALANCE_CHANGED",
          "INSUFFICIENT_BALANCE",
          "PRODUCT_UNAVAILABLE",
          "FORBIDDEN",
          "QUOTE_NOT_FOUND",
        ].includes(String(e.code))
      ) {
        sessionStorage.removeItem(storage);
        attempt.current = null;
        setUncertain(false);
        setQuote(null);
        setError(`${e.message}. Проверьте корзину и запросите новый расчёт.`);
      } else
        setError(
          "Ответ не получен. Заказ мог быть создан. Нажмите «Проверить заказ» — повтор безопасен.",
        );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !busy && !uncertain) onClose();
      }}
    >
      <SheetContent className="flex w-full flex-col overflow-y-auto sm:max-w-xl">
        <SheetTitle>Создать заказ</SheetTitle>
        <SheetDescription>Общая очередь и фолио текущего визита.</SheetDescription>
        <label className="mt-4 text-sm">
          Текущий визит
          <select
            aria-label="Стол для заказа"
            disabled={busy || uncertain}
            className={`${controlClass} mt-2 w-full`}
            value={session}
            onChange={(e) => {
              setSession(e.target.value);
              setUseGuest(false);
              setRedeem(0);
              setQuote(null);
              setCode(null);
            }}
          >
            <option value="">Выберите стол</option>
            {tables.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        {!tables.length && floor.data && (
          <a href="/" className="mt-3 text-sm underline">
            Сначала отметьте посадку гостей на карте зала
          </a>
        )}
        {guestContext.data?.guest && (
          <div className="mt-3 rounded-xl border p-3 text-sm">
            <label>
              <input
                type="checkbox"
                disabled={busy || uncertain}
                checked={useGuest}
                onChange={(e) => {
                  setUseGuest(e.target.checked);
                  setQuote(null);
                  setRedeem(0);
                }}
              />{" "}
              Гость из прибывшей брони: {guestContext.data.guest.name}
            </label>
            {useGuest && (
              <label className="mt-3 block">
                Списать бонусы · доступно {money(guestContext.data.wallet?.balanceMinor ?? 0)}
                <input
                  type="number"
                  min={0}
                  step={1}
                  max={Math.floor((guestContext.data.wallet?.balanceMinor ?? 0) / 100)}
                  disabled={busy || uncertain}
                  value={redeem}
                  onChange={(e) => {
                    setRedeem(Math.max(0, Math.floor(Number(e.target.value))));
                    setQuote(null);
                  }}
                  className={`${controlClass} mt-2 w-full`}
                />
              </label>
            )}
          </div>
        )}
        {!useGuest && (
          <p className="mt-2 text-xs text-slate-500">
            Гость без аккаунта · без начисления и списания бонусов. Для своих бонусов гость
            оформляет заказ со своего телефона.
          </p>
        )}
        {session && !uncertain && (
          <div className="mt-3 rounded-xl bg-blue-50 p-3 text-sm">
            <button
              disabled={busy}
              className={controlClass}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  setCode(
                    await staffApi("/dine-in/access", {
                      method: "POST",
                      body: JSON.stringify({ sessionId: session }),
                    }),
                  );
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Выдать код гостю без QR
            </button>
            {code && (
              <p className="mt-2">
                Код: <strong className="select-all font-mono text-xl">{code.code}</strong>
                <span className="mt-1 block text-xs">
                  {Date.parse(code.expiresAt) > now
                    ? `Ещё ${Math.ceil((Date.parse(code.expiresAt) - now) / 60000)} мин. · для одного телефона`
                    : "Код истёк. Выдайте новый."}
                </span>
              </p>
            )}
          </div>
        )}
        {(error || floor.error || catalog.error) && (
          <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">
            {error || floor.error?.message || catalog.error?.message}
          </p>
        )}
        <div className="mt-4 flex gap-2">
          {[
            ["regular", "Обычное меню"],
            ["exchange", "Биржа"],
          ].map(([key, label]) => (
            <button
              key={key}
              className={controlClass}
              aria-pressed={section === key}
              onClick={() => setSection(key)}
            >
              {label}
            </button>
          ))}
        </div>
        {section === "exchange" && (
          <p className="mt-2 text-xs">
            {catalog.data?.exchange
              ? `До конца раунда: ${Math.max(0, Math.floor((Date.parse(catalog.data.exchange.currentRound.endsAt) - now) / 1000))} сек.`
              : "Биржа временно недоступна"}
          </p>
        )}
        <input
          className={`${controlClass} mt-3`}
          aria-label="Поиск блюда"
          placeholder="Название или категория"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="mt-3 space-y-2">
          {products
            .filter((p) =>
              `${p.name} ${p.category ?? ""}`.toLowerCase().includes(search.toLowerCase()),
            )
            .map((p) => {
              const key = `${section === "regular" ? "r" : "e"}:${p.id}`;
              return (
                <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-xl border p-3">
                  {p.imageUrl && (
                    <img alt="" src={p.imageUrl} className="size-12 rounded-lg object-cover" />
                  )}
                  <div className="min-w-24 grow basis-24">
                    <p className="text-sm font-medium">{p.name}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {p.category} · {money(p.price * 100)}
                      {!p.isAvailable ? " · Недоступно" : ""}
                    </p>
                  </div>
                  <button
                    aria-label={`Убрать ${p.name}`}
                    disabled={busy || uncertain || !cart[key]}
                    className={controlClass}
                    onClick={() => {
                      setCart((prev) => {
                        const n = { ...prev };
                        if (n[key] > 1) n[key]--;
                        else delete n[key];
                        return n;
                      });
                      setQuote(null);
                    }}
                  >
                    −
                  </button>
                  <span>{cart[key] ?? 0}</span>
                  <button
                    aria-label={`Добавить ${p.name}`}
                    disabled={busy || uncertain || !p.isAvailable || (cart[key] ?? 0) >= 20}
                    className={controlClass}
                    onClick={() => {
                      setCart((prev) => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }));
                      setQuote(null);
                    }}
                  >
                    +
                  </button>
                </div>
              );
            })}
        </div>
        <div className="sticky bottom-0 mt-4 space-y-3 border-t bg-white py-4 pb-[calc(16px+env(safe-area-inset-bottom))]">
          {quote && (
            <div className="rounded-xl bg-slate-50 p-3 text-sm">
              {quote.items.map((i, n) => (
                <p key={n}>
                  {i.quantity} × {i.name} · {money(i.totalMinor)}
                </p>
              ))}
              <strong className="mt-3 block text-lg">К оплате: {money(quote.payableMinor)}</strong>
              <p className="mt-1 text-xs">
                {valid
                  ? `Ещё ${Math.ceil((Date.parse(quote.expiresAt) - now) / 1000)} сек.`
                  : "Цена истекла. Запросите новый расчёт."}
              </p>
            </div>
          )}
          <button
            disabled={busy || (!uncertain && (!session || !Object.keys(cart).length))}
            className={`${controlClass} w-full bg-slate-900! text-white`}
            onClick={() => void (uncertain || valid ? submit() : calculate())}
          >
            {busy
              ? "Проверяем…"
              : uncertain
                ? "Проверить заказ"
                : valid
                  ? "Подтвердить заказ"
                  : "Проверить цену"}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
