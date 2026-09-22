import { ChefHat, Package, Plus, Search, TrendingDown, TrendingUp, Utensils } from "lucide-react";
import { useMemo, useState } from "react";
import { DEMO_MENU, type DemoMenuItem } from "../../lib/demoData";
import { formatKzt } from "../../lib/formatters/money";
import { AlcoholCatalog } from "../catalog/AlcoholCatalog";

const categories = [
  "Все блюда",
  "Стейки",
  "Рыба",
  "Закуски",
  "Бургеры",
  "Супы",
  "Десерты",
] as const;
type MenuCategory = (typeof categories)[number];

export function MenuScreen() {
  const [items, setItems] = useState(DEMO_MENU);
  const [category, setCategory] = useState<MenuCategory>("Все блюда");
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState({
    name: "",
    price: "",
    stock: "",
    category: "Стейки" as Exclude<MenuCategory, "Все блюда">,
  });

  const filtered = useMemo(
    () =>
      items.filter((item) => {
        const matchesCategory = category === "Все блюда" || item.category === category;
        return (
          matchesCategory && item.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())
        );
      }),
    [category, items, search],
  );
  const activeCount = items.filter((item) => item.active).length;
  const lowStock = items.filter((item) => item.stock < 8).length;

  const addItem = () => {
    const price = Number(draft.price);
    const stock = Number(draft.stock);
    if (!draft.name.trim() || !Number.isFinite(price) || price <= 0) return;
    const newItem: DemoMenuItem = {
      id: `local-${Date.now()}`,
      name: draft.name.trim(),
      category: draft.category,
      price,
      sold: 0,
      stock: Number.isFinite(stock) ? stock : 0,
      trend: 0,
      active: true,
    };
    setItems((current) => [newItem, ...current]);
    setDraft({ name: "", price: "", stock: "", category: "Стейки" });
    setShowAdd(false);
  };

  return (
    <div className="space-y-5 px-4 pb-32 pt-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            Каталог
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Меню</h1>
          <p className="mt-1 text-sm text-slate-500">Барная карта и кухня спортбара</p>
        </div>
        <button
          type="button"
          onClick={() => setShowAdd((value) => !value)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-lg shadow-slate-900/10 active:scale-95"
          aria-label="Добавить блюдо"
        >
          <Plus size={20} />
        </button>
      </header>

      <section className="overflow-hidden rounded-[2rem] bg-slate-900 p-5 text-white shadow-lg shadow-slate-900/10">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-300">
              Барная карта
            </p>
            <h2 className="mt-1 text-2xl font-bold">Напитки из биржи</h2>
            <p className="mt-2 max-w-[260px] text-sm leading-5 text-slate-300">
              Фото, текущая цена и настройки каждого напитка доступны внутри каталога.
            </p>
          </div>
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-300/15 text-amber-200">
            <Utensils size={22} />
          </span>
        </div>
      </section>

      <AlcoholCatalog />

      <section className="grid grid-cols-3 gap-2">
        <div className="rounded-2xl bg-white p-3 shadow-sm">
          <p className="text-[11px] text-slate-500">Блюд</p>
          <p className="mt-1 text-xl font-bold">{items.length}</p>
        </div>
        <div className="rounded-2xl bg-white p-3 shadow-sm">
          <p className="text-[11px] text-slate-500">Активны</p>
          <p className="mt-1 text-xl font-bold text-emerald-700">{activeCount}</p>
        </div>
        <div className="rounded-2xl bg-amber-50 p-3">
          <p className="text-[11px] text-amber-700">Мало на складе</p>
          <p className="mt-1 text-xl font-bold text-amber-950">{lowStock}</p>
        </div>
      </section>

      {showAdd && (
        <section className="space-y-3 rounded-3xl bg-white p-4 shadow-sm">
          <div>
            <h2 className="font-bold">Новое блюдо</h2>
            <p className="mt-1 text-xs text-slate-500">Позиция добавится в локальное меню</p>
          </div>
          <input
            value={draft.name}
            onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))}
            placeholder="Название блюда"
            className="field"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              value={draft.price}
              onChange={(event) => setDraft((value) => ({ ...value, price: event.target.value }))}
              placeholder="Цена, KZT"
              inputMode="numeric"
              className="field"
            />
            <input
              value={draft.stock}
              onChange={(event) => setDraft((value) => ({ ...value, stock: event.target.value }))}
              placeholder="Остаток"
              inputMode="numeric"
              className="field"
            />
          </div>
          <select
            value={draft.category}
            onChange={(event) =>
              setDraft((value) => ({
                ...value,
                category: event.target.value as typeof draft.category,
              }))
            }
            className="field"
          >
            {categories.slice(1).map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={addItem}
            className="w-full rounded-2xl bg-slate-900 py-3.5 font-semibold text-white active:scale-[.99]"
          >
            Сохранить блюдо
          </button>
        </section>
      )}

      <section>
        <div className="mb-3 flex items-center gap-2">
          <ChefHat size={19} className="text-slate-500" />
          <div>
            <h2 className="text-lg font-bold">Кухня</h2>
            <p className="text-xs text-slate-500">Стейки, рыба, закуски и горячие блюда</p>
          </div>
        </div>
        <label className="flex items-center gap-2 rounded-2xl bg-white px-3.5 py-3 shadow-sm">
          <Search size={18} className="text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Поиск по меню"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
          />
        </label>
      </section>

      <div className="flex gap-2 overflow-x-auto pb-1 wheel-scroll">
        {categories.map((item) => (
          <button
            type="button"
            key={item}
            onClick={() => setCategory(item)}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold ${category === item ? "bg-slate-900 text-white" : "bg-white text-slate-600"}`}
          >
            {item}
          </button>
        ))}
      </div>

      <section className="space-y-2">
        {filtered.map((item) => (
          <button
            type="button"
            key={item.id}
            onClick={() =>
              setItems((current) =>
                current.map((row) => (row.id === item.id ? { ...row, active: !row.active } : row)),
              )
            }
            className={`flex min-h-20 w-full items-center gap-3 rounded-3xl bg-white p-3 text-left shadow-sm transition-transform active:scale-[.99] ${item.active ? "" : "opacity-60"}`}
          >
            <span
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${item.stock < 8 ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"}`}
            >
              <Package size={20} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{item.name}</span>
              <span className="mt-0.5 block text-xs text-slate-500">
                {item.category} · {item.stock ? `${item.stock} порций в запасе` : "Нет на складе"}
              </span>
              <span className="mt-1 flex items-center gap-1 text-[11px] font-semibold">
                {item.trend >= 0 ? (
                  <TrendingUp size={12} className="text-emerald-600" />
                ) : (
                  <TrendingDown size={12} className="text-rose-600" />
                )}
                <span className={item.trend >= 0 ? "text-emerald-700" : "text-rose-700"}>
                  {item.trend >= 0 ? "+" : ""}
                  {item.trend}% за неделю
                </span>
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block text-base font-bold tabular-nums">
                {formatKzt(item.price)}
              </span>
              <span
                className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${item.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}
              >
                {item.active ? "Активно" : "Скрыто"}
              </span>
            </span>
          </button>
        ))}
        {!filtered.length && (
          <p className="rounded-3xl bg-white p-8 text-center text-sm text-slate-500">
            Блюда не найдены
          </p>
        )}
      </section>
    </div>
  );
}
