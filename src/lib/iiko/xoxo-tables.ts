import floor from "./xoxo-floor.json";

/** Snapshot of the XOXO hall schema exported from iiko (see scripts/export-iiko-floor.mjs). */
export type IikoTable = {
  id: string;
  number: number;
  name: string;
  seatingCapacity: number;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
};
export type IikoLabel = { text: string; x: number; y: number; width: number; height: number };
export type IikoSection = {
  id: string;
  name: string;
  width: number;
  height: number;
  tables: IikoTable[];
  labels: IikoLabel[];
  unplacedTables: { id: string; number: number; name: string }[];
};

export const IIKO_FLOOR = floor as {
  source: string;
  organization: string;
  exportedAt: string;
  sections: IikoSection[];
};

export type QrZoneCode = "first_hall" | "second_hall" | "ps" | "vip";

/** A table that gets a QR code: the pilot's 17 physical places mapped onto iiko tables. */
export type QrPoint = {
  qrCode: string;
  name: string;
  zoneCode: QrZoneCode;
  zoneName: string;
  iikoSection: string;
  iikoNumber: number;
  /** Seating as stated by the owner; iiko keeps seatingCapacity = 0 for every table. */
  seats: string | null;
};

const ZONES: Record<QrZoneCode, { name: string; section: string }> = {
  first_hall: { name: "Основной зал", section: "Зал (Барная)" },
  second_hall: { name: "Второй зал", section: "Общий зал" },
  ps: { name: "PlayStation", section: "PS (Общий зал)" },
  vip: { name: "VIP-комнаты", section: "ВИП" },
};
const VIP_SEATS = ["до 6 (средняя)", "до 9 (большая)", "до 4 (маленькая)"];

// Mirrors migration 0018: QR codes 01–08 main hall, 09–11 second hall, 12–14 VIP, 15–17 PS.
const ROWS: { code: string; zone: QrZoneCode; n: number; name: string; seats: string | null }[] = [
  ...Array.from({ length: 8 }, (_, i) => ({
    zone: "first_hall" as const,
    n: i + 1,
    prefix: "Стол",
  })),
  ...Array.from({ length: 3 }, (_, i) => ({
    zone: "second_hall" as const,
    n: i + 1,
    prefix: "Стол",
  })),
  ...Array.from({ length: 3 }, (_, i) => ({ zone: "vip" as const, n: i + 1, prefix: "VIP" })),
  ...Array.from({ length: 3 }, (_, i) => ({ zone: "ps" as const, n: i + 1, prefix: "PS" })),
].map((row, index) => ({
  code: String(index + 1).padStart(2, "0"),
  zone: row.zone,
  n: row.n,
  name: `${row.prefix} ${String(row.n).padStart(2, "0")}`,
  seats: row.zone === "vip" ? VIP_SEATS[row.n - 1] : "до 6",
}));

export const QR_POINTS: QrPoint[] = ROWS.map((row) => ({
  qrCode: row.code,
  name: row.name,
  zoneCode: row.zone,
  zoneName: ZONES[row.zone].name,
  iikoSection: ZONES[row.zone].section,
  iikoNumber: row.n,
  seats: row.seats,
}));

export function qrPointFor(sectionName: string, number: number): QrPoint | undefined {
  return QR_POINTS.find(
    (point) => point.iikoSection === sectionName && point.iikoNumber === number,
  );
}

export function qrPointsCsv(): string {
  const header = ["QR", "Название", "Зона", "Секция iiko", "№ в iiko", "Мест"];
  const rows = QR_POINTS.map((p) => [
    p.qrCode,
    p.name,
    p.zoneName,
    p.iikoSection,
    p.iikoNumber,
    p.seats ?? "",
  ]);
  return [header, ...rows].map((row) => row.join("\t")).join("\n");
}
