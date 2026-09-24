import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Search, TrendingUp } from "lucide-react";
import { defaultDrinks, readDemoAdmin, saveDemoAdmin, type DemoDrink } from "../../lib/xoxo-demo";
import { formatKzt } from "../../lib/formatters/money";

export function XoxoDrinkCatalog() {
  const [drinks, setDrinks] = useState(defaultDrinks);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Все");
  const [editing, setEditing] = useState<DemoDrink | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", price: "", category: "Коктейли" });
  useEffect(() => setDrinks(readDemoAdmin().drinks), []);
  const categories = useMemo(() => ["Все", ...new Set(drinks.map((drink) => drink.category))], [drinks]);
  const visible = useMemo(() => drinks.filter((drink) => (category === "Все" || drink.category === category) && drink.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [drinks, category, query]);
  const update = (next: DemoDrink[]) => { setDrinks(next); saveDemoAdmin({ ...readDemoAdmin(), drinks: next }); };
  const save = () => {
    const price = Number(draft.price);
    if (!draft.name.trim() || !Number.isFinite(price) || price <= 0) return;
    if (editing) update(drinks.map((drink) => drink.id === editing.id ? { ...drink, name: draft.name.trim(), category: draft.category, price } : drink));
    else update([{ id: `local-${Date.now()}`, name: draft.name.trim(), category: draft.category, price, active: true, sold: 0 }, ...drinks]);
    setEditing(null); setIsAdding(false); setDraft({ name: "", price: "", category: "Коктейли" });
  };
  const openEdit = (drink: DemoDrink) => { setEditing(drink); setIsAdding(false); setDraft({ name: drink.name, price: String(drink.price), category: drink.category }); };
  return <section className="space-y-4">
    <div className="rounded-[2rem] bg-[#12332b] p-5 text-white sm:p-7">
      <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-amber-300">XOXO · меню</p><h2 className="mt-2 text-2xl font-bold tracking-tight">Напитки и цены</h2><p className="mt-1 text-sm text-white/65">Позиции с фото меню · демо-редактирование</p></div><button type="button" onClick={() => { setEditing(null); setIsAdding(true); setDraft({ name: "", price: "", category: "Коктейли" }); }} className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-amber-300 text-[#142a24]" aria-label="Добавить позицию"><Plus size={21}/></button></div>
      <div className="mt-5 grid grid-cols-3 gap-2 border-t border-white/15 pt-4 text-center"><div><p className="text-2xl font-bold">{drinks.length}</p><p className="text-xs text-white/60">позиций</p></div><div><p className="text-2xl font-bold">{drinks.filter((drink) => drink.active).length}</p><p className="text-xs text-white/60">в меню</p></div><div><p className="text-2xl font-bold">{drinks.reduce((sum, drink) => sum + drink.sold, 0)}</p><p className="text-xs text-white/60">продаж · демо</p></div></div>
    </div>
    <div className="rounded-3xl bg-white p-4 shadow-sm"><div className="flex items-center gap-2"><TrendingUp size={17} className="text-emerald-700"/><h3 className="font-bold">Лидеры продаж</h3></div><div className="mt-3 grid gap-2 sm:grid-cols-3">{[...drinks].sort((a,b) => b.sold-a.sold).slice(0,3).map((drink, index) => <div key={drink.id} className="rounded-2xl bg-slate-50 p-3"><p className="text-xs text-slate-500">#{index+1} · {drink.sold} продаж</p><p className="mt-1 font-semibold">{drink.name}</p><p className="text-sm text-emerald-800">{formatKzt(drink.price)}</p></div>)}</div></div>
    <div className="flex items-center gap-2 rounded-2xl bg-white px-3 shadow-sm"><Search size={18} className="text-slate-400"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск позиции" className="h-12 w-full bg-transparent text-sm outline-none"/></div>
    <div className="flex gap-2 overflow-x-auto pb-1">{categories.map((name) => <button key={name} type="button" onClick={() => setCategory(name)} className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold ${category === name ? "bg-[#12332b] text-white" : "bg-white text-slate-600"}`}>{name}</button>)}</div>
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{visible.map((drink) => <article key={drink.id} className={`rounded-3xl bg-white p-4 shadow-sm ${drink.active ? "" : "opacity-55"}`}><div className="flex justify-between gap-2"><div><p className="text-xs font-medium text-slate-500">{drink.category} · {drink.sold} продаж</p><h3 className="mt-1 font-bold">{drink.name}</h3></div><button type="button" onClick={() => openEdit(drink)} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100" aria-label={`Редактировать ${drink.name}`}><Pencil size={15}/></button></div><div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3"><span className="text-lg font-bold tabular-nums">{formatKzt(drink.price)}</span><button type="button" onClick={() => update(drinks.map((item) => item.id === drink.id ? { ...item, active: !item.active } : item))} className={`rounded-full px-3 py-1.5 text-xs font-bold ${drink.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{drink.active ? "В меню" : "Скрыто"}</button></div></article>)}</div>
    {(editing || isAdding) && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 sm:items-center" onClick={() => { setEditing(null); setIsAdding(false); setDraft({ name: "", price: "", category: "Коктейли" }); }}><div onClick={(event) => event.stopPropagation()} className="w-full max-w-md space-y-3 rounded-t-[2rem] bg-white p-5 pb-8 sm:rounded-[2rem]"><h3 className="text-xl font-bold">{editing ? "Редактировать позицию" : "Новая позиция"}</h3><input className="field" placeholder="Название" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })}/><input className="field" placeholder="Цена, ₸" inputMode="numeric" value={draft.price} onChange={(event) => setDraft({ ...draft, price: event.target.value })}/><input className="field" placeholder="Категория" value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}/><button type="button" onClick={save} className="w-full rounded-2xl bg-[#12332b] py-3.5 font-bold text-white">Сохранить</button></div></div>}
  </section>;
}
