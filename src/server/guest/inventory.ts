import type { PoolClient, Pool } from "pg";
import { ApiError } from "./security";

type Queryable = Pick<PoolClient | Pool, "query">;

export type VenueAvailabilityResource = {
  id: string;
  zoneId: string;
  zoneCode: string;
  zoneName: string;
  code: string;
  name: string;
  resourceType: "table" | "private_room" | "bar_seating";
  capacity: number | null;
  status: "free" | "reserved" | "unavailable";
  available: boolean;
  bookable: boolean;
  fitsGuestCount: boolean;
  unavailableReason: string | null;
  layout: {
    version: number;
    x: number | null;
    y: number | null;
    width: number | null;
    height: number | null;
    shape: string | null;
    rotation: number | null;
    displayProperties: Record<string, unknown>;
  };
};

export type VenueAvailabilityZone = {
  id: string;
  code: string;
  name: string;
  type: "main_hall" | "secondary_hall" | "vip" | "shared_hall" | "bar";
  description: string | null;
  displayOrder: number;
  isActive: boolean;
  resources: VenueAvailabilityResource[];
};

export type VenueResourceRow = {
  id: string;
  zone_id: string;
  code: string;
  name: string;
  resource_type: "table" | "private_room" | "bar_seating";
  capacity: number | null;
  is_reservable: boolean;
  status: "active" | "inactive" | "maintenance" | "unverified";
  zone_code: string;
  zone_name: string;
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
  shape: string | null;
  rotation: number | null;
  display_properties: Record<string, unknown>;
};

const LEGACY_CODES = new Set(["A1", "A2", "A3", "B1", "B2", "B3", "B4", "C1", "C2", "Bar"]);

export async function listVenueAvailability(
  db: Queryable,
  startsAt: string,
  endsAt: string,
  guests: number | null,
  guestId: string | null,
) {
  const [zonesResult, busyResult] = await Promise.all([
    db.query(
      `SELECT z.id AS zone_id,z.code AS zone_code,z.name AS zone_name,z.zone_type,
        z.description,z.display_order,z.is_active,
        r.id,r.code,r.name,r.resource_type,r.capacity,r.is_reservable,r.status,
        l.x,l.y,l.width,l.height,l.shape,l.rotation,l.display_properties
       FROM venue_zones z
       LEFT JOIN venue_resources r ON r.zone_id=z.id
       LEFT JOIN venue_layout l ON l.resource_id=r.id
       WHERE z.venue_code='xoxo' AND z.is_active
       ORDER BY z.display_order,r.code`,
    ),
    db.query(
      `SELECT unnest(COALESCE(r.table_ids,
          CASE WHEN r.table_id IS NULL THEN '{}'::text[] ELSE ARRAY[r.table_id] END)) AS code
       FROM command_center_reservations r
       WHERE r.status NOT IN ('cancelled','no_show') AND r.starts_at<$2
         AND COALESCE(r.ends_at,r.starts_at+interval '2 hours')>$1
       UNION
       SELECT unnest(h.table_ids) AS code FROM hostess_holds h
       WHERE h.consumed_at IS NULL AND h.expires_at>now()
         AND h.guest_id IS DISTINCT FROM $3::uuid AND h.starts_at<$2 AND h.ends_at>$1`,
      [startsAt, endsAt, guestId],
    ),
  ]);

  const busy = new Set<string>(busyResult.rows.map((row) => String(row.code)));
  const legacyBusy = [...busy].some((code) => LEGACY_CODES.has(code));
  const zones = new Map<string, VenueAvailabilityZone>();
  const resources: VenueAvailabilityResource[] = [];

  for (const row of zonesResult.rows as (VenueResourceRow & {
    zone_type: "main_hall" | "secondary_hall" | "vip" | "shared_hall" | "bar";
    description: string | null;
    display_order: number;
    is_active: boolean;
  })[]) {
    let zone = zones.get(row.zone_id);
    if (!zone) {
      zone = {
        id: row.zone_id,
        code: row.zone_code,
        name: row.zone_name,
        type: row.zone_type,
        description: row.description,
        displayOrder: row.display_order,
        isActive: row.is_active,
        resources: [],
      };
      zones.set(row.zone_id, zone);
    }
    if (!zone) continue;
    if (!row.id) continue;
    const bookable = row.is_reservable && row.status === "active" && row.capacity !== null;
    const occupied = busy.has(row.code) || legacyBusy;
    const fitsGuestCount = guests === null || (row.capacity !== null && row.capacity >= guests);
    const resource: VenueAvailabilityResource = {
      id: row.id,
      zoneId: row.zone_id,
      zoneCode: row.zone_code,
      zoneName: row.zone_name,
      code: row.code,
      name: row.name,
      resourceType: row.resource_type,
      capacity: row.capacity,
      status: occupied ? "reserved" : bookable ? "free" : "unavailable",
      available: bookable && !occupied,
      bookable,
      fitsGuestCount,
      unavailableReason: occupied
        ? legacyBusy && !busy.has(row.code)
          ? "legacy_mapping"
          : "occupied"
        : !bookable
          ? "not_verified"
          : !fitsGuestCount
            ? "capacity"
            : null,
      layout: {
        version: 1,
        x: row.x === null ? null : Number(row.x),
        y: row.y === null ? null : Number(row.y),
        width: row.width === null ? null : Number(row.width),
        height: row.height === null ? null : Number(row.height),
        shape: row.shape,
        rotation: row.rotation === null ? null : Number(row.rotation),
        displayProperties: row.display_properties ?? {},
      },
    };
    zone.resources.push(resource);
    resources.push(resource);
  }

  return {
    zones: [...zones.values()],
    resources,
  };
}

