export type DemoDrink = { id: string; name: string; category: string; price: number; active: boolean; sold: number };
export type DemoOrder = { id: string; date: string; customerId: string; items: string; total: number; cashback: number };
export type DemoCustomer = { id: string; name: string; phone: string };

const key = "xoxo:command-center:demo:v1";
const groups: [string, number, string][] = [
  ...["Coca-Cola", "Fanta", "Sprite"].flatMap((name): [string, number, string][] => [[`${name} · 250 мл`, 1100, "Газировка"], [`${name} · 500 мл`, 1000, "Газировка"], [`${name} · 1 л`, 1500, "Газировка"], [`${name} · 1,5 л`, 1800, "Газировка"], [`${name} · 2 л`, 2300, "Газировка"]]),
  ["Fuse Tea", 1500, "Газировка"], ["Red Bull Vodka", 3200, "Коктейли"], ["Red Bull Jäger", 3200, "Коктейли"], ["Gin Tonic", 3200, "Коктейли"], ["Red Bull Whisky", 3200, "Коктейли"], ["Mojito", 2800, "Коктейли"], ["Long Island", 3500, "Коктейли"], ["Whisky Sour", 3200, "Коктейли"],
  ["Квас", 890, "Разливные"], ["Лимонад", 890, "Разливные"], ["Немецкое · 500 мл", 1190, "Разливные"], ["Немецкое · 3 л", 6000, "Разливные"], ["Carlsberg · 500 мл", 1500, "Разливные"], ["Carlsberg · 3 л", 8500, "Разливные"],
  ["Gorilla", 1500, "Энергетики"], ["Dizzy", 1500, "Энергетики"], ["Red Bull", 2000, "Энергетики"], ["Borjomi", 2000, "Вода"], ["Tassay · 250 мл", 900, "Вода"], ["Tassay · 500 мл", 900, "Вода"], ["Tassay газ · 500 мл", 900, "Вода"], ["Tassay · 1 л", 1500, "Вода"], ["Сарыагаш", 1000, "Вода"],
  ["Ягодный", 2490, "Лимонады"], ["Арбузный", 2490, "Лимонады"], ["Манго-маракуйя", 2490, "Лимонады"], ["Киви-лайм", 2490, "Лимонады"], ["Мохито", 2490, "Лимонады"], ["Тамерланский чай", 2590, "Чай"], ["Облепиховый чай", 2590, "Чай"], ["Малиновый чай", 2590, "Чай"], ["Смородиновый чай", 2590, "Чай"],
  ["Maxi Чай", 1500, "Чай"], ["Натуральный сок", 2500, "Соки"], ["Tassay · 500 мл стекло", 1000, "Вода"],
];

export const defaultDrinks: DemoDrink[] = groups.map(([name, price, category], index) => ({ id: `photo-${index}`, name, price, category, active: true, sold: category === "Коктейли" && name === "Mojito" ? 62 : name === "Red Bull Vodka" ? 54 : name === "Long Island" ? 43 : name === "Coca-Cola · 500 мл" ? 39 : Math.max(2, 18 - Math.floor(index / 3)) }));
export const demoCustomers: DemoCustomer[] = [
  { id: "sultan", name: "Советов Султан", phone: "+7 (701) 000-00-00" },
  { id: "aigerim", name: "Айгерим Т.", phone: "+7 (777) 245-18-40" },
  { id: "marat", name: "Марат Б.", phone: "+7 (701) 445-90-18" },
];
const seedOrders: DemoOrder[] = [
  { id: "demo-1", date: "2026-09-14T20:30:00", customerId: "sultan", items: "Mojito ×2, Солёный арахис", total: 7100, cashback: 355 },
  { id: "demo-2", date: "2026-08-30T19:00:00", customerId: "sultan", items: "Long Island", total: 3500, cashback: 175 },
  { id: "demo-3", date: "2026-09-22T22:10:00", customerId: "aigerim", items: "Gin Tonic ×2", total: 6400, cashback: 0 },
];
export type DemoAdminState = { drinks: DemoDrink[]; orders: DemoOrder[] };
export function readDemoAdmin(): DemoAdminState {
  if (typeof window === "undefined") return { drinks: defaultDrinks, orders: seedOrders };
  try {
    const stored = window.localStorage.getItem(key);
    if (stored) {
      const parsed: unknown = JSON.parse(stored);
      if (parsed && typeof parsed === "object" && "drinks" in parsed && "orders" in parsed && Array.isArray(parsed.drinks) && Array.isArray(parsed.orders)) {
        const state = parsed as DemoAdminState;
        const existing = new Set(state.drinks.map((drink) => drink.id));
        return { ...state, drinks: [...state.drinks, ...defaultDrinks.filter((drink) => !existing.has(drink.id))] };
      }
    }
  } catch { /* Browser storage can be unavailable. */ }
  return { drinks: defaultDrinks, orders: seedOrders };
}
export function saveDemoAdmin(value: DemoAdminState): void {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* Session still works without persistence. */ }
}
