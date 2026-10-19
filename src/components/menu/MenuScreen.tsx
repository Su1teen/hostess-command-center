import { ChefHat, Plus, Search, Utensils } from "lucide-react";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { money, staffApi, useStaffRole, controlClass } from "../../lib/dine-in-client";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "../ui/sheet";
import { AlcoholCatalog } from "../catalog/AlcoholCatalog";
import { XoxoDrinkCatalog } from "./XoxoDrinkCatalog";
import { MenuImport } from "./MenuImport";

type MenuItem = {
  id: string;
  name: string;
  description: string;
  category: string;
  imageUrl: string | null;
  portion: string;
  allergens: string[];
  priceMinor: string;
  isAvailable: boolean;
  published: boolean;
  sortOrder: number;
  version: number;
};
type Draft = Omit<MenuItem, "id" | "priceMinor" | "version" | "allergens"> & {
  id?: string;
  price: string;
  allergensText: string;
  version?: number;
};
const empty: Draft = {
  name: "",
  description: "",
  category: "Кухня",
  imageUrl: null,
  portion: "",
  allergensText: "",
  price: "",
  isAvailable: true,
  published: false,
  sortOrder: 0,
};

export function MenuScreen() {
  const role = useStaffRole(),
    client = useQueryClient();
  const canEdit = role === "manager";
  const [section, setSection] = useState<"menu" | "exchange">("menu");
  const [search, setSearch] = useState(""),
    [category, setCategory] = useState("Все блюда"),
    [draft, setDraft] = useState<Draft | null>(null);
  const [view, setView] = useState("grid"),
    [stateFilter, setStateFilter] = useState("all"),
    [sort, setSort] = useState("category");
  const [selected, setSelected] = useState<string[]>([]);
  const query = useQuery({
    queryKey: ["regular-menu-staff"],
    queryFn: ({ signal }) => staffApi<{ items: MenuItem[] }>("/dine-in/menu-items", { signal }),
    refetchInterval: 15000,
  });
  const items = useMemo(() => query.data?.items ?? [], [query.data?.items]);
  const categories = ["Все блюда", ...Array.from(new Set(items.map((item) => item.category)))];
  const filtered = useMemo(
    () =>
      items
        .filter(
          (item) =>
            (category === "Все блюда" || category === item.category) &&
            (stateFilter === "all" ||
              (stateFilter === "published"
                ? item.published
                : stateFilter === "draft"
                  ? !item.published
                  : !item.isAvailable)) &&
            `${item.name} ${item.description}`
              .toLocaleLowerCase()
              .includes(search.toLocaleLowerCase()),
        )
        .sort((a, b) =>
          sort === "price"
            ? Number(a.priceMinor) - Number(b.priceMinor)
            : sort === "name"
              ? a.name.localeCompare(b.name, "ru")
              : a.sortOrder - b.sortOrder || a.category.localeCompare(b.category, "ru"),
        ),
    [items, category, search, stateFilter, sort],
  );
  const batch = useMutation({
    mutationFn: (action: string) =>
      staffApi("/dine-in/menu-items/batch", {
        method: "POST",
        body: JSON.stringify({
          action,
          items: items
            .filter((i) => selected.includes(i.id))
            .map((i) => ({ id: i.id, version: i.version })),
          idempotencyKey: crypto.randomUUID(),
        }),
      }),
    onSuccess: () => {
      setSelected([]);
      void client.invalidateQueries({ queryKey: ["regular-menu-staff"] });
    },
  });
  const save = useMutation({
    mutationFn: async (value: Draft) => {
      if (!/^\d+(\.\d{1,2})?$/.test(value.price))
        throw new Error("Введите цену в тенге, до двух знаков после запятой");
      const [whole, fraction = ""] = value.price.split(".");
      const priceMinor = Number(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0")));
      if (priceMinor > 1_000_000_000) throw new Error("Цена превышает допустимую сумму");
      return staffApi(`/dine-in/menu-items${value.id ? `/${value.id}` : ""}`, {
        method: value.id ? "PATCH" : "POST",
        body: JSON.stringify({
          name: value.name,
          description: value.description,
          category: value.category,
          imageUrl: value.imageUrl?.trim() || null,
          portion: value.portion,
          priceMinor,
          allergens: value.allergensText
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
          isAvailable: value.isAvailable,
          published: value.published,
          sortOrder: value.sortOrder,
          ...(value.version ? { version: value.version } : {}),
        }),
      });
    },
    onSuccess: () => {
      setDraft(null);
      void client.invalidateQueries({ queryKey: ["regular-menu-staff"] });
    },
  });
  function edit(item?: MenuItem) {
    save.reset();
    setDraft(
      item
        ? {
            ...item,
            price: (Number(item.priceMinor) / 100).toFixed(2),
            allergensText: item.allergens.join(", "),
          }
        : { ...empty },
    );
  }
  return (
    <div className="space-y-5 px-4 pb-32 pt-6 sm:px-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            XOXO · каталог
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Меню</h1>
          <p className="mt-2 text-sm text-slate-500">
            Опубликованные блюда доступны гостям за всеми столами.
          </p>
        </div>
        {canEdit && section === "menu" && (
          <button
            onClick={() => edit()}
            aria-label="Добавить блюдо"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-white"
          >
            <Plus size={22} />
          </button>
        )}
      </header>
      {canEdit && section === "menu" && <MenuImport />}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => setSection("menu")}
          aria-pressed={section === "menu"}
          className={`min-h-20 rounded-2xl border p-4 text-left ${section === "menu" ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"}`}
        >
          <ChefHat size={20} />
          <span className="mt-2 block font-semibold">Основное меню</span>
        </button>
        <button
          onClick={() => setSection("exchange")}
          aria-pressed={section === "exchange"}
          className={`min-h-20 rounded-2xl border p-4 text-left ${section === "exchange" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white"}`}
        >
          <Utensils size={20} />
          <span className="mt-2 block font-semibold">Биржа напитков</span>
        </button>
      </div>
      {section === "exchange" ? (
        <>
          <AlcoholCatalog />
          <XoxoDrinkCatalog />
        </>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            {[
              ["Позиций", items.length],
              ["Опубликовано", items.filter((i) => i.published).length],
              ["В стоп-листе", items.filter((i) => i.published && !i.isAvailable).length],
            ].map(([label, count]) => (
              <div key={label} className="rounded-2xl bg-white p-4">
                <p className="text-xs text-slate-500">{label}</p>
                <p className="mt-1 text-2xl font-bold">{count}</p>
              </div>
            ))}
          </div>
          <label className="flex min-h-12 items-center gap-2 rounded-2xl bg-white px-4">
            <Search size={18} className="text-slate-400" />
            <input
              aria-label="Поиск по меню"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Название или описание"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </label>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {categories.map((value) => (
              <button
                key={value}
                onClick={() => setCategory(value)}
                className={`min-h-11 shrink-0 rounded-full px-4 text-sm font-semibold ${value === category ? "bg-slate-900 text-white" : "bg-white text-slate-600"}`}
              >
                {value}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              aria-label="Публикация и стоп-лист"
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
              className={controlClass}
            >
              <option value="all">Все позиции</option>
              <option value="published">Опубликованы</option>
              <option value="draft">Черновики</option>
              <option value="stop">Стоп-лист</option>
            </select>
            <select
              aria-label="Сортировка меню"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className={controlClass}
            >
              <option value="category">По категориям</option>
              <option value="name">По названию</option>
              <option value="price">По цене</option>
            </select>
            <button
              className={controlClass}
              onClick={() => setView((v) => (v === "grid" ? "list" : "grid"))}
            >
              {view === "grid" ? "Показать списком" : "Показать сеткой"}
            </button>
            {canEdit && (
              <button
                className={controlClass}
                onClick={() => setSelected(selected.length ? [] : filtered.map((i) => i.id))}
              >
                {selected.length ? "Снять выбор" : "Выбрать показанные"}
              </button>
            )}
          </div>
          {canEdit && selected.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-white p-3">
              <strong className="text-sm">Выбрано: {selected.length}</strong>
              {[
                ["publish", "Опубликовать"],
                ["unpublish", "Снять с публикации"],
                ["stop", "В стоп-лист"],
                ["available", "Вернуть в меню"],
              ].map(([action, label]) => (
                <button
                  key={action}
                  disabled={batch.isPending}
                  className={controlClass}
                  onClick={() => batch.mutate(action)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {batch.error && (
            <p role="alert" className="text-sm text-red-700">
              {batch.error.message}
            </p>
          )}
          {save.error && !draft && (
            <p role="alert" className="text-sm text-red-700">
              {save.error.message}
            </p>
          )}
          {query.error && (
            <p role="alert" className="rounded-2xl bg-red-50 p-4 text-red-800">
              {query.error.message}
              <button onClick={() => void query.refetch()} className="ml-3 underline">
                Повторить
              </button>
            </p>
          )}
          {query.isPending && (
            <p role="status" className="p-6 text-slate-500">
              Загружаем меню…
            </p>
          )}
          <section
            className={view === "grid" ? "grid gap-3 sm:grid-cols-2 xl:grid-cols-3" : "grid gap-3"}
          >
            {filtered.map((item) => (
              <article
                key={item.id}
                className="overflow-hidden rounded-3xl border border-slate-100 bg-white"
              >
                <div
                  className={
                    view === "grid" ? "relative h-40 bg-amber-50" : "relative h-14 bg-amber-50"
                  }
                >
                  {item.imageUrl ? (
                    <img
                      src={item.imageUrl}
                      alt={item.name}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-amber-700/30">
                      <ChefHat size={48} />
                    </div>
                  )}
                  <span
                    className={`absolute bottom-3 left-3 rounded-full px-3 py-1 text-xs font-semibold ${!item.published ? "bg-slate-100 text-slate-600" : item.isAvailable ? "bg-emerald-100 text-emerald-900" : "bg-rose-100 text-rose-900"}`}
                  >
                    {!item.published ? "Черновик" : item.isAvailable ? "В меню" : "Стоп-лист"}
                  </span>
                </div>
                <div className="p-4">
                  {canEdit && (
                    <label className="mb-2 flex min-h-11 items-center gap-2 text-xs text-slate-500">
                      <input
                        type="checkbox"
                        aria-label={`Выбрать ${item.name} ${item.portion}`}
                        checked={selected.includes(item.id)}
                        onChange={(e) =>
                          setSelected((prev) =>
                            e.target.checked
                              ? [...prev, item.id]
                              : prev.filter((id) => id !== item.id),
                          )
                        }
                      />
                      Выбрать
                    </label>
                  )}
                  <p className="text-xs text-slate-500">
                    {item.category}
                    {item.portion ? ` · ${item.portion}` : ""}
                  </p>
                  <h2 className="mt-1 text-lg font-bold">{item.name}</h2>
                  <p
                    className={
                      view === "grid"
                        ? "mt-1 line-clamp-2 min-h-10 text-sm text-slate-500"
                        : "mt-1 line-clamp-1 text-xs text-slate-500"
                    }
                  >
                    {item.description || "Описание пока не добавлено"}
                  </p>
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <strong className="tabular-nums">{money(item.priceMinor)}</strong>
                    {canEdit && (
                      <button className={controlClass} onClick={() => edit(item)}>
                        Изменить
                      </button>
                    )}
                  </div>
                  {canEdit && (
                    <details className="mt-3 border-t pt-3">
                      <summary className="cursor-pointer text-xs text-slate-500">
                        Быстрые изменения
                      </summary>
                      <button
                        disabled={batch.isPending}
                        className={`${controlClass} mt-2 w-full`}
                        onClick={() =>
                          save.mutate({
                            ...item,
                            price: (Number(item.priceMinor) / 100).toFixed(2),
                            allergensText: item.allergens.join(", "),
                            isAvailable: !item.isAvailable,
                          })
                        }
                      >
                        {item.isAvailable ? "В стоп-лист" : "Вернуть в меню"}
                      </button>
                      <form
                        className="mt-2 flex flex-wrap gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const data = new FormData(e.currentTarget);
                          save.mutate({
                            ...item,
                            price: String(data.get("price")).replace(",", "."),
                            allergensText: item.allergens.join(", "),
                          });
                        }}
                      >
                        <input
                          key={item.version}
                          name="price"
                          aria-label={`Цена ${item.name} ${item.portion}`}
                          defaultValue={(Number(item.priceMinor) / 100).toFixed(2)}
                          inputMode="decimal"
                          className={`${controlClass} min-w-0 flex-1`}
                        />
                        <button disabled={save.isPending} className={controlClass}>
                          Сохранить цену
                        </button>
                      </form>
                    </details>
                  )}
                </div>
              </article>
            ))}
          </section>
          {!query.isPending && !query.error && !filtered.length && (
            <div className="rounded-3xl border border-dashed p-8 text-center">
              <ChefHat className="mx-auto text-amber-600" size={32} />
              <h2 className="mt-3 text-lg font-semibold">
                {items.length ? "Ничего не найдено" : "Добавьте настоящее меню XOXO"}
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
                {items.length
                  ? "Попробуйте другое название или категорию."
                  : "Блюда, фотографии и цены сохраняются на сервере. Гости увидят только опубликованные позиции."}
              </p>
              {canEdit && !items.length && (
                <button className={`${controlClass} mt-5`} onClick={() => edit()}>
                  Добавить первое блюдо
                </button>
              )}
            </div>
          )}
        </>
      )}
      <Sheet
        open={!!draft}
        onOpenChange={(open) => {
          if (!open) setDraft(null);
        }}
      >
        <SheetContent side="right" className="w-full overflow-y-auto pb-24 pt-12 sm:max-w-xl">
          <SheetTitle>{draft?.id ? "Редактировать блюдо" : "Новое блюдо"}</SheetTitle>
          <SheetDescription>
            Сохраните карточку и включите публикацию, когда информация проверена.
          </SheetDescription>
          {draft && (
            <form
              className="mt-5 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                save.mutate(draft);
              }}
            >
              {(
                [
                  ["name", "Название"],
                  ["category", "Категория"],
                  ["price", "Цена, ₸"],
                  ["portion", "Порция / объём"],
                  ["imageUrl", "Ссылка на фото (HTTPS)"],
                  ["allergensText", "Аллергены, через запятую"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="block text-sm font-medium">
                  {label}
                  <input
                    className={`${controlClass} mt-1 w-full`}
                    required={["name", "category", "price"].includes(key)}
                    inputMode={key === "price" ? "decimal" : undefined}
                    type={key === "imageUrl" ? "url" : "text"}
                    value={draft[key] ?? ""}
                    onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
                  />
                </label>
              ))}
              <label className="block text-sm font-medium">
                Описание / состав
                <textarea
                  rows={4}
                  className={`${controlClass} mt-1 w-full py-3`}
                  value={draft.description}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                />
              </label>
              <label className="flex min-h-12 items-center gap-3 rounded-xl bg-slate-50 p-3">
                <input
                  type="checkbox"
                  checked={draft.isAvailable}
                  onChange={(event) => setDraft({ ...draft, isAvailable: event.target.checked })}
                />
                Доступно к заказу
              </label>
              <label className="flex min-h-12 items-center gap-3 rounded-xl bg-amber-50 p-3">
                <input
                  type="checkbox"
                  checked={draft.published}
                  onChange={(event) => setDraft({ ...draft, published: event.target.checked })}
                />
                Опубликовать для гостей
              </label>
              {save.error && (
                <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
                  {save.error.message}
                </p>
              )}
              <button
                disabled={save.isPending}
                className="min-h-12 w-full rounded-2xl bg-slate-900 px-4 font-semibold text-white disabled:opacity-50"
              >
                {save.isPending ? "Сохраняем…" : "Сохранить блюдо"}
              </button>
            </form>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
