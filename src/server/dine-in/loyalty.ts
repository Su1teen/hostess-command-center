import type { PoolClient } from "pg";
import { pageCursor } from "./presentation";
import { ApiError } from "../guest/security";

// Same lock is used during identity merge. The pilot prioritizes correctness over throughput.
export async function loyaltyLock(client: PoolClient) {
  await client.query("SELECT pg_advisory_xact_lock(728411007)");
}
export async function wallets(client: PoolClient, venueId: string, guestId: string) {
  const guest = (
    await client.query("SELECT id FROM hostess_guests WHERE id=$1 AND merged_into IS NULL", [
      guestId,
    ])
  ).rows[0];
  if (!guest)
    throw new ApiError(409, "SESSION_CHANGED", "Войдите повторно после объединения профиля");
  await client.query(
    `INSERT INTO loyalty_wallets(venue_id,guest_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,
    [venueId, guestId],
  );
  return (
    await client.query<{ id: string; debt_minor: string }>(
      `WITH RECURSIVE family AS (
    SELECT id FROM hostess_guests WHERE id=$2 UNION ALL SELECT g.id FROM hostess_guests g JOIN family f ON g.merged_into=f.id
  ) SELECT w.id,w.debt_minor FROM loyalty_wallets w WHERE w.venue_id=$1 AND w.guest_id IN(SELECT id FROM family) ORDER BY w.id FOR UPDATE`,
      [venueId, guestId],
    )
  ).rows;
}
export async function walletView(client: PoolClient, venueId: string, guestId: string) {
  const list = await wallets(client, venueId, guestId),
    ids = list.map((w) => w.id);
  const row = (
    await client.query(
      `SELECT COALESCE(sum(remaining_minor),0)::text AS gross,
    min(expires_at) AS "nextExpiry",COALESCE(sum(remaining_minor) FILTER(WHERE expires_at<=now()+interval '3 days'),0)::text AS "expiringMinor"
    FROM loyalty_lots WHERE wallet_id=ANY($1::uuid[]) AND expires_at>clock_timestamp() AND reversed_at IS NULL AND remaining_minor>0`,
      [ids],
    )
  ).rows[0];
  const debt = list.reduce((n, w) => n + Number(w.debt_minor), 0);
  const lots = (
    await client.query(
      'SELECT id,remaining_minor::text AS "remainingMinor",expires_at AS "expiresAt" FROM loyalty_lots WHERE wallet_id=ANY($1::uuid[]) AND expires_at>clock_timestamp() AND reversed_at IS NULL AND remaining_minor>0 ORDER BY expires_at,id',
      [ids],
    )
  ).rows.map((l) => ({ ...l, remaining: Number(l.remainingMinor) / 100 }));
  return {
    balance: Math.max(0, Number(row.gross) - debt) / 100,
    expiringAmount:
      Math.min(Math.max(0, Number(row.gross) - debt), Number(row.expiringMinor)) / 100,
    nextExpiresAt: row.nextExpiry,
    lots,
    currency: "KZT",
    balanceMinor: Math.max(0, Number(row.gross) - debt),
    debtMinor: debt,
    nextExpiry: row.nextExpiry,
    expiringMinor: Math.min(Math.max(0, Number(row.gross) - debt), Number(row.expiringMinor)),
  };
}
export async function ledger(
  client: PoolClient,
  venueId: string,
  guestId: string,
  before?: string | null,
) {
  const ids = (await wallets(client, venueId, guestId)).map((w) => w.id);
  const [at, id] = pageCursor(before);
  return (
    await client.query(
      `SELECT t.id,t.type,t.amount_minor::text AS "amountMinor",t.order_id AS "orderId",t.created_at AS "createdAt",t.details,
    to_char(t.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "paginationTime",l.expires_at AS "expiresAt" FROM loyalty_transactions t LEFT JOIN loyalty_lots l ON l.id=t.lot_id
    WHERE t.wallet_id=ANY($1::uuid[]) AND ($2::timestamptz IS NULL OR ($3::uuid IS NULL AND t.created_at<$2) OR (t.created_at,t.id)<($2::timestamptz,$3::uuid)) ORDER BY t.created_at DESC,t.id DESC LIMIT 200`,
      [ids, at, id],
    )
  ).rows.map((t) => ({ ...t, amount: Number(t.amountMinor) / 100 }));
}
export async function expireLots(client: PoolClient, ids: string[]) {
  const lots = (
    await client.query(
      `SELECT * FROM loyalty_lots WHERE wallet_id=ANY($1::uuid[]) AND expires_at<=clock_timestamp() AND remaining_minor>0 FOR UPDATE`,
      [ids],
    )
  ).rows;
  for (const lot of lots) {
    await client.query(
      `INSERT INTO loyalty_transactions(venue_id,wallet_id,lot_id,type,amount_minor,operation_key)
      VALUES($1,$2,$3,'expire',$4,$5) ON CONFLICT(operation_key) DO NOTHING`,
      [lot.venue_id, lot.wallet_id, lot.id, -Number(lot.remaining_minor), `expire:${lot.id}`],
    );
    await client.query("UPDATE loyalty_lots SET remaining_minor=0 WHERE id=$1", [lot.id]);
  }
}
export async function redeem(
  client: PoolClient,
  venueId: string,
  guestId: string,
  orderId: string,
  amount: number,
) {
  const list = await wallets(client, venueId, guestId),
    ids = list.map((w) => w.id);
  await expireLots(client, ids);
  const balance = await walletView(client, venueId, guestId);
  if (balance.balanceMinor < amount)
    throw new ApiError(409, "REQUOTE", "Бонусный баланс изменился. Обновите расчёт");
  const lots = (
    await client.query(
      `SELECT * FROM loyalty_lots WHERE wallet_id=ANY($1::uuid[]) AND remaining_minor>0
    AND reversed_at IS NULL AND expires_at>clock_timestamp() ORDER BY expires_at,id FOR UPDATE`,
      [ids],
    )
  ).rows;
  let remaining = amount;
  for (const lot of lots) {
    const take = Math.min(remaining, Number(lot.remaining_minor));
    if (!take) break;
    await client.query("UPDATE loyalty_lots SET remaining_minor=remaining_minor-$2 WHERE id=$1", [
      lot.id,
      take,
    ]);
    await client.query(
      `INSERT INTO loyalty_transactions(venue_id,wallet_id,order_id,lot_id,type,amount_minor,operation_key)
      VALUES($1,$2,$3,$4,'redeem',$5,$6)`,
      [venueId, lot.wallet_id, orderId, lot.id, -take, `redeem:${orderId}:${lot.id}`],
    );
    remaining -= take;
  }
  if (remaining) throw new ApiError(409, "REQUOTE", "Бонусы истекли. Обновите расчёт");
}
export async function earn(
  client: PoolClient,
  venueId: string,
  guestId: string,
  orderId: string,
  amount: number,
) {
  if (!amount) return;
  const wallet = (
    await client.query(`SELECT id FROM loyalty_wallets WHERE venue_id=$1 AND guest_id=$2`, [
      venueId,
      guestId,
    ])
  ).rows[0];
  const lot = (
    await client.query(
      `INSERT INTO loyalty_lots(venue_id,wallet_id,order_id,earned_minor,remaining_minor,expires_at)
    SELECT $1,$2,$3,$4,$4,now()+p.lifetime_days*interval '1 day' FROM loyalty_programs p WHERE p.venue_id=$1 RETURNING id`,
      [venueId, wallet.id, orderId, amount],
    )
  ).rows[0];
  await client.query(
    `INSERT INTO loyalty_transactions(venue_id,wallet_id,order_id,lot_id,type,amount_minor,operation_key)
    VALUES($1,$2,$3,$4,'earn',$5,$6)`,
    [venueId, wallet.id, orderId, lot.id, amount, `earn:${orderId}`],
  );
}
export async function reverseLoyalty(client: PoolClient, venueId: string, orderId: string) {
  const earned = (
    await client.query("SELECT * FROM loyalty_lots WHERE order_id=$1 FOR UPDATE", [orderId])
  ).rows[0];
  if (earned && !earned.reversed_at) {
    // If cashback has already been spent, debt prevents cancellation from minting money.
    // Expiry ledger distinguishes naturally expired points from points actually spent.
    const expired = Number(
      (
        await client.query(
          "SELECT COALESCE(sum(-amount_minor),0) AS amount FROM loyalty_transactions WHERE lot_id=$1 AND type='expire'",
          [earned.id],
        )
      ).rows[0].amount,
    );
    const debt = Math.max(
      0,
      Number(earned.earned_minor) - Number(earned.remaining_minor) - expired,
    );
    await client.query("UPDATE loyalty_wallets SET debt_minor=debt_minor+$2 WHERE id=$1", [
      earned.wallet_id,
      debt,
    ]);
    await client.query("UPDATE loyalty_lots SET remaining_minor=0,reversed_at=now() WHERE id=$1", [
      earned.id,
    ]);
    const reversal = Number(earned.earned_minor) - expired;
    if (reversal > 0)
      await client.query(
        `INSERT INTO loyalty_transactions(venue_id,wallet_id,order_id,lot_id,type,amount_minor,operation_key,details)
      VALUES($1,$2,$3,$4,'reversal',$5,$6,$7)`,
        [
          venueId,
          earned.wallet_id,
          orderId,
          earned.id,
          -reversal,
          `revoke:${orderId}`,
          JSON.stringify({ debtMinor: debt, alreadyExpiredMinor: expired }),
        ],
      );
  }
  const spent = (
    await client.query(
      "SELECT * FROM loyalty_transactions WHERE order_id=$1 AND type='redeem' ORDER BY lot_id",
      [orderId],
    )
  ).rows;
  for (const entry of spent) {
    const lot = (
      await client.query("SELECT * FROM loyalty_lots WHERE id=$1 FOR UPDATE", [entry.lot_id])
    ).rows[0];
    const amount = -Number(entry.amount_minor);
    if (lot.reversed_at)
      await client.query(
        "UPDATE loyalty_wallets SET debt_minor=GREATEST(0,debt_minor-$2) WHERE id=$1",
        [entry.wallet_id, amount],
      );
    else
      await client.query("UPDATE loyalty_lots SET remaining_minor=remaining_minor+$2 WHERE id=$1", [
        entry.lot_id,
        amount,
      ]);
    await client.query(
      `INSERT INTO loyalty_transactions(venue_id,wallet_id,order_id,lot_id,type,amount_minor,operation_key,details)
      VALUES($1,$2,$3,$4,'reversal',$5,$6,$7)`,
      [
        venueId,
        entry.wallet_id,
        orderId,
        entry.lot_id,
        amount,
        `restore:${orderId}:${entry.lot_id}`,
        JSON.stringify({ originalExpiry: lot.expires_at }),
      ],
    );
    // Restored expired lots retain the original expiry and get an immediate expiry entry.
    if (!lot.reversed_at && new Date(lot.expires_at).getTime() <= Date.now()) {
      await client.query("UPDATE loyalty_lots SET remaining_minor=remaining_minor-$2 WHERE id=$1", [
        entry.lot_id,
        amount,
      ]);
      await client.query(
        `INSERT INTO loyalty_transactions(venue_id,wallet_id,order_id,lot_id,type,amount_minor,operation_key)
        VALUES($1,$2,$3,$4,'expire',$5,$6)`,
        [
          venueId,
          entry.wallet_id,
          orderId,
          entry.lot_id,
          -amount,
          `restore-expire:${orderId}:${entry.lot_id}`,
        ],
      );
    }
  }
}
export async function mergeDiningGuest(client: PoolClient, from: string, to: string) {
  await loyaltyLock(client);
  if (from === to) return;
  const rows = (
    await client.query(
      "SELECT id,provisional,merged_into FROM hostess_guests WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      [[from, to]],
    )
  ).rows;
  if (
    rows.length !== 2 ||
    !rows.find((r) => r.id === from)?.provisional ||
    rows.some((r) => r.merged_into)
  )
    throw new ApiError(409, "MERGE_CONFLICT", "Профили уже изменены");
  await client.query("UPDATE dine_in_orders SET guest_id=$2 WHERE guest_id=$1", [from, to]);
  // Quotes use owner_hash as well as guest_id, so old browser confirmations cannot be stolen.
  await client.query("UPDATE hostess_guests SET merged_into=$2,updated_at=now() WHERE id=$1", [
    from,
    to,
  ]);
  // Lots and immutable ledger stay in original wallets; canonical views include the alias tree.
}

export async function mergeVerifiedStaffGuests(
  client: PoolClient,
  canonical: string,
  phone: string,
) {
  if (!(await client.query("SELECT to_regclass('hostess_venues') AS name")).rows[0].name) return;
  await loyaltyLock(client);
  const proof = await client.query(
    "SELECT 1 FROM hostess_phone_verifications WHERE guest_id=$1 AND phone=$2",
    [canonical, phone],
  );
  if (!proof.rowCount)
    throw new ApiError(403, "OWNERSHIP_UNVERIFIED", "Требуется подтверждённый контакт");
  const candidates = (
    await client.query(
      "SELECT id FROM hostess_guests WHERE phone=$1 AND source='staff' AND provisional AND merged_into IS NULL AND id<>$2 ORDER BY id FOR UPDATE",
      [phone, canonical],
    )
  ).rows;
  for (const candidate of candidates) {
    await mergeDiningGuest(client, candidate.id, canonical);
    await client.query("SELECT set_config('hostess.actor',$1,true)", ["whatsapp:" + canonical]);
    await client.query(
      "UPDATE command_center_reservations SET guest_id=$1,updated_at=now() WHERE guest_id=$2",
      [canonical, candidate.id],
    );
    await client.query("UPDATE hostess_quotes SET guest_id=$1 WHERE guest_id=$2", [
      canonical,
      candidate.id,
    ]);
    await client.query("UPDATE hostess_holds SET guest_id=$1 WHERE guest_id=$2", [
      canonical,
      candidate.id,
    ]);
    await client.query("UPDATE hostess_sessions SET revoked_at=now() WHERE guest_id=$1", [
      candidate.id,
    ]);
    await client.query(
      "INSERT INTO hostess_audit(actor,action,entity_id,details) VALUES($1,'staff_guest_verified_merge',$2,$3)",
      ["whatsapp:" + canonical, canonical, JSON.stringify({ provisionalId: candidate.id })],
    );
  }
}
