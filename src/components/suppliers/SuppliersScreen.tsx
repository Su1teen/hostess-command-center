import { ChevronDown, MessageCircle, Phone, Plus, Truck } from "lucide-react";
import { useState } from "react";
import { DEMO_SUPPLIERS, type DemoSupplier } from "../../lib/demoData";
import { formatKzt } from "../../lib/formatters/money";
import { BottomSheet } from "../shared/BottomSheet";

export function SuppliersScreen() {
  const [suppliers, setSuppliers] = useState(DEMO_SUPPLIERS);
  const [expandedId, setExpandedId] = useState<string | null>(DEMO_SUPPLIERS[0]?.id ?? null);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState({ name: "", category: "", contact: "", phone: "" });

  const addSupplier = () => {
    if (!draft.name.trim() || !draft.phone.trim()) return;
    const digits = draft.phone.replace(/\D/g, "");
    const supplier: DemoSupplier = {
      id: `local-${Date.now()}`,
      name: draft.name.trim(),
      category: draft.category.trim() || "Общие продукты",
      contact: draft.contact.trim() || "Контактное лицо",
      phone: draft.phone.trim(),
      whatsapp: digits,
      nextDelivery: "Дата уточняется",
      balance: 0,
      status: "Ожидает",
      products: [],
    };
    setSuppliers((current) => [supplier, ...current]);
    setExpandedId(supplier.id);
    setDraft({ name: "", category: "", contact: "", phone: "" });
    setShowForm(false);
  };

  return (
    <div className="space-y-5 px-4 pb-32 pt-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            Операции
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Поставщики</h1>
          <p className="mt-1 text-sm text-slate-500">Контакты, заказы и взаиморасчёты</p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-lg shadow-slate-900/10 active:scale-95"
          aria-label="Добавить поставщика"
        >
          <Plus size={20} />
        </button>
      </header>

      <section className="rounded-3xl bg-slate-900 p-4 text-white">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10">
            <Truck size={21} />
          </span>
          <div>
            <p className="text-sm text-slate-300">Открытый баланс</p>
            <p className="mt-0.5 text-2xl font-bold tabular-nums">
              {formatKzt(suppliers.reduce((sum, item) => sum + item.balance, 0))}
            </p>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3 text-xs text-slate-300">
          <span>
            {suppliers.length} партнёра ·{" "}
            {suppliers.filter((item) => item.status === "В доставке").length} в пути
          </span>
          <span className="rounded-full bg-emerald-400/15 px-2.5 py-1 text-emerald-300">
            Синхронизировано
          </span>
        </div>
      </section>

      <section className="space-y-3">
        {suppliers.map((supplier) => {
          const expanded = expandedId === supplier.id;
          return (
            <article key={supplier.id} className="overflow-hidden rounded-3xl bg-white shadow-sm">
              <button
                type="button"
                onClick={() => setExpandedId(expanded ? null : supplier.id)}
                className="flex min-h-20 w-full items-center gap-3 p-4 text-left"
                aria-expanded={expanded}
              >
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#EEF4EF] text-emerald-700">
                  <Truck size={21} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold">{supplier.name}</span>
                  <span className="mt-0.5 block truncate text-xs text-slate-500">
                    {supplier.category} · {supplier.contact}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span
                    className={`hidden rounded-full px-2 py-1 text-[10px] font-semibold sm:inline-flex ${supplier.status === "В доставке" ? "bg-amber-50 text-amber-700" : supplier.status === "Активен" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}
                  >
                    {supplier.status}
                  </span>
                  <ChevronDown
                    size={18}
                    className={`text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`}
                  />
                </span>
              </button>
              {expanded && (
                <div className="border-t border-slate-100 px-4 pb-4 pt-3">
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded-2xl bg-slate-50 p-3">
                      <p className="text-[11px] text-slate-500">Следующая поставка</p>
                      <p className="mt-1 font-semibold">{supplier.nextDelivery}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-3">
                      <p className="text-[11px] text-slate-500">Баланс</p>
                      <p className="mt-1 font-semibold tabular-nums">
                        {formatKzt(supplier.balance)}
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Товары
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    {supplier.products.length ? supplier.products.join(" · ") : "Добавьте товары"}
                  </p>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <a
                      href={`tel:${supplier.phone}`}
                      className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-slate-200 text-sm font-semibold active:bg-slate-50"
                    >
                      <Phone size={16} /> Позвонить
                    </a>
                    <a
                      href={`https://wa.me/${supplier.whatsapp}?text=${encodeURIComponent(`Здравствуйте, ${supplier.contact}! Подтвердите, пожалуйста, сегодняшнюю поставку.`)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#EAF7EE] text-sm font-semibold text-emerald-700 active:bg-emerald-100"
                    >
                      <MessageCircle size={16} /> WhatsApp
                    </a>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </section>

      {showForm && (
        <BottomSheet
          eyebrow="Новый партнёр"
          title="Добавить поставщика"
          onClose={() => setShowForm(false)}
        >
          <div className="space-y-3 pb-2">
            <input
              value={draft.name}
              onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))}
              placeholder="Название компании"
              className="field"
              autoComplete="organization"
            />
            <input
              value={draft.category}
              onChange={(event) =>
                setDraft((value) => ({ ...value, category: event.target.value }))
              }
              placeholder="Категория товаров"
              className="field"
            />
            <input
              value={draft.contact}
              onChange={(event) => setDraft((value) => ({ ...value, contact: event.target.value }))}
              placeholder="Контактное лицо"
              className="field"
              autoComplete="name"
            />
            <input
              value={draft.phone}
              onChange={(event) => setDraft((value) => ({ ...value, phone: event.target.value }))}
              placeholder="Телефон / WhatsApp"
              className="field"
              inputMode="tel"
              autoComplete="tel"
            />
            <button
              type="button"
              onClick={addSupplier}
              className="w-full rounded-2xl bg-slate-900 py-4 font-semibold text-white active:scale-[.99]"
            >
              Сохранить поставщика
            </button>
          </div>
        </BottomSheet>
      )}
    </div>
  );
}
