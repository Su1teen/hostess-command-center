import type {
  CreateReservationResult,
  ReservationPreorder,
  ReservationStatus,
  DepositStatus,
  ReservationsBoard,
  TableAvailability,
  TableAvailabilityEntry,
  TableOccupancy,
  VenueResourceAvailability,
  VenueZoneAvailability,
} from "../../lib/types/reservations";
import { HALL_TABLES, findTable } from "../../lib/hall/layout";
import { almatyDayRange } from "../time";
import { query } from "../db/pool";
import * as reservations from "../repositories/reservations.repository";

export async function getReservationsBoard(date?: string): Promise<ReservationsBoard> {
  const range = almatyDayRange(date);
  const upcoming = await reservations.listByRange(range.start, range.end);
  const active = upcoming.filter((reservation) => reservation.status !== "cancelled");
  return {
    date: range.date,
    dateLabel: range.dateLabel,
    kpis: {
      reservationsToday: active.length,
      expectedGuests: upcoming
        .filter(
          (reservation) => reservation.status === "confirmed" || reservation.status === "expected",
        )
        .reduce((sum, reservation) => sum + reservation.guests, 0),
      depositsTotal: upcoming
        .filter((reservation) => reservation.depositStatus === "paid")
        .reduce((sum, reservation) => sum + reservation.depositAmount, 0),
      preordersTotal: upcoming.reduce((sum, reservation) => sum + reservation.preorderTotal, 0),
    },
    upcoming: [...upcoming].sort((a, b) => {
      const terminal = (status: string) => status === "cancelled" || status === "no_show";
      return (
        Number(terminal(a.status)) - Number(terminal(b.status)) ||
        a.startsAt.localeCompare(b.startsAt)
      );
    }),
  };
}

/**
 * Occupancy of every hall table for the window [startsAt, endsAt).
 * Single query for all tables; `arrived` wins over `confirmed`/`expected`.
 */
export async function getTableAvailability(
  startsAt: string,
  endsAt: string,
): Promise<TableAvailability> {
  const overlapping = await reservations.listActiveOverlapping(
    new Date(startsAt),
    new Date(endsAt),
  );
  const byTable = new Map<string, TableAvailabilityEntry>();
  for (const reservation of overlapping) {
    if (!reservation.tableIds.length) continue;
    for (const tableId of reservation.tableIds) {
      const status: TableOccupancy = reservation.status === "arrived" ? "seated" : "booked";
      const existing = byTable.get(tableId);
      if (!existing || (existing.status === "booked" && status === "seated")) {
        byTable.set(tableId, { tableId, status, reservation });
      }
    }
  }
  const held = await query<{ code: string }>(
    `SELECT unnest(table_ids) AS code FROM hostess_holds
     WHERE consumed_at IS NULL AND expires_at>now() AND starts_at<$2 AND ends_at>$1`,
    [startsAt, endsAt],
  );
  for (const row of held.rows) {
    if (!byTable.has(row.code)) byTable.set(row.code, { tableId: row.code, status: "booked", reservation: null });
  }
  const legacyCodes = new Set(HALL_TABLES.map((table) => table.id));
  const legacyBusy = [...byTable.keys()].some((code) => legacyCodes.has(code));
  const [zonesResult, inventory] = await Promise.all([
    query<Pick<VenueZoneAvailability, "id" | "code" | "name" | "type" | "description" | "displayOrder">>(
      `SELECT id,code,name,zone_type AS type,description,display_order AS "displayOrder"
       FROM venue_zones WHERE venue_code='xoxo' AND is_active ORDER BY display_order`,
    ),
    query<{
    id: string;
    zone_id: string;
    zone_code: string;
    zone_name: string;
    code: string;
    name: string;
    resource_type: "table" | "private_room" | "bar_seating";
    capacity: number | null;
    is_reservable: boolean;
    status: "active" | "inactive" | "maintenance" | "unverified";
    x: number | null;
    y: number | null;
    width: number | null;
    height: number | null;
    shape: string | null;
    rotation: number | null;
    }>(
    `SELECT r.id,r.zone_id,z.code AS zone_code,z.name AS zone_name,r.code,r.name,
       r.resource_type,r.capacity,r.is_reservable,r.status,l.x,l.y,l.width,l.height,l.shape,l.rotation
     FROM venue_resources r JOIN venue_zones z ON z.id=r.zone_id
     LEFT JOIN venue_layout l ON l.resource_id=r.id
     WHERE r.venue_code='xoxo' AND z.is_active ORDER BY z.display_order,r.code`,
    ),
  ]);
  const zoneMap = new Map<string, VenueZoneAvailability>(
    zonesResult.rows.map((zone) => [zone.id, { ...zone, resources: [] }]),
  );
  const resourceAvailability: VenueResourceAvailability[] = [];
  for (const row of inventory.rows) {
    const bookable = row.is_reservable && row.status === "active" && row.capacity !== null;
    const available = bookable && !byTable.has(row.code) && !legacyBusy;
    const resource: VenueResourceAvailability = {
      id: row.id,
      zoneId: row.zone_id,
      zoneCode: row.zone_code,
      zoneName: row.zone_name,
      code: row.code,
      name: row.name,
      resourceType: row.resource_type,
      capacity: row.capacity === null ? null : Number(row.capacity),
      isReservable: bookable,
      status: !bookable ? "unavailable" as const : available ? "free" as const : "booked" as const,
      available,
      layout:
        row.x === null && row.y === null && row.width === null && row.height === null
          ? null
          : {
              x: row.x === null ? null : Number(row.x),
              y: row.y === null ? null : Number(row.y),
              width: row.width === null ? null : Number(row.width),
              height: row.height === null ? null : Number(row.height),
              shape: row.shape,
              rotation: row.rotation === null ? null : Number(row.rotation),
            },
    };
    resourceAvailability.push(resource);
    zoneMap.get(row.zone_id)?.resources.push(resource);
  }
  return {
    startsAt,
    endsAt,
    tables: HALL_TABLES.map(
      (table) => byTable.get(table.id) ?? { tableId: table.id, status: "free", reservation: null },
    ),
    resources: resourceAvailability,
    zones: [...zoneMap.values()],
  };
}

