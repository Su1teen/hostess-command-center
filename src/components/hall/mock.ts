export type TableStatus = "free" | "booked" | "served";
export type TableShape = "round" | "rect" | "bar";
export interface MockTable {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  seats: number;
  shape: TableShape;
  bookings: {
    start: string;
    end: string;
    guest: string;
    phone: string;
    deposit: number;
    guests: number;
  }[];
}
export const TIME_SLOTS = Array.from(
  { length: 20 },
  (_, i) => `${String(12 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`,
);
export const MOCK_TABLES: MockTable[] = [
  {
    id: "A1",
    label: "A1",
    x: 60,
    y: 90,
    w: 68,
    h: 68,
    seats: 4,
    shape: "round",
    bookings: [
      {
        start: "18:00",
        end: "21:00",
        guest: "Иван Соколов",
        phone: "+7 903 111 22 33",
        deposit: 5000,
        guests: 4,
      },
    ],
  },
  {
    id: "A2",
    label: "A2",
    x: 160,
    y: 90,
    w: 68,
    h: 68,
    seats: 4,
    shape: "round",
    bookings: [
      {
        start: "19:30",
        end: "23:00",
        guest: "Мария П.",
        phone: "+7 916 222 33 44",
        deposit: 3000,
        guests: 3,
      },
    ],
  },
  { id: "A3", label: "A3", x: 260, y: 90, w: 68, h: 68, seats: 4, shape: "round", bookings: [] },
  { id: "A4", label: "A4", x: 360, y: 90, w: 68, h: 68, seats: 4, shape: "round", bookings: [] },
  { id: "B1", label: "B1", x: 60, y: 210, w: 90, h: 60, seats: 6, shape: "rect", bookings: [] },
  { id: "B2", label: "B2", x: 180, y: 210, w: 90, h: 60, seats: 6, shape: "rect", bookings: [] },
  {
    id: "B3",
    label: "B3",
    x: 300,
    y: 210,
    w: 90,
    h: 60,
    seats: 6,
    shape: "rect",
    bookings: [
      {
        start: "21:00",
        end: "23:30",
        guest: "Артём В.",
        phone: "+7 999 555 44 33",
        deposit: 6000,
        guests: 6,
      },
    ],
  },
  { id: "C1", label: "C1", x: 90, y: 320, w: 80, h: 80, seats: 6, shape: "round", bookings: [] },
  { id: "C2", label: "C2", x: 230, y: 320, w: 80, h: 80, seats: 6, shape: "round", bookings: [] },
  { id: "C3", label: "C3", x: 370, y: 320, w: 60, h: 60, seats: 2, shape: "round", bookings: [] },
  ...Array.from({ length: 7 }, (_, index) => ({
    id: `Bar${index + 1}`,
    label: `Bar ${index + 1}`,
    x: 60 + index * 55,
    y: 460,
    w: 40,
    h: 40,
    seats: 1,
    shape: "bar" as const,
    bookings: [],
  })),
];
export const TV_SCREENS = [
  { id: "TV1", x: 245, y: 30, cone: "60,90 430,90 380,200 105,200" },
  { id: "TV2", x: 40, y: 380, cone: "40,395 90,395 200,470 40,470" },
];
export const STATUS_COLOR = { free: "#9FB9A2", booked: "#C88484", served: "#C9A96E" };
export const STATUS_LABEL = { free: "Свободен", booked: "Забронирован", served: "Обслуживается" };
export function statusAt(table: MockTable, time: string): TableStatus {
  const booking = table.bookings.find((item) => time >= item.start && time < item.end);
  return booking ? "booked" : "free";
}
