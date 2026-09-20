import type {
  DepositStatus,
  Reservation,
  ReservationPreorder,
  ReservationSource,
  ReservationStatus,
} from "../../lib/types/reservations";
import { pool, query } from "../db/pool";

type ReservationRow = {
  id: string;
  external_id: string | null;
  table_id: string | null;
  table_label: string | null;
  guest_name: string;
  phone: string;
  guests: number;
  starts_at: Date;
  ends_at: Date | null;
  status: ReservationStatus;
  deposit_amount: string | number;
  deposit_status: DepositStatus;
  source: ReservationSource;
  comment: string | null;
  created_at: Date;
  updated_at: Date;
};

type PreorderRow = {
  id: string;
  reservation_id: string;
  product_id: string | null;
  product_name: string;
  quantity: number;
  unit_price: string | number;
  total: string | number;
  comment: string | null;
};

function mapPreorder(row: PreorderRow): ReservationPreorder & { id: string } {
  return {
    id: row.id,
    productId: row.product_id,
    productName: row.product_name,
    quantity: Number(row.quantity),
    unitPrice: Number(row.unit_price),
    total: Number(row.total),
    comment: row.comment,
  };
}

function mapReservation(row: ReservationRow, preorders: ReservationPreorder[] = []): Reservation {
  return {
    id: row.id,
    externalId: row.external_id,
    tableId: row.table_id,
    tableLabel: row.table_label,
    guestName: row.guest_name,
    phone: row.phone,
    guests: Number(row.guests),
    startsAt: new Date(row.starts_at).toISOString(),
    endsAt: row.ends_at ? new Date(row.ends_at).toISOString() : null,
    status: row.status,
    depositAmount: Number(row.deposit_amount),
    depositStatus: row.deposit_status,
    source: row.source,
    comment: row.comment,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    preorders,
    preorderTotal: preorders.reduce((sum, preorder) => sum + preorder.total, 0),
  };
}

async function attachPreorders(rows: ReservationRow[]): Promise<Reservation[]> {
  if (!rows.length) return [];
  const preorders = await query<PreorderRow>(
    "SELECT id, reservation_id, product_id, product_name, quantity, unit_price, total, comment FROM command_center_reservation_preorders WHERE reservation_id = ANY($1::uuid[])",
    [rows.map((row) => row.id)],
  );
  const grouped = new Map<string, ReservationPreorder[]>();
  for (const row of preorders.rows) {
    const items = grouped.get(row.reservation_id) ?? [];
    items.push(mapPreorder(row));
    grouped.set(row.reservation_id, items);
  }
  return rows.map((row) => mapReservation(row, grouped.get(row.id) ?? []));
}

export async function listByRange(start: Date, end: Date): Promise<Reservation[]> {
  const result = await query<ReservationRow>(
    "SELECT * FROM command_center_reservations WHERE starts_at >= $1 AND starts_at < $2 ORDER BY starts_at ASC",
    [start, end],
  );
  return attachPreorders(result.rows);
}

/**
 * Active (not cancelled / no_show) reservations whose interval overlaps [start, end).
 * One query for the whole hall; legacy rows without ends_at are treated as 2h long.
 */
export async function listActiveOverlapping(start: Date, end: Date): Promise<Reservation[]> {
  const result = await query<ReservationRow>(
    `SELECT * FROM command_center_reservations
     WHERE status NOT IN ('cancelled', 'no_show')
       AND starts_at < $2
       AND COALESCE(ends_at, starts_at + interval '2 hours') > $1
     ORDER BY starts_at ASC`,
    [start, end],
  );
  return attachPreorders(result.rows);
}

export class ReservationConflictError extends Error {
  constructor(public readonly conflicting: Reservation) {
    super("Стол уже занят на это время");
    this.name = "ReservationConflictError";
  }
}

export async function getById(id: string): Promise<Reservation | null> {
  const result = await query<ReservationRow>(
    "SELECT * FROM command_center_reservations WHERE id = $1",
    [id],
  );
  return result.rows[0] ? ((await attachPreorders(result.rows))[0] ?? null) : null;
}

export interface ReservationInsert {
  tableId: string;
  tableLabel: string;
  guestName: string;
  phone: string;
  guests: number;
  startsAt: string;
  endsAt: string;
  source: ReservationSource;
  depositAmount: number;
  depositStatus: DepositStatus;
  comment?: string;
}

export async function insert(
  input: ReservationInsert,
  preorders: ReservationPreorder[],
): Promise<Reservation> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialize concurrent inserts for the same table so the overlap check cannot race.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`cc-table:${input.tableId}`]);
    const conflict = await client.query<ReservationRow>(
      `SELECT * FROM command_center_reservations
       WHERE table_id = $1
         AND status NOT IN ('cancelled', 'no_show')
         AND starts_at < $3
         AND COALESCE(ends_at, starts_at + interval '2 hours') > $2
       ORDER BY starts_at ASC
       LIMIT 1`,
      [input.tableId, input.startsAt, input.endsAt],
    );
    if (conflict.rows[0]) {
      await client.query("ROLLBACK");
      throw new ReservationConflictError(mapReservation(conflict.rows[0]));
    }
    const reservation = await client.query<ReservationRow>(
      `INSERT INTO command_center_reservations
        (table_id, table_label, guest_name, phone, guests, starts_at, ends_at, source, deposit_amount, deposit_status, comment)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        input.tableId,
        input.tableLabel,
        input.guestName,
        input.phone,
        input.guests,
        input.startsAt,
        input.endsAt,
        input.source,
        input.depositAmount,
        input.depositStatus,
        input.comment ?? null,
      ],
    );
    const row = reservation.rows[0];
    if (!row) throw new Error("Не удалось создать бронь");
    for (const preorder of preorders) {
      await client.query(
        `INSERT INTO command_center_reservation_preorders
          (reservation_id, product_id, product_name, quantity, unit_price, total, comment)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          row.id,
          preorder.productId ?? null,
          preorder.productName,
          preorder.quantity,
          preorder.unitPrice,
          preorder.total,
          preorder.comment ?? null,
        ],
      );
    }
    await client.query("COMMIT");
    return mapReservation(
      row,
      preorders.map((preorder, index) => ({ ...preorder, id: `new-${index}` })),
    );
  } catch (error) {
    if (!(error instanceof ReservationConflictError)) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateStatus(
  id: string,
  status: ReservationStatus,
): Promise<Reservation | null> {
  const result = await query<ReservationRow>(
    "UPDATE command_center_reservations SET status = $2, updated_at = now() WHERE id = $1 RETURNING *",
    [id, status],
  );
  return result.rows[0] ? getById(id) : null;
}

export async function updateDepositStatus(
  id: string,
  status: DepositStatus,
): Promise<Reservation | null> {
  const result = await query<ReservationRow>(
    "UPDATE command_center_reservations SET deposit_status = $2, updated_at = now() WHERE id = $1 RETURNING *",
    [id, status],
  );
  return result.rows[0] ? getById(id) : null;
}
