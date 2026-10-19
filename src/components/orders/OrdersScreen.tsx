import { useEffect, useState } from "react";
import { openStaffOrder } from "./ServiceOperations";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { OrderDrawer } from "./OrderDrawer";
import {
  staffApi,
  useStaffRole,
  money,
  dateTime,
  statusLabels,
  controlClass,
  type DineOrder,
} from "../../lib/dine-in-client";
export function OrdersScreen() {
  const role = useStaffRole(),
    canWrite = role === "operator" || role === "manager",
    client = useQueryClient();
  const [status, setStatus] = useState(""),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [group, setGroup] = useState(true);
  useEffect(() => {
    const orderId = new URLSearchParams(window.location.search).get("order");
    if (orderId && /^[a-f0-9-]{36}$/i.test(orderId)) setSelected(orderId);
  }, []);
  const list = useQuery({
    queryKey: ["dining-orders", status, search],
    queryFn: ({ signal }) =>
      staffApi<{ orders: DineOrder[]; outbox: { status: string; count: number }[] }>(
        `/dine-in/orders?${status ? `status=${status}&` : ""}q=${encodeURIComponent(search)}`,
        { signal },
      ),
    refetchInterval: 4000,
  });
  const mutation = useMutation({
    mutationFn: ({ path, method, data }: { path: string; method: string; data: unknown }) =>
      staffApi(path, { method, body: JSON.stringify(data) }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["dining-orders"] });
      void client.invalidateQueries({ queryKey: ["dining-order"] });
      void client.invalidateQueries({ queryKey: ["floor-folio"] });
      void client.invalidateQueries({ queryKey: ["floor-operations"] });
    },
  });
  const orders = list.data?.orders ?? [];
  const groups = group
    ? Array.from(
        orders.reduce<Map<string, DineOrder[]>>((acc, o) => {
          const rows = acc.get(o.tableCode) ?? [];
          rows.push(o);
          acc.set(o.tableCode, rows);
          return acc;
        }, new Map()),
      )
    : [["Все заказы", orders] as [string, DineOrder[]]];
  return (
    <div className="px-4 py-6 sm:px-6">
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest text-slate-500">XOXO · обслуживание</p>
          <h1 className="mt-2 text-3xl font-semibold">Заказы</h1>
          {canWrite && (
            <button className={`${controlClass} mt-3`} onClick={() => openStaffOrder()}>
              Создать заказ
            </button>
          )}
          <p className="mt-2 text-sm text-slate-500">Обновление каждые 4 секунды.</p>
        </div>
        <Link to="/tables/qr" className={`${controlClass} inline-flex items-center`}>
          QR столов
        </Link>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <input
          aria-label="Поиск заказов"
          placeholder="Стол, имя, телефон, № заказа"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`${controlClass} grow`}
        />
        <select
          aria-label="Статус заказа"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className={controlClass}
        >
          <option value="">Все статусы</option>
          {Object.entries(statusLabels).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <button className={controlClass} onClick={() => setGroup((v) => !v)}>
          {group ? "По столам" : "Общий список"}
        </button>
        <button className={controlClass} onClick={() => void list.refetch()}>
          Обновить
        </button>
      </div>
      {(list.error || mutation.error) && (
        <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-red-700">
          {(list.error ?? mutation.error)?.message}
        </p>
      )}
      {list.isPending && (
        <p role="status" className="mt-6">
          Загружаем заказы…
        </p>
      )}
      <div className="mt-5">
        <div className="space-y-5">
          {groups.map(([name, rows]) => (
            <section key={name}>
              <h2 className="mb-2 text-sm font-semibold text-slate-500">
                {group ? `Стол ${name}` : name} · {rows.length}
              </h2>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {rows.map((o) => (
                  <button
                    key={o.id}
                    onClick={() => {
                      setSelected(o.id);
                      void client.invalidateQueries({ queryKey: ["service-operations"] });
                      mutation.reset();
                    }}
                    className={`w-full rounded-2xl border p-4 text-left ${selected === o.id ? "border-slate-900 bg-slate-100" : "border-slate-200 bg-white"}`}
                  >
                    <div className="flex justify-between gap-3">
                      <strong>
                        №{o.number} · Стол {o.tableCode}
                      </strong>
                      <span
                        className={`rounded-full px-2 py-1 text-xs ${o.status === "new" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100"}`}
                      >
                        {statusLabels[o.status]}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-slate-500">
                      {o.guestName ?? "Гость без аккаунта"} · {dateTime(o.acceptedAt)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {o.zoneName} · {o.items.reduce((total, item) => total + item.quantity, 0)}{" "}
                      поз.
                    </p>
                    <div className="mt-3 flex gap-2">
                      {o.items.some((item) => item.itemType === "REGULAR_MENU") && (
                        <span className="rounded-full bg-amber-50 px-2 py-1 text-xs text-amber-800">
                          Основное меню
                        </span>
                      )}
                      {o.items.some((item) => item.itemType !== "REGULAR_MENU") && (
                        <span className="rounded-full bg-violet-50 px-2 py-1 text-xs text-violet-800">
                          Биржа
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-sm">
                      {o.items.map((i) => `${i.quantity} × ${i.name}`).join(", ")}
                    </p>
                    <p className="mt-3 flex justify-between font-semibold">
                      <span>{o.manualPaymentAt ? "Получение отмечено" : "К получению"}</span>
                      <span>{money(o.payableMinor)}</span>
                    </p>
                  </button>
                ))}
              </div>
            </section>
          ))}
          {!list.isPending && !orders.length && (
            <p className="rounded-2xl border border-dashed p-8 text-center text-slate-500">
              Заказов по выбранным условиям нет.
            </p>
          )}
          <p className="text-xs text-slate-400">
            Последние 100 заказов. Для истории используйте поиск и фильтр.
          </p>
          {list.data?.outbox.some((r) => r.status === "failed") && (
            <p className="text-xs text-amber-700">
              Биржа: есть события с повторной доставкой. Заказы сохранены.
              {role === "manager" && (
                <button
                  disabled={mutation.isPending}
                  className={controlClass}
                  onClick={() =>
                    mutation.mutate({
                      path: "/dine-in/outbox/retry",
                      method: "POST",
                      data: { reason: "Повторная доставка менеджером" },
                    })
                  }
                >
                  Повторить доставку
                </button>
              )}
            </p>
          )}
        </div>
        <OrderDrawer key={selected} orderId={selected} onClose={() => setSelected(null)} />
      </div>
    </div>
  );
}
