import type { ExchangeProduct } from "./types/products";
import type { SalesDashboard } from "./types/sales";

export interface DemoMenuItem {
  id: string;
  name: string;
  category: "Стейки" | "Рыба" | "Закуски" | "Бургеры" | "Супы" | "Десерты";
  price: number;
  sold: number;
  stock: number;
  trend: number;
  active: boolean;
}

export interface DemoSupplier {
  id: string;
  name: string;
  category: string;
  contact: string;
  phone: string;
  whatsapp: string;
  nextDelivery: string;
  balance: number;
  status: "В доставке" | "Активен" | "Ожидает";
  products: string[];
}

export const DEMO_EXCHANGE_PRODUCTS: ExchangeProduct[] = [
  {
    id: "demo-absolut",
    slug: "absolut",
    name: "Absolut Vodka",
    category: "Крепкий алкоголь",
    volumeMl: 700,
    currency: "KZT",
    originalPrice: 9500,
    startPrice: 8500,
    currentPrice: 9800,
    minPrice: 8500,
    maxPrice: 12500,
    priceStep: 500,
    priceLevelPercent: 32,
    isActive: true,
    imageUrl: null,
    updatedAt: new Date().toISOString(),
  },
  {
    id: "demo-jameson",
    slug: "jameson",
    name: "Jameson Irish Whiskey",
    category: "Крепкий алкоголь",
    volumeMl: 700,
    currency: "KZT",
    originalPrice: 16800,
    startPrice: 15500,
    currentPrice: 17400,
    minPrice: 15500,
    maxPrice: 22000,
    priceStep: 500,
    priceLevelPercent: 29,
    isActive: true,
    imageUrl: null,
    updatedAt: new Date().toISOString(),
  },
  {
    id: "demo-beefeater",
    slug: "beefeater",
    name: "Beefeater Gin",
    category: "Крепкий алкоголь",
    volumeMl: 700,
    currency: "KZT",
    originalPrice: 13200,
    startPrice: 11900,
    currentPrice: 12800,
    minPrice: 11900,
    maxPrice: 17000,
    priceStep: 500,
    priceLevelPercent: 18,
    isActive: true,
    imageUrl: null,
    updatedAt: new Date().toISOString(),
  },
  {
    id: "demo-corona",
    slug: "corona-extra",
    name: "Corona Extra",
    category: "Пиво",
    volumeMl: 355,
    currency: "KZT",
    originalPrice: 1850,
    startPrice: 1600,
    currentPrice: 1950,
    minPrice: 1600,
    maxPrice: 2600,
    priceStep: 100,
    priceLevelPercent: 35,
    isActive: true,
    imageUrl: null,
    updatedAt: new Date().toISOString(),
  },
  {
    id: "demo-hoegaarden",
    slug: "hoegaarden",
    name: "Hoegaarden",
    category: "Пиво",
    volumeMl: 500,
    currency: "KZT",
    originalPrice: 2100,
    startPrice: 1800,
    currentPrice: 2250,
    minPrice: 1800,
    maxPrice: 2900,
    priceStep: 100,
    priceLevelPercent: 41,
    isActive: true,
    imageUrl: null,
    updatedAt: new Date().toISOString(),
  },
  {
    id: "demo-cocktail",
    slug: "cocktail",
    name: "Авторский коктейль",
    category: "Коктейли",
    volumeMl: 350,
    currency: "KZT",
    originalPrice: 3200,
    startPrice: 2800,
    currentPrice: 3500,
    minPrice: 2800,
    maxPrice: 4800,
    priceStep: 200,
    priceLevelPercent: 38,
    isActive: true,
    imageUrl: null,
    updatedAt: new Date().toISOString(),
  },
];

