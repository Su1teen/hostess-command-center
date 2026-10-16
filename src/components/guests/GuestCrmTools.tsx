import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  staffApi,
  useStaffRole,
  money,
  dateTime,
  controlClass,
  statusLabels,
} from "../../lib/dine-in-client";
type Guest = { id: string; name: string; phone: string | null; provisional: boolean };
type Summary = {
  wallet: { balanceMinor: number; expiringMinor: number; nextExpiry: string | null };
  transactions: {
    id: string;
    type: string;
    amountMinor: string;
    createdAt: string;
    expiresAt: string | null;
  }[];
  orders: {
    id: string;
    number: string;
    status: keyof typeof statusLabels;
    acceptedAt: string;
    payableMinor: string;
  }[];
  visits: { id: string; tableCode: string; openedAt: string; closedAt: string | null }[];
  audit: { actor: string; action: string; createdAt: string }[];
};
export function GuestCrmTools({
  selected,
  onSaved,
}: {
  selected: Guest | null;
  onSaved: () => void;
}) {
  const role = useStaffRole(),
    canWrite = role === "operator" || role === "manager";
  const [editing, setEditing] = useState(false);
  const summary = useQuery({
    queryKey: ["guest-loyalty", selected?.id],
    queryFn: () => staffApi<Summary>(`/loyalty/guests/${selected!.id}`),
    enabled: !!selected,
    refetchInterval: 15000,
  });
  const mutation = useMutation({
    mutationFn: ({ data, id }: { data: unknown; id?: string }) =>
      staffApi(`/guests${id ? `/${id}` : ""}`, {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      setEditing(false);
      onSaved();
    },
  });
  const formGuest = editing ? selected : null;
  return (
    <div className="mt-5 space-y-4">
      {canWrite && (
        <section className="rounded-2xl border bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold">
              {formGuest ? "Редактировать профиль" : "Создать гостя"}
            </h2>
            {selected && (
              <button className={controlClass} onClick={() => setEditing((v) => !v)}>
                {editing ? "Новый гость" : "Изменить выбранного"}
              </button>
            )}
          </div>
          <form
            key={formGuest?.id ?? "new"}
            className="mt-3 flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              mutation.mutate({
                id: formGuest?.id,
                data: { name: f.get("name"), phone: f.get("phone") },
              });
            }}
          >
            <input
              name="name"
              aria-label="Имя гостя"
              required
              maxLength={100}
              placeholder="Имя"
              defaultValue={formGuest?.name ?? ""}
              className={`${controlClass} min-w-0 grow`}
            />
            <input
              name="phone"
              aria-label="Телефон гостя"
              type="tel"
              required
              placeholder="+7 (7XX) XXX-XX-XX"
              defaultValue={formGuest?.phone ?? ""}
              className={`${controlClass} min-w-0 grow`}
            />
            <button disabled={mutation.isPending} className={controlClass}>
              {formGuest ? "Сохранить" : "Создать"}
            </button>
          </form>
          <p className="mt-3 text-xs text-slate-500">
            Созданный персоналом профиль не подтверждён. Совпадение телефона не даёт доступ к
            бонусам. Подтверждённый телефон изменяется через проверку владения.
          </p>
          {mutation.error && (
            <p role="alert" className="mt-2 text-sm text-red-700">
              {mutation.error.message}
            </p>
          )}
          {mutation.isSuccess && (
            <p role="status" className="mt-2 text-sm text-emerald-700">
              Профиль сохранён
            </p>
          )}
        </section>
      )}
      {selected && (
        <section className="rounded-2xl border bg-white p-4">
          <h2 className="font-semibold">Бонусы и история · {selected.name}</h2>
          {summary.error && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {summary.error.message}
            </p>
          )}
          {summary.isPending && (
            <p role="status" className="mt-3">
              Загружаем историю…
            </p>
          )}
          {summary.data && (
            <>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-emerald-50 p-3">
                  <p className="text-xs">Доступно</p>
                  <strong className="text-xl">{money(summary.data.wallet.balanceMinor)}</strong>
                </div>
                <div className="rounded-xl bg-amber-50 p-3">
                  <p className="text-xs">Истекает за 3 дня</p>
                  <strong className="text-xl">{money(summary.data.wallet.expiringMinor)}</strong>
                </div>
              </div>
              {summary.data.wallet.nextExpiry && (
                <p className="mt-2 text-xs text-slate-500">
                  Ближайшее истечение: {dateTime(summary.data.wallet.nextExpiry)}
                </p>
              )}
              <h3 className="mt-5 text-sm font-semibold">Заказы</h3>
              <div className="mt-2 space-y-2">
                {summary.data.orders.map((o) => (
                  <a key={o.id} href="/orders" className="block rounded-xl border p-3 text-sm">
                    №{o.number} · {statusLabels[o.status]} · {money(o.payableMinor)}
                    <span className="block text-xs text-slate-500">{dateTime(o.acceptedAt)}</span>
                  </a>
                ))}
                {!summary.data.orders.length && (
                  <p className="text-sm text-slate-500">Заказов пока нет</p>
                )}
              </div>
              <h3 className="mt-5 text-sm font-semibold">Посещения по заказам</h3>
              {summary.data.visits.map((v) => (
                <p key={v.id} className="mt-2 text-xs">
                  Стол {v.tableCode} · {dateTime(v.openedAt)} ·{" "}
                  {v.closedAt ? "закрыто" : "обслуживание"}
                </p>
              ))}
              <h3 className="mt-5 text-sm font-semibold">История бонусов</h3>
              {summary.data.transactions.map((t) => (
                <div key={t.id} className="mt-2 flex justify-between gap-2 border-b py-2 text-xs">
                  <span>
                    {{
                      earn: "Начисление",
                      redeem: "Списание",
                      expire: "Истечение",
                      reversal: "Компенсация",
                      adjustment: "Корректировка",
                    }[t.type] ?? t.type}{" "}
                    · {dateTime(t.createdAt)}
                    {t.expiresAt && (
                      <span className="block text-slate-400">
                        Срок партии: {dateTime(t.expiresAt)}
                      </span>
                    )}
                  </span>
                  <strong>{money(t.amountMinor)}</strong>
                </div>
              ))}
              <details className="mt-5 text-xs">
                <summary className="cursor-pointer">Аудит профиля</summary>
                {summary.data.audit.map((a, i) => (
                  <p key={i} className="mt-2">
                    {a.action} · {a.actor} · {dateTime(a.createdAt)}
                  </p>
                ))}
              </details>
            </>
          )}
        </section>
      )}
    </div>
  );
}
