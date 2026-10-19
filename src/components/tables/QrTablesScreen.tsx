import { cloneElement, isValidElement, useEffect, useId, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowUpRight, Copy, Download, MapPin, Printer, Search, Settings2, X } from "lucide-react";
import {
  staffApi,
  useStaffRole,
  controlClass,
  dateTime,
  type QrTable,
  type QrRegistry,
} from "../../lib/dine-in-client";

const zoneLabel = (name: string) =>
  name === "ПС / общий зал" ? "ПС" : name === "VIP-комнаты" ? "VIP" : name;
const bookingLabel = (table: QrTable) =>
  table.bookingState === "pending"
    ? "Бронирование не настроено"
    : table.bookingState === "available"
      ? "Бронирование доступно"
      : "Бронирование недоступно";
const typeLabels = {
  table: "Обычный стол",
  private_room: "VIP-комната",
  bar_seating: "Иная точка обслуживания",
};
const primaryClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-medium text-white disabled:opacity-40";
const secondaryClass = `${controlClass} inline-flex items-center justify-center gap-2`;
type Draft = ReturnType<typeof draftOf>;
function draftOf(table: QrTable) {
  return {
    version: table.version,
    name: table.name,
    zoneId: table.zoneId,
    resourceType: table.resourceType,
    capacity: table.capacity === null ? "" : String(table.capacity),
    enabled: table.enabled,
    bookable: table.bookable,
    relationship: table.relationship,
    linkedResourceId: table.linkedResourceId,
    legacyCode: table.legacyCode,
    verified: table.mappingVerified,
    verificationNote: table.verificationNote ?? "",
  };
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className="text-sm font-medium text-slate-700">
      <label htmlFor={id}>{label}</label>
      <div className="mt-1.5">
        {isValidElement<{ id?: string }>(children) ? cloneElement(children, { id }) : children}
      </div>
    </div>
  );
}
function Panel({
  title,
  description,
  open,
  onClose,
  children,
}: {
  title: string;
  description: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/30 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex w-full flex-col overflow-hidden bg-white shadow-2xl sm:max-w-xl">
          <div className="border-b border-slate-100 px-5 py-5 pr-16 sm:px-7">
            <Dialog.Title className="text-xl font-semibold text-slate-900">{title}</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-slate-500">
              {description}
            </Dialog.Description>
          </div>
          <button
            aria-label="Закрыть панель"
            onClick={onClose}
            className="absolute right-3 top-3 flex size-11 items-center justify-center rounded-xl hover:bg-slate-100"
          >
            <X size={20} />
          </button>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function QrTablesScreen() {
  const manager = useStaffRole() === "manager",
    client = useQueryClient();
  const [zone, setZone] = useState("all"),
    [search, setSearch] = useState(""),
    [message, setMessage] = useState("");
  const [editing, setEditing] = useState<QrTable | null>(null),
    [draft, setDraft] = useState<Draft | null>(null);
  const [selected, setSelected] = useState<string[]>([]),
    [bulk, setBulk] = useState(false),
    [bulkZone, setBulkZone] = useState("");
  const [bulkNames, setBulkNames] = useState<Record<string, string>>({}),
    [bulkReview, setBulkReview] = useState(false),
    [bulkVersions, setBulkVersions] = useState<Record<string, number>>({});
  const [exportOpen, setExportOpen] = useState(false);
  const query = useQuery({
    queryKey: ["qr-tables"],
    queryFn: () => staffApi<QrRegistry>("/tables/qr"),
  });
  const tables = query.data?.tables ?? [],
    zones = query.data?.zones ?? [];
  const dirty = !!editing && !!draft && JSON.stringify(draft) !== JSON.stringify(draftOf(editing));
  const bulkDirty = bulk && (!!bulkZone || Object.keys(bulkNames).length > 0);
  useEffect(() => {
    const before = (event: BeforeUnloadEvent) => {
      if (dirty || bulkDirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [dirty, bulkDirty]);
  const visible = tables.filter(
    (t) =>
      (zone === "all" || t.zoneId === zone) &&
      `${t.code} ${t.name}`.toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru")),
  );
  const selectedTables = tables.filter((table) => selected.includes(table.resourceId));
  const exportTables = selected.length ? selectedTables : visible;
  const exportQuery = `?ids=${exportTables.map((table) => table.resourceId).join(",")}`;
  const mutation = useMutation({
    mutationFn: ({
      path,
      data,
      method = "PATCH",
    }: {
      path: string;
      data: unknown;
      method?: string;
    }) => staffApi<{ tables: QrTable[] }>(path, { method, body: JSON.stringify(data) }),
    onSuccess: (data, variables) => {
      client.setQueryData<QrRegistry>(["qr-tables"], (old) =>
        old ? { ...old, tables: data.tables } : old,
      );
      setMessage(
        variables.path.endsWith("/rotate")
          ? "QR перевыпущен. Скачайте и замените печатную панель."
          : "Изменения сохранены. QR-ссылки сохранены.",
      );
      setEditing(null);
      setDraft(null);
      setBulk(false);
      setBulkNames({});
      setBulkZone("");
      setBulkReview(false);
      void client.invalidateQueries({ queryKey: ["qr-tables"] });
    },
  });
  const history = useQuery({
    queryKey: ["table-history", editing?.resourceId, editing?.version],
    enabled: !!editing,
    queryFn: () =>
      staffApi<{ history: { action: string; actor: string; createdAt: string }[] }>(
        `/tables/${editing!.resourceId}/history`,
      ),
  });
  function closeEditor() {
    if (!dirty || window.confirm("Есть несохранённые изменения. Закрыть без сохранения?")) {
      setEditing(null);
      setDraft(null);
      mutation.reset();
    }
  }
  function closeBulk() {
    if (!bulkDirty || window.confirm("Закрыть настройку без сохранения?")) {
      setBulk(false);
      setBulkNames({});
      setBulkZone("");
      setBulkReview(false);
      mutation.reset();
    }
  }
  function openEditor(table: QrTable) {
    mutation.reset();
    setEditing(table);
    setDraft(draftOf(table));
  }
  async function copy(table: QrTable) {
    try {
      await navigator.clipboard.writeText(table.url);
      setMessage(`Ссылка стола ${table.code} скопирована`);
    } catch {
      setMessage("Копирование недоступно. Откройте страницу стола и скопируйте адрес.");
    }
  }
  function toggle(id: string) {
    setSelected((old) => (old.includes(id) ? old.filter((value) => value !== id) : [...old, id]));
  }
  const needsSetup = tables.filter(
    (t) => !t.mappingVerified || !t.capacity || t.zoneCode === "qr_unassigned",
  ).length;
  const bulkChanges = selectedTables.flatMap((t) => {
    const name = bulkNames[t.resourceId];
    return bulkZone || (name !== undefined && name !== t.name)
      ? [
          {
            resourceId: t.resourceId,
            version: bulkVersions[t.resourceId],
            ...(bulkZone ? { zoneId: bulkZone } : {}),
            ...(name !== undefined ? { name } : {}),
          },
        ]
      : [];
  });
  return (
    <div className="mx-auto max-w-[1500px] space-y-6 px-4 py-6 text-slate-900 sm:px-7 sm:py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-400">
            XOXO · управление залом
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Столы и QR</h1>
          <p className="mt-2 text-sm text-slate-500">
            Постоянные QR-ссылки и реальные места обслуживания.
          </p>
        </div>
        <Link to="/orders" className={secondaryClass}>
          К заказам <ArrowUpRight size={15} />
        </Link>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200/80 bg-white p-4 sm:p-5">
        <div className="flex flex-wrap gap-x-7 gap-y-3">
          <div>
            <b className="text-2xl font-semibold">{tables.length}</b>
            <p className="text-xs text-slate-500">точек обслуживания</p>
          </div>
          <div>
            <b className="text-2xl font-semibold">{tables.filter((t) => t.enabled).length}</b>
            <p className="text-xs text-slate-500">активных QR</p>
          </div>
          <div>
            <b className="text-2xl font-semibold text-amber-600">{needsSetup}</b>
            <p className="text-xs text-slate-500">требуют настройки</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            disabled={!exportTables.length}
            onClick={() => setExportOpen(true)}
            className={secondaryClass}
          >
            <Download size={16} />
            Скачать все QR
          </button>
          <a
            className={secondaryClass}
            href={`/api/staff/v1/tables/qr/print${exportQuery}`}
            target="_blank"
            rel="noreferrer"
          >
            <Printer size={16} />
            Печать
          </a>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="group"
          aria-label="Фильтр по зонам"
          className="flex max-w-full flex-wrap gap-1 rounded-xl bg-slate-100 p-1"
        >
          <button
            onClick={() => setZone("all")}
            aria-pressed={zone === "all"}
            className={`min-h-11 rounded-lg px-3 text-sm ${zone === "all" ? "bg-white shadow-sm" : "text-slate-500"}`}
          >
            Все <span className="ml-1 text-xs text-slate-400">{tables.length}</span>
          </button>
          {zones
            .filter((z) => z.code !== "bar" || tables.some((t) => t.zoneId === z.id))
            .filter((z) => z.code !== "qr_unassigned" || tables.some((t) => t.zoneId === z.id))
            .map((z) => (
              <button
                key={z.id}
                onClick={() => setZone(z.id)}
                aria-pressed={zone === z.id}
                className={`min-h-11 rounded-lg px-3 text-sm ${zone === z.id ? "bg-white shadow-sm" : "text-slate-500"}`}
              >
                {zoneLabel(z.name)}{" "}
                <span className="ml-1 text-xs text-slate-400">
                  {tables.filter((t) => t.zoneId === z.id).length}
                </span>
              </button>
            ))}
        </div>
        <label className="relative w-full sm:w-64">
          <span className="sr-only">Найти стол по номеру или названию</span>
          <Search className="absolute left-3 top-3.5 text-slate-400" size={17} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Номер или название"
            className={`${controlClass} w-full pl-10`}
          />
        </label>
      </div>
      {manager && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <button
            className={secondaryClass}
            onClick={() => {
              mutation.reset();
              const items = selected.length ? selectedTables : visible;
              setSelected(items.map((t) => t.resourceId));
              setBulkVersions(Object.fromEntries(items.map((t) => [t.resourceId, t.version])));
              setBulk(true);
            }}
            disabled={!visible.length}
          >
            <Settings2 size={16} />
            Настроить расположение
          </button>
          {selected.length > 0 && (
            <>
              <span className="text-slate-500">Выбрано: {selected.length}</span>
              <button
                className="min-h-11 px-2 text-slate-600 underline"
                onClick={() => setSelected([])}
              >
                Снять выделение
              </button>
            </>
          )}
        </div>
      )}
      {message && (
        <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {message}
        </p>
      )}
      {query.error && (
        <div role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">
          {query.error.message}
          <button className="ml-3 min-h-11 underline" onClick={() => void query.refetch()}>
            Повторить загрузку
          </button>
        </div>
      )}
      {query.isPending && (
        <div role="status" className="rounded-2xl border bg-white p-10 text-center text-slate-500">
          Загружаем столы…
        </div>
      )}
      {!query.isPending && !query.error && visible.length === 0 && (
        <div className="rounded-2xl border border-dashed p-10 text-center text-slate-500">
          Столы не найдены. Измените поиск или зону.
        </div>
      )}
      {tables.some((t) => t.zoneCode === "qr_unassigned") && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Для части точек зона ещё не указана. Настройте фактическое расположение по проверке на
          месте.
        </p>
      )}
      {query.data?.distribution && !query.data.distribution.matchesExpected && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="font-medium">Распределение отличается от плана заведения</p>
          <p className="mt-1">
            По плану: {query.data.distribution.expectedLabel}. Проверьте расположение на месте и
            используйте «Настроить расположение» для исправлений.
          </p>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {visible.map((t) => (
          <article
            key={t.id}
            className={`min-w-0 rounded-2xl border bg-white p-5 transition-shadow hover:shadow-md ${selected.includes(t.resourceId) ? "border-slate-700 ring-1 ring-slate-700" : "border-slate-200/80"}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold">{t.name}</h2>
                <p className="mt-1 flex items-center gap-1 text-sm text-slate-400">
                  <MapPin size={13} />
                  {zoneLabel(t.zoneName)} · № {t.code}
                </p>
              </div>
              {manager && (
                <label className="flex size-11 shrink-0 items-center justify-center">
                  <input
                    type="checkbox"
                    aria-label={`Выбрать стол ${t.code}`}
                    className="size-4 accent-slate-900"
                    checked={selected.includes(t.resourceId)}
                    onChange={() => toggle(t.resourceId)}
                  />
                </label>
              )}
            </div>
            <div className="my-4 flex justify-center rounded-xl bg-slate-50 py-3">
              <img
                width="144"
                height="144"
                className="size-36 bg-white"
                src={`/api/staff/v1/tables/${t.resourceId}/qr.svg?v=${t.generation}`}
                alt={`QR стола ${t.code}`}
                loading="lazy"
              />
            </div>
            <p
              className={`flex items-center gap-2 text-sm ${t.enabled ? "text-emerald-700" : "text-slate-500"}`}
            >
              <span
                className={`size-1.5 rounded-full ${t.enabled ? "bg-emerald-500" : "bg-slate-400"}`}
              />
              {t.enabled ? "QR-заказы включены" : "QR-заказы приостановлены"}
            </p>
            <p className="mt-1.5 text-xs text-slate-400">{bookingLabel(t)}</p>
            <div className="mt-5 grid grid-cols-[1fr_auto_auto] gap-2">
              <button className={primaryClass} onClick={() => openEditor(t)}>
                Открыть
              </button>
              <button
                title="Скопировать ссылку"
                aria-label={`Скопировать ссылку стола ${t.code}`}
                className={secondaryClass}
                onClick={() => void copy(t)}
              >
                <Copy size={16} />
              </button>
              <a
                title="Скачать QR PNG"
                aria-label={`Скачать QR PNG стола ${t.code}`}
                className={secondaryClass}
                href={`/api/staff/v1/tables/${t.resourceId}/qr.png?download=1`}
              >
                <Download size={16} />
              </a>
            </div>
          </article>
        ))}
      </div>
      <Panel
        open={!!editing}
        onClose={closeEditor}
        title={editing ? `${editing.name} · № ${editing.code}` : "Стол"}
        description="Один стол, одна постоянная QR-ссылка."
      >
        {editing && draft && (
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate({
                path: `/tables/${editing.resourceId}/registry`,
                data: { ...draft, capacity: draft.capacity === "" ? null : Number(draft.capacity) },
              });
            }}
          >
            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-6 sm:px-7">
              <section className="space-y-4">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                  Основное
                </h3>
                <Field label="Название">
                  <input
                    disabled={!manager}
                    required
                    maxLength={100}
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    className={`${controlClass} w-full`}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Номер">
                    <input
                      readOnly
                      value={editing.code}
                      className={`${controlClass} w-full bg-slate-50 text-slate-500`}
                    />
                  </Field>
                  <Field label="Вместимость">
                    <input
                      disabled={!manager}
                      type="number"
                      min={1}
                      max={200}
                      value={draft.capacity}
                      onChange={(e) => setDraft({ ...draft, capacity: e.target.value })}
                      placeholder="Не подтверждена"
                      className={`${controlClass} w-full`}
                    />
                  </Field>
                </div>
                <Field label="Зона">
                  <select
                    disabled={!manager}
                    value={draft.zoneId}
                    onChange={(e) => setDraft({ ...draft, zoneId: e.target.value })}
                    className={`${controlClass} w-full`}
                  >
                    {zones.map((z) => (
                      <option value={z.id} key={z.id}>
                        {zoneLabel(z.name)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Тип точки">
                  <select
                    disabled={!manager}
                    value={draft.resourceType}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        resourceType: e.target.value as QrTable["resourceType"],
                      })
                    }
                    className={`${controlClass} w-full`}
                  >
                    {Object.entries(typeLabels).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
              </section>
              <section className="space-y-3 border-t border-slate-100 pt-5">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                  QR и заказы
                </h3>
                <div className="flex flex-wrap items-center gap-4">
                  <img
                    width={110}
                    height={110}
                    src={`/api/staff/v1/tables/${editing.resourceId}/qr.svg?v=${editing.generation}`}
                    alt={`QR стола ${editing.code}`}
                  />
                  <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
                    <button
                      type="button"
                      className={secondaryClass}
                      onClick={() => void copy(editing)}
                    >
                      <Copy size={15} />
                      Скопировать ссылку
                    </button>
                    <a
                      href={editing.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-11 items-center gap-1 text-sm text-slate-500"
                    >
                      Открыть меню гостя <ArrowUpRight size={15} />
                    </a>
                  </div>
                </div>
                <label className="flex min-h-11 items-center gap-3 text-sm">
                  <input
                    disabled={!manager}
                    type="checkbox"
                    checked={draft.enabled}
                    onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                    className="size-4 accent-slate-900"
                  />
                  Принимать QR-заказы
                </label>
                <div className="flex gap-2">
                  {["png", "svg"].map((ext) => (
                    <a
                      key={ext}
                      className={secondaryClass}
                      href={`/api/staff/v1/tables/${editing.resourceId}/qr.${ext}?download=1`}
                    >
                      <Download size={15} />
                      {ext.toUpperCase()}
                    </a>
                  ))}
                </div>
              </section>
              <details className="space-y-4 border-t border-slate-100 pt-5">
                <summary className="min-h-11 cursor-pointer text-sm font-semibold text-slate-600">
                  Связь с бронированиями
                </summary>
                <Field label="Физическое соответствие">
                  <select
                    disabled={!manager}
                    value={draft.relationship}
                    className={`${controlClass} w-full`}
                    onChange={(e) => {
                      const relationship = e.target.value as QrTable["relationship"];
                      setDraft({
                        ...draft,
                        relationship,
                        linkedResourceId: null,
                        legacyCode: null,
                        verified: false,
                        bookable: draft.bookable,
                      });
                    }}
                  >
                    <option value="pending">Нужно уточнить</option>
                    <option value="independent">Не связана с существующим местом</option>
                    <option value="linked">Соответствует существующему месту</option>
                  </select>
                </Field>
                {draft.relationship === "linked" && (
                  <Field label="Существующее место">
                    <select
                      disabled={!manager}
                      required
                      value={
                        draft.linkedResourceId ??
                        (draft.legacyCode ? `legacy:${draft.legacyCode}` : "")
                      }
                      className={`${controlClass} w-full`}
                      onChange={(e) => {
                        const target = query.data?.bookingTargets.find(
                          (t) => t.id === e.target.value,
                        );
                        if (!target) return;
                        const targetZone = zones.find((z) => z.name === target.zoneName);
                        setDraft({
                          ...draft,
                          linkedResourceId: target.id.startsWith("legacy:") ? null : target.id,
                          legacyCode: target.id.startsWith("legacy:") ? target.code : null,
                          capacity: String(target.capacity ?? ""),
                          resourceType: target.resourceType,
                          zoneId: targetZone?.id ?? draft.zoneId,
                          verified: false,
                          bookable: target.bookable,
                        });
                      }}
                    >
                      <option value="">Выберите место</option>
                      {query.data?.bookingTargets
                        .filter(
                          (t) =>
                            !t.linkedFromResourceId ||
                            t.linkedFromResourceId === editing.resourceId,
                        )
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} · {typeLabels[t.resourceType]} · {zoneLabel(t.zoneName)} ·{" "}
                            {t.capacity ?? "?"} мест
                          </option>
                        ))}
                    </select>
                  </Field>
                )}
                {draft.relationship !== "pending" && (
                  <>
                    <label className="flex min-h-11 items-center gap-3 text-sm">
                      <input
                        disabled={!manager}
                        type="checkbox"
                        checked={draft.verified}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            verified: e.target.checked,
                            bookable: draft.bookable,
                          })
                        }
                        className="size-4 accent-slate-900"
                      />
                      Расположение проверено на месте
                    </label>
                    <Field label="Основание проверки">
                      <input
                        disabled={!manager}
                        value={draft.verificationNote}
                        maxLength={500}
                        minLength={draft.verified ? 3 : undefined}
                        required={draft.verified}
                        placeholder="Например: сверено владельцем в зале"
                        className={`${controlClass} w-full`}
                        onChange={(e) => setDraft({ ...draft, verificationNote: e.target.value })}
                      />
                    </Field>
                  </>
                )}
                <label className="flex min-h-11 items-center gap-3 text-sm">
                  <input
                    disabled={!manager}
                    type="checkbox"
                    checked={draft.bookable}
                    onChange={(e) => setDraft({ ...draft, bookable: e.target.checked })}
                    className="size-4 accent-slate-900"
                  />
                  Разрешить бронирования
                </label>
                <p className="rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-500">
                  {draft.relationship === "linked"
                    ? "Связанные записи учитываются как одно физическое место. Подтвердите совпадение зоны, типа и вместимости."
                    : "Бронирование работает независимо от отметки проверки. Если вместимость не указана, ограничение по числу мест не применяется. Реальные пересечения проверяет база."}
                </p>
              </details>
              <details className="border-t border-slate-100 pt-4">
                <summary className="min-h-11 cursor-pointer text-sm text-slate-500">
                  Дополнительно
                </summary>
                <div className="space-y-4 pb-3 pt-2">
                  <div>
                    <h4 className="text-sm font-medium">История изменений</h4>
                    {history.isPending ? (
                      <p className="mt-2 text-xs text-slate-400">Загружаем…</p>
                    ) : history.error ? (
                      <p className="mt-2 text-xs text-red-700">История недоступна</p>
                    ) : !history.data?.history.length ? (
                      <p className="mt-2 text-xs text-slate-400">Изменений пока нет</p>
                    ) : (
                      <ul className="mt-2 space-y-2">
                        {history.data?.history.map((entry, i) => (
                          <li key={`${entry.createdAt}-${i}`} className="text-xs text-slate-500">
                            {dateTime(entry.createdAt)} ·{" "}
                            {entry.action === "qr_rotated"
                              ? "QR перевыпущен"
                              : "Настройки обновлены"}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <details>
                    <summary className="min-h-11 cursor-pointer text-xs text-slate-400">
                      Техническая информация
                    </summary>
                    <p className="break-all text-xs text-slate-400">
                      ID: {editing.resourceId}
                      <br />
                      Версия: {editing.version} · выпуск QR: {editing.generation}
                    </p>
                  </details>
                  {manager && (
                    <button
                      type="button"
                      className="min-h-11 text-sm text-red-700"
                      disabled={mutation.isPending}
                      onClick={() => {
                        if (
                          window.confirm(
                            "Перевыпустить QR? Старая ссылка перестанет работать. Потребуется распечатать и заменить панель на столе.",
                          )
                        )
                          mutation.mutate({
                            path: `/tables/${editing.resourceId}/qr/rotate`,
                            method: "POST",
                            data: { confirm: true },
                          });
                      }}
                    >
                      Перевыпустить QR
                    </button>
                  )}
                </div>
              </details>
              {mutation.error && (
                <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
                  {mutation.error.message}
                </p>
              )}
            </div>
            <div className="border-t bg-white px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-7">
              {manager ? (
                <>
                  <div className="mb-2 text-xs text-slate-400">
                    {dirty ? "Есть несохранённые изменения" : "Все изменения сохранены"}
                  </div>
                  <button
                    disabled={mutation.isPending || !dirty}
                    className={`${primaryClass} w-full`}
                    type="submit"
                  >
                    {mutation.isPending ? "Сохраняем…" : "Сохранить изменения"}
                  </button>
                </>
              ) : (
                <p className="text-sm text-slate-500">Настройки изменяет менеджер.</p>
              )}
            </div>
          </form>
        )}
      </Panel>
      <Panel
        open={bulk}
        onClose={closeBulk}
        title="Настроить расположение"
        description={`${selectedTables.length} выбранных точек. Сохранение не меняет QR-ссылки.`}
      >
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5 sm:p-7">
          <Field label="Зона для выбранных точек">
            <select
              value={bulkZone}
              onChange={(e) => {
                setBulkZone(e.target.value);
                setBulkReview(false);
              }}
              className={`${controlClass} w-full`}
            >
              <option value="">Сохранить текущие зоны</option>
              {zones
                .filter((z) => z.code !== "qr_unassigned")
                .map((z) => (
                  <option key={z.id} value={z.id}>
                    {zoneLabel(z.name)}
                  </option>
                ))}
            </select>
          </Field>
          <div className="space-y-3">
            {selectedTables.map((t) => (
              <div key={t.id} className="rounded-xl border border-slate-100 p-3">
                <Field label={`№ ${t.code} · ${zoneLabel(t.zoneName)}`}>
                  <input
                    required
                    maxLength={100}
                    aria-label={`Название стола ${t.code}`}
                    value={bulkNames[t.resourceId] ?? t.name}
                    onChange={(e) => {
                      setBulkNames({ ...bulkNames, [t.resourceId]: e.target.value });
                      setBulkReview(false);
                    }}
                    className={`${controlClass} w-full`}
                  />
                </Field>
              </div>
            ))}
          </div>
          {bulkReview && (
            <div role="status" className="rounded-xl bg-slate-50 p-4 text-sm">
              <h3 className="font-medium">Проверьте изменения перед сохранением</h3>
              <p className="mt-2 text-slate-500">
                Будет обновлено точек: {bulkChanges.length}. QR остаются прежними.
              </p>
              <ul className="mt-3 space-y-1 text-xs text-slate-500">
                {zones.map((z) => {
                  const count = tables.filter((t) =>
                    selected.includes(t.resourceId) && bulkZone
                      ? bulkZone === z.id
                      : t.zoneId === z.id,
                  ).length;
                  return count ? (
                    <li key={z.id}>
                      {zoneLabel(z.name)}: {count}
                    </li>
                  ) : null;
                })}
              </ul>
            </div>
          )}
          {mutation.error && (
            <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
              {mutation.error.message}
            </p>
          )}
        </div>
        <div className="border-t p-5 sm:px-7">
          <button
            className={`${primaryClass} w-full`}
            disabled={
              !bulkChanges.length ||
              mutation.isPending ||
              bulkChanges.some((c) => c.name !== undefined && !c.name.trim())
            }
            onClick={() =>
              bulkReview
                ? mutation.mutate({
                    path: "/tables/qr/bulk",
                    method: "POST",
                    data: { changes: bulkChanges },
                  })
                : setBulkReview(true)
            }
          >
            {mutation.isPending
              ? "Сохраняем…"
              : bulkReview
                ? "Подтвердить и сохранить"
                : "Проверить изменения"}
          </button>
        </div>
      </Panel>
      <Panel
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Печать и экспорт QR"
        description={`В комплекте: ${exportTables.length} ${selected.length ? "выбранных" : "по текущему фильтру"} точек.`}
      >
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5 sm:p-7">
          <p className="text-sm text-slate-500">
            Выберите зону или отметьте столы в каталоге для отдельного комплекта. Печатные панели
            содержат номер и фактическую зону.
          </p>
          <div className="grid grid-cols-2 gap-3">
            {exportTables.map((t) => (
              <div key={t.id} className="rounded-xl border p-3 text-center">
                <p className="text-xs tracking-widest">XOXO</p>
                <p className="mt-1 text-sm font-semibold">Стол {t.code}</p>
                <p className="mt-1 truncate text-xs text-slate-400">{zoneLabel(t.zoneName)}</p>
                <img
                  width={110}
                  height={110}
                  className="mx-auto mt-2 w-full max-w-28"
                  src={`/api/staff/v1/tables/${t.resourceId}/qr.svg?v=${t.generation}`}
                  alt={`Предпросмотр печати стола ${t.code}`}
                />
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 border-t p-5">
          <a href={`/api/staff/v1/tables/qr/export.zip${exportQuery}`} className={primaryClass}>
            <Download size={16} />
            ZIP · PNG и SVG
          </a>
          <a
            href={`/api/staff/v1/tables/qr/print${exportQuery}`}
            target="_blank"
            rel="noreferrer"
            className={secondaryClass}
          >
            <Printer size={16} />
            Печать A4
          </a>
        </div>
      </Panel>
    </div>
  );
}