export async function createReservation(
  input: Omit<reservations.ReservationInsert, "tableLabel" | "tableId"> & { tableId?: string },
  preorders: ReservationPreorder[],
): Promise<CreateReservationResult> {
  if (new Date(input.endsAt) <= new Date(input.startsAt))
    return {
      ok: false,
      code: "invalid",
      message: "Время окончания должно быть позже начала",
    };
  const table = findTable(input.tableId);
  let resourceId = input.resourceId;
  let resourceName: string | null = null;
  let tableId = input.tableId ?? "";
  let tableLabel: string | null = table?.label ?? null;
  let capacity = table?.seats ?? 0;
  if (resourceId) {
    const result = await query<{ id: string; code: string; name: string; capacity: number | null; is_reservable: boolean; status: string }>(
      `SELECT r.id,r.code,r.name,r.capacity,r.is_reservable,r.status
       FROM venue_resources r JOIN venue_zones z ON z.id=r.zone_id
       WHERE r.id=$1 AND r.venue_code='xoxo' AND z.is_active`,
      [resourceId],
    );
    const resource = result.rows[0];
    if (!resource || !resource.is_reservable || resource.status !== "active")
      return { ok: false, code: "invalid", message: "Это место пока нельзя бронировать" };
    if (!resource.capacity || input.guests > resource.capacity)
      return { ok: false, code: "invalid", message: "Превышена вместимость комнаты" };
    tableId = resource.code;
    tableLabel = resource.name;
    capacity = resource.capacity;
    resourceName = resource.name;
  }
  if (!table && !resourceId)
    return { ok: false, code: "invalid", message: "Такого места нет в подтверждённой схеме" };
  if (input.guests > capacity)
    return { ok: false, code: "invalid", message: `Вместимость ${resourceName ?? "стола"} превышена` };
  try {
    const reservation = await reservations.insert(
      { ...input, tableId, tableLabel: tableLabel ?? tableId, resourceId },
      preorders.map((preorder) => ({
        ...preorder,
        total: preorder.quantity * preorder.unitPrice,
      })),
    );
    return { ok: true, reservation };
  } catch (error) {
    if (error instanceof reservations.ReservationConflictError) {
      return {
        ok: false,
        code: "conflict",
        message: `${tableLabel ?? tableId} уже занято: ${error.conflicting.guestName}`,
      };
    }
    if ((error as { code?: string })?.code === "23P01")
      return {
        ok: false,
        code: "conflict",
        message: "Стол занят или временно удерживается гостем",
      };
    throw error;
  }
}

export function setReservationStatus(id: string, status: ReservationStatus) {
  return reservations.updateStatus(id, status);
}

export function setDepositStatus(id: string, status: DepositStatus) {
  return reservations.updateDepositStatus(id, status);
}
