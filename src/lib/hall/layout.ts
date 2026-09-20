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
  { id: "A1", label: "A1", x: 60, y: 90, w: 68, h: 68, seats: 4, shape: "round" },
  { id: "A2", label: "A2", x: 160, y: 90, w: 68, h: 68, seats: 4, shape: "round" },
  { id: "A3", label: "A3", x: 260, y: 90, w: 68, h: 68, seats: 4, shape: "round" },
  { id: "A4", label: "A4", x: 360, y: 90, w: 68, h: 68, seats: 4, shape: "round" },
  { id: "B1", label: "B1", x: 60, y: 210, w: 90, h: 60, seats: 6, shape: "rect" },
  { id: "B2", label: "B2", x: 180, y: 210, w: 90, h: 60, seats: 6, shape: "rect" },
  { id: "B3", label: "B3", x: 300, y: 210, w: 90, h: 60, seats: 6, shape: "rect" },
  { id: "C1", label: "C1", x: 90, y: 320, w: 80, h: 80, seats: 6, shape: "round" },
  { id: "C2", label: "C2", x: 230, y: 320, w: 80, h: 80, seats: 6, shape: "round" },
  { id: "C3", label: "C3", x: 370, y: 320, w: 60, h: 60, seats: 2, shape: "round" },
  ...Array.from({ length: 7 }, (_, index) => ({
    id: `Bar${index + 1}`,
    label: `Bar ${index + 1}`,
    x: 60 + index * 55,
    y: 460,
    w: 40,
    h: 40,
    seats: 1,
    shape: "bar" as const,
  })),
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
