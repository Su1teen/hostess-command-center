import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { staffApi, useStaffRole, controlClass, type QrTable } from "../../lib/dine-in-client";
export function QrTablesScreen() {
  const manager = useStaffRole() === "manager",
    client = useQueryClient();
  const [message, setMessage] = useState(""),
    [rotate, setRotate] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["qr-tables"],
    queryFn: () =>
      staffApi<{ tables: QrTable[]; zones: { id: string; name: string }[] }>("/tables/qr"),
  });
  const mutation = useMutation({
    mutationFn: ({ path, method, data }: { path: string; method: string; data: unknown }) =>
      staffApi(path, { method, body: JSON.stringify(data) }),
    onSuccess: () => {
      setRotate(null);
      setMessage("Сохранено");
      void client.invalidateQueries({ queryKey: ["qr-tables"] });
    },
  });
  return (
    <div className="px-4 py-6 sm:px-6">
      <div className="flex flex-wrap justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-slate-500">
            XOXO · 17 физических столов
          </p>
          <h1 className="mt-2 text-3xl font-semibold">QR-панели</h1>
          <p className="mt-2 max-w-xl text-sm text-slate-500">
            Ссылки постоянные. Назначьте реальную зону каждому столу перед размещением панелей.
          </p>
        </div>
        <Link to="/orders" className={`${controlClass} inline-flex items-center`}>
          К заказам
        </Link>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <a
          href="/api/staff/v1/tables/qr/export.zip"
          className={`${controlClass} inline-flex items-center`}
        >
          Все SVG и PNG · ZIP
        </a>
        <a
          href="/api/staff/v1/tables/qr/print"
          target="_blank"
          rel="noreferrer"
          className={`${controlClass} inline-flex items-center`}
        >
          Печать / PDF
        </a>
        {manager && (
          <button
            disabled={mutation.isPending}
            className={controlClass}
            onClick={() =>
              mutation.mutate({ path: "/tables/qr/bootstrap", method: "POST", data: {} })
            }
          >
            Проверить комплект
          </button>
        )}
      </div>
      {(query.error || mutation.error) && (
        <p role="alert" className="mt-4 text-red-700">
          {(query.error ?? mutation.error)?.message}
        </p>
      )}
      {message && (
        <p role="status" className="mt-3 text-sm text-emerald-700">
          {message}
        </p>
      )}
      {query.isPending && (
        <p role="status" className="mt-6">
          Загружаем QR из базы…
        </p>
      )}
      {query.data && query.data.tables.length !== 17 && (
        <p className="mt-3 text-amber-700">
          В комплекте {query.data.tables.length} QR. Менеджер может проверить bootstrap.
        </p>
      )}
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {query.data?.tables.map((t) => (
          <article
            key={`${t.id}:${t.generation}:${t.enabled}:${t.zoneId}:${t.name}:${t.mappingVerified}:${t.legacyCode}`}
            className="rounded-2xl border bg-white p-5"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Стол {t.code}</h2>
              <span
                className={`rounded-full px-2 py-1 text-xs ${t.enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100"}`}
              >
                {t.enabled ? "Заказы включены" : "Отключён"}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-500">{t.zoneName}</p>
            <p className="mt-1 text-sm text-amber-700">
              {t.mappingVerified
                ? `Расположение подтверждено: ${t.legacyCode ?? "отдельный стол"}`
                : "Расположение не подтверждено"}
              {t.bookable ? " · Бронирование доступно" : " · Бронирование выключено"}
            </p>
            <img
              className="mx-auto my-3 aspect-square w-44"
              src={`/api/staff/v1/tables/${t.resourceId}/qr.svg?v=${t.generation}`}
              alt={`QR стола ${t.code}`}
            />
            <a
              href={t.url}
              target="_blank"
              rel="noreferrer"
              className="block break-all text-xs text-slate-500"
            >
              {t.url}
            </a>
            <div className="mt-4 flex gap-2">
              <button
                className={controlClass}
                onClick={() =>
                  void navigator.clipboard
                    .writeText(t.url)
                    .then(() => setMessage(`Ссылка стола ${t.code} скопирована`))
                    .catch(() => setMessage("Выделите ссылку и скопируйте вручную."))
                }
              >
                Копировать
              </button>
              {["svg", "png"].map((ext) => (
                <a
                  key={ext}
                  className={`${controlClass} inline-flex items-center uppercase`}
                  href={`/api/staff/v1/tables/${t.resourceId}/qr.${ext}?download=1`}
                >
                  {ext}
                </a>
              ))}
            </div>
            {manager && (
              <form
                className="mt-4 space-y-3 border-t pt-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  mutation.mutate({
                    path: `/tables/${t.resourceId}`,
                    method: "PATCH",
                    data: {
                      name: f.get("name"),
                      zoneId: f.get("zoneId"),
                      enabled: f.get("enabled") === "on",
                    },
                  });
                }}
              >
                <label className="block text-xs">
                  Название
                  <input
                    name="name"
                    required
                    maxLength={100}
                    defaultValue={t.name}
                    className={`${controlClass} mt-1 w-full`}
                  />
                </label>
                <label className="block text-xs">
                  Зона
                  <select
                    name="zoneId"
                    defaultValue={t.zoneId}
                    className={`${controlClass} mt-1 w-full`}
                  >
                    {query.data?.zones.map((z) => (
                      <option key={z.id} value={z.id}>
                        {z.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input type="checkbox" name="enabled" defaultChecked={t.enabled} />
                  Принимать заказы
                </label>
                <button disabled={mutation.isPending} className={controlClass}>
                  Сохранить
                </button>
              </form>
            )}
            {manager && (
              <form
                className="mt-4 space-y-3 border-t pt-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  mutation.mutate({
                    path: `/tables/${t.resourceId}/mapping`,
                    method: "PATCH",
                    data: {
                      legacyCode: f.get("legacyCode") || null,
                      verified: f.get("verified") === "on",
                      reason: f.get("reason"),
                    },
                  });
                }}
              >
                <label className="block text-xs">
                  Старое обозначение
                  <select
                    name="legacyCode"
                    defaultValue={t.legacyCode ?? ""}
                    className={`${controlClass} mt-1 w-full`}
                  >
                    <option value="">Отдельный стол / не назначено</option>
                    {["A1", "A2", "A3", "B1", "B2", "B3", "B4", "C1", "C2", "Bar"].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input type="checkbox" name="verified" defaultChecked={t.mappingVerified} />
                  Физически проверено владельцем
                </label>
                <label className="block text-xs">
                  Основание проверки
                  <input
                    name="reason"
                    required
                    minLength={3}
                    maxLength={500}
                    className={`${controlClass} mt-1 w-full`}
                  />
                </label>
                <p className="text-xs text-slate-500">
                  Привязка не включает бронирование. Менять её можно только при отсутствии будущих
                  броней и активных удержаний.
                </p>
                <button disabled={mutation.isPending} className={controlClass}>
                  Сохранить привязку
                </button>
              </form>
            )}
            {manager && (
              <div className="mt-4 border-t pt-3">
                {rotate === t.resourceId ? (
                  <div>
                    <p className="text-xs text-red-700">
                      Старая ссылка перестанет действовать. Новую панель потребуется распечатать.
                    </p>
                    <div className="mt-2 flex gap-2">
                      <button
                        disabled={mutation.isPending}
                        className={`${controlClass} text-red-700`}
                        onClick={() =>
                          mutation.mutate({
                            path: `/tables/${t.resourceId}/qr/rotate`,
                            method: "POST",
                            data: { confirm: true },
                          })
                        }
                      >
                        Перевыпустить
                      </button>
                      <button className={controlClass} onClick={() => setRotate(null)}>
                        Назад
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    className="min-h-11 text-xs text-slate-500"
                    onClick={() => setRotate(t.resourceId)}
                  >
                    Перевыпустить QR
                  </button>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
