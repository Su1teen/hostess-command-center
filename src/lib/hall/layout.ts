export type TableShape = "round" | "rect" | "bar";

/** Static geometry of the hall. Occupancy is never stored here — it comes from reservations. */
export interface HallTable {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  seats: number;
  shape: TableShape;
}

export const FLOOR_WIDTH = 500;
export const FLOOR_HEIGHT = 550;

export const HALL_TABLES: HallTable[] = [
  // Three wide rectangular tables at the top, four smaller ones beneath them.
  { id: "A1", label: "A1", x: 42, y: 92, w: 118, h: 62, seats: 6, shape: "rect" },
  { id: "A2", label: "A2", x: 191, y: 92, w: 118, h: 62, seats: 6, shape: "rect" },
  { id: "A3", label: "A3", x: 340, y: 92, w: 118, h: 62, seats: 6, shape: "rect" },
  { id: "B1", label: "B1", x: 42, y: 222, w: 82, h: 54, seats: 4, shape: "rect" },
  { id: "B2", label: "B2", x: 144, y: 222, w: 82, h: 54, seats: 4, shape: "rect" },
  { id: "B3", label: "B3", x: 246, y: 222, w: 82, h: 54, seats: 4, shape: "rect" },
  { id: "B4", label: "B4", x: 348, y: 222, w: 82, h: 54, seats: 4, shape: "rect" },
  // Two round tables and the bar are placed along the right-hand side.
  { id: "C1", label: "C1", x: 352, y: 326, w: 66, h: 66, seats: 4, shape: "round" },
  { id: "C2", label: "C2", x: 352, y: 422, w: 66, h: 66, seats: 4, shape: "round" },
  { id: "Bar", label: "Бар", x: 435, y: 330, w: 34, h: 158, seats: 6, shape: "bar" },
];

export const TV_SCREENS = [
  { id: "TV1", x: 245, y: 30, cone: "60,90 430,90 380,200 105,200" },
  { id: "TV2", x: 40, y: 380, cone: "40,395 90,395 200,470 40,470" },
];

const tableById = new Map(HALL_TABLES.map((table) => [table.id, table]));

export function findTable(id: string | null | undefined): HallTable | undefined {
  return id ? tableById.get(id) : undefined;
}

export const DEFAULT_RESERVATION_MINUTES = 120;