export const DEMO_SALES_DASHBOARD: SalesDashboard = {
  kpis: {
    revenue: 184650,
    itemsSold: 96,
    alcoholRevenue: 184650,
    ordersCount: 42,
    averageCheck: 4396,
  },
  hourly: [
    { hour: 12, label: "12:00", revenue: 8200, items: 6 },
    { hour: 14, label: "14:00", revenue: 12600, items: 9 },
    { hour: 16, label: "16:00", revenue: 19800, items: 12 },
    { hour: 18, label: "18:00", revenue: 36400, items: 20 },
    { hour: 20, label: "20:00", revenue: 54800, items: 28 },
    { hour: 22, label: "22:00", revenue: 42900, items: 21 },
  ],
  categories: [{ category: "Бар", revenue: 184650, items: 96, share: 1 }],
  top: [
    {
      name: "Corona Extra",
      category: "Пиво",
      isAlcohol: true,
      quantity: 26,
      revenue: 50700,
      source: "exchange",
    },
    {
      name: "Авторский коктейль",
      category: "Коктейли",
      isAlcohol: true,
      quantity: 18,
      revenue: 45000,
      source: "exchange",
    },
    {
      name: "Jameson Irish Whiskey",
      category: "Крепкий алкоголь",
      isAlcohol: true,
      quantity: 11,
      revenue: 38280,
      source: "exchange",
    },
    {
      name: "Absolut Vodka",
      category: "Крепкий алкоголь",
      isAlcohol: true,
      quantity: 12,
      revenue: 35280,
      source: "exchange",
    },
  ],
  sources: { exchangeLines: 96, iikoEvents: 0, iikoEventsWithoutPrice: 0 },
  generatedAt: new Date().toISOString(),
  dateLabel: "Сегодня",
  timezone: "Asia/Almaty",
};

export const DEMO_MENU: DemoMenuItem[] = [
  {
    id: "steak",
    name: "Стейк из говядины",
    category: "Стейки",
    price: 6800,
    sold: 18,
    stock: 12,
    trend: 18,
    active: true,
  },
  {
    id: "fish",
    name: "Филе судака",
    category: "Рыба",
    price: 4900,
    sold: 11,
    stock: 8,
    trend: 9,
    active: true,
  },
  {
    id: "toast",
    name: "Чесночные гренки",
    category: "Закуски",
    price: 1600,
    sold: 24,
    stock: 30,
    trend: 22,
    active: true,
  },
  {
    id: "burger",
    name: "Спортбургер",
    category: "Бургеры",
    price: 3600,
    sold: 21,
    stock: 16,
    trend: 14,
    active: true,
  },
  {
    id: "tom-yum",
    name: "Том ям",
    category: "Супы",
    price: 4200,
    sold: 13,
    stock: 7,
    trend: 6,
    active: true,
  },
  {
    id: "wings",
    name: "Крылья BBQ",
    category: "Закуски",
    price: 2900,
    sold: 15,
    stock: 5,
    trend: -3,
    active: true,
  },
  {
    id: "cheesecake",
    name: "Чизкейк",
    category: "Десерты",
    price: 1800,
    sold: 6,
    stock: 0,
    trend: -6,
    active: false,
  },
];

export const DEMO_SUPPLIERS: DemoSupplier[] = [
  {
    id: "alatau-food",
    name: "Alatau Food",
    category: "Мясо и птица",
    contact: "Айдана Сарсенова",
    phone: "+7 777 210 45 18",
    whatsapp: "77772104518",
    nextDelivery: "Завтра · 10:00",
    balance: 68400,
    status: "В доставке",
    products: ["Говядина", "Курица", "Рёбра"],
  },
  {
    id: "barline",
    name: "Barline KZ",
    category: "Напитки",
    contact: "Нурлан Ахметов",
    phone: "+7 701 845 22 60",
    whatsapp: "77018452260",
    nextDelivery: "25 сентября · 14:00",
    balance: 32500,
    status: "Активен",
    products: ["Пиво", "Сиропы", "Минеральная вода"],
  },
  {
    id: "fresh-market",
    name: "Fresh Market",
    category: "Овощи и молочные продукты",
    contact: "Мадина Тулегенова",
    phone: "+7 705 330 91 44",
    whatsapp: "77053309144",
    nextDelivery: "Четверг · 08:30",
    balance: 18400,
    status: "Ожидает",
    products: ["Картофель", "Салат", "Сыр"],
  },
];