export async function selectReservableResource(
  client: PoolClient,
  input: {
    resourceId?: string;
    zoneId?: string;
    startsAt: string;
    endsAt: string;
    guests: number;
  },
): Promise<VenueResourceRow> {
  let candidates = await client.query<VenueResourceRow>(
    `SELECT r.id,r.zone_id,r.code,r.name,r.resource_type,r.capacity,r.is_reservable,r.status,
       z.code AS zone_code,z.name AS zone_name,
       l.x,l.y,l.width,l.height,l.shape,l.rotation,l.display_properties
     FROM venue_resources r JOIN venue_zones z ON z.id=r.zone_id
     LEFT JOIN venue_layout l ON l.resource_id=r.id
     WHERE r.venue_code='xoxo' AND z.is_active AND r.is_reservable AND r.status='active'
       AND r.capacity >= $1 AND ($2::uuid IS NULL OR r.id=$2)
       AND ($3::uuid IS NULL OR r.zone_id=$3)
       AND NOT EXISTS (
         SELECT 1 FROM command_center_reservations b
         WHERE b.status NOT IN ('cancelled','no_show')
           AND COALESCE(b.table_ids,CASE WHEN b.table_id IS NULL THEN '{}'::text[] ELSE ARRAY[b.table_id] END)
             && CASE WHEN $2::uuid IS NOT NULL THEN ARRAY[r.code] ELSE ARRAY[r.code] END
           AND b.starts_at<$5 AND COALESCE(b.ends_at,b.starts_at+interval '2 hours')>$4
       )
       AND NOT EXISTS (
         SELECT 1 FROM hostess_holds h WHERE h.consumed_at IS NULL AND h.expires_at>now()
           AND r.code=ANY(h.table_ids) AND h.starts_at<$5 AND h.ends_at>$4
       )
       AND NOT EXISTS (
         SELECT 1 FROM command_center_reservations b
         WHERE b.status NOT IN ('cancelled','no_show')
           AND COALESCE(b.table_ids,CASE WHEN b.table_id IS NULL THEN '{}'::text[] ELSE ARRAY[b.table_id] END)
             && ARRAY['A1','A2','A3','B1','B2','B3','B4','C1','C2','Bar']::text[]
           AND b.starts_at<$5 AND COALESCE(b.ends_at,b.starts_at+interval '2 hours')>$4
       )
       AND NOT EXISTS (
         SELECT 1 FROM hostess_holds h WHERE h.consumed_at IS NULL AND h.expires_at>now()
           AND h.table_ids && ARRAY['A1','A2','A3','B1','B2','B3','B4','C1','C2','Bar']::text[]
           AND h.starts_at<$5 AND h.ends_at>$4
       )
     ORDER BY r.capacity ASC,z.display_order,r.code
     LIMIT 1 FOR UPDATE OF r`,
    [input.guests, input.resourceId ?? null, input.zoneId ?? null, input.startsAt, input.endsAt],
  );
  if (candidates.rows[0]) return candidates.rows[0];

  if (input.resourceId) {
    const requested = await client.query<{ capacity: number | null; is_reservable: boolean; status: string }>(
      `SELECT r.capacity,r.is_reservable,r.status FROM venue_resources r
       JOIN venue_zones z ON z.id=r.zone_id WHERE r.id=$1 AND r.venue_code='xoxo' AND z.is_active`,
      [input.resourceId],
    );
    if (!requested.rows[0]) throw new ApiError(422, "INVALID_RESOURCE", "Такого места нет в схеме заведения");
    if (!requested.rows[0].is_reservable || requested.rows[0].status !== "active")
      throw new ApiError(409, "RESOURCE_UNAVAILABLE", "Это место пока нельзя забронировать автоматически");
    if (requested.rows[0].capacity === null || requested.rows[0].capacity < input.guests)
      throw new ApiError(422, "CAPACITY", "В выбранной комнате недостаточно мест");
    throw new ApiError(409, "CONFLICT", "Это место уже занято на выбранное время");
  }

  const count = await client.query<{ eligible: boolean; reservable: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM venue_resources r JOIN venue_zones z ON z.id=r.zone_id
       WHERE r.venue_code='xoxo' AND z.is_active
       AND ($1::uuid IS NULL OR r.zone_id=$1) AND r.capacity >= $2) AS eligible,
       EXISTS(SELECT 1 FROM venue_resources r JOIN venue_zones z ON z.id=r.zone_id
       WHERE r.venue_code='xoxo' AND z.is_active
       AND ($1::uuid IS NULL OR r.zone_id=$1) AND r.is_reservable AND r.status='active') AS reservable`,
    [input.zoneId ?? null, input.guests],
  );
  if (!count.rows[0]?.reservable)
    throw new ApiError(409, "ZONE_UNVERIFIED", "В этой зоне ещё не подтверждены бронируемые места");
  if (!count.rows[0]?.eligible)
    throw new ApiError(422, "CAPACITY", "В этой зоне нет места для указанного числа гостей");
  throw new ApiError(409, "NO_AVAILABILITY", "Нет свободных подходящих мест на это время");
}
