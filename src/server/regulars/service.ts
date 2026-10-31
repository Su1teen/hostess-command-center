import { z } from "zod";
import type { PoolClient } from "pg";
import { pool } from "../db/pool";
import { transaction } from "../guest/auth";
import { ApiError } from "../guest/security";
import { normalizePhone } from "../dine-in/domain";
import { loyaltyLock } from "../dine-in/loyalty";
import { venue } from "../dine-in/service";

export const regularSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    phone: z.string().trim().min(5).max(30),
    note: z.string().trim().max(500).default(""),
    // Whole tenge. 300 is the house default for a new regular.
    bonus: z.number().int().min(0).max(100_000).default(300),
    bonusDays: z.number().int().min(1).max(365).default(90),
  })
  .strict();
export const regularPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    note: z.string().trim().max(500).optional(),
    active: z.boolean().optional(),
    optedOut: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Нечего менять");
export const broadcastSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(1500),
    // Omitted = every active regular who did not opt out.
    regularIds: z.array(z.string().uuid()).min(1).max(1000).optional(),
  })
  .strict();

const audit = (client: PoolClient, staffId: string, action: string, id: string, details = {}) =>
  client.query("INSERT INTO hostess_audit(actor,action,entity_id,details) VALUES($1,$2,$3,$4)", [
    `staff:${staffId}`,
    action,
    id,
    JSON.stringify(details),
  ]);

/** Guest that should carry the bonus: the verified account if the phone already has one, else a staff guest. */
async function guestForPhone(client: PoolClient, name: string, phone: string) {
  const verified = (
    await client.query(
      `SELECT id FROM hostess_guests WHERE phone=$1 AND merged_into IS NULL AND NOT provisional
       ORDER BY created_at LIMIT 1`,
      [phone],
    )
  ).rows[0];
  if (verified) return verified.id as string;
  const staff = (
    await client.query(
      `SELECT id FROM hostess_guests WHERE phone=$1 AND merged_into IS NULL AND provisional AND source='staff'
       ORDER BY created_at LIMIT 1`,
      [phone],
    )
  ).rows[0];
  if (staff) return staff.id as string;
  return (
    await client.query(
      "INSERT INTO hostess_guests(name,phone,provisional,source) VALUES($1,$2,true,'staff') RETURNING id",
      [name, phone],
    )
  ).rows[0].id as string;
}

/**
 * Creates a regular and credits the welcome bonus. When the guest later verifies this phone
 * through WhatsApp, the staff guest merges into the real account and the bonus follows.
 */
export async function createRegular(
  staffId: string,
  raw: unknown,
  source: "manual" | "dayan" | "import" = "manual",
) {
  const input = regularSchema.parse(raw);
  const phone = normalizePhone(input.phone);
  return transaction(async (client) => {
    await loyaltyLock(client);
    const v = await venue(client, "xoxo");
    const existing = (
      await client.query("SELECT id,name FROM venue_regulars WHERE venue_id=$1 AND phone=$2", [
        v.id,
        phone,
      ])
    ).rows[0];
    if (existing)
      throw new ApiError(
        409,
        "ALREADY_REGULAR",
        `Этот номер уже в списке постоянников: ${existing.name}`,
      );
    const guestId = await guestForPhone(client, input.name, phone);
    await client.query(
      "INSERT INTO loyalty_wallets(venue_id,guest_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [v.id, guestId],
    );
    const wallet = (
      await client.query("SELECT id FROM loyalty_wallets WHERE venue_id=$1 AND guest_id=$2", [
        v.id,
        guestId,
      ])
    ).rows[0];
    let lotId: string | null = null;
    const bonusMinor = input.bonus * 100;
    if (bonusMinor > 0) {
      lotId = (
        await client.query(
          `INSERT INTO loyalty_lots(venue_id,wallet_id,earned_minor,remaining_minor,expires_at)
           VALUES($1,$2,$3,$3,now()+$4*interval '1 day') RETURNING id`,
          [v.id, wallet.id, bonusMinor, input.bonusDays],
        )
      ).rows[0].id;
      await client.query(
        `INSERT INTO loyalty_transactions(venue_id,wallet_id,lot_id,type,amount_minor,operation_key,details)
         VALUES($1,$2,$3,'adjustment',$4,$5,$6)`,
        [
          v.id,
          wallet.id,
          lotId,
          bonusMinor,
          `welcome:${v.id}:${phone}`,
          JSON.stringify({ reason: "welcome_regular", by: `staff:${staffId}` }),
        ],
      );
    }
    const row = (
      await client.query(
        `INSERT INTO venue_regulars(venue_id,guest_id,name,phone,note,welcome_bonus_minor,welcome_lot_id,source,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [v.id, guestId, input.name, phone, input.note, bonusMinor, lotId, source, staffId],
      )
    ).rows[0];
    await audit(client, staffId, "regular_created", row.id, { phone, bonusMinor });
    return { id: row.id as string };
  });
}

const regularFields = `r.id,r.name,r.phone,r.note,r.active,r.opted_out AS "optedOut",r.source,
  r.welcome_bonus_minor::text AS "welcomeBonusMinor",r.created_at AS "createdAt",r.guest_id AS "guestId"`;

/** Regulars with their live bonus balance and whether the guest already signed in to the account. */
export async function listRegulars(search = "") {
  const q = z.string().max(100).parse(search).trim();
  const v = await venue(pool, "xoxo");
  const rows = (
    await pool.query(
      `WITH RECURSIVE up AS (
         SELECT r.id AS rid, g.id AS gid, g.merged_into FROM venue_regulars r JOIN hostess_guests g ON g.id=r.guest_id WHERE r.venue_id=$1
         UNION ALL SELECT up.rid, g.id, g.merged_into FROM up JOIN hostess_guests g ON g.id=up.merged_into),
       roots AS (SELECT rid, gid AS root FROM up WHERE merged_into IS NULL),
       fam AS (SELECT rid, root AS gid FROM roots
         UNION ALL SELECT f.rid, g.id FROM fam f JOIN hostess_guests g ON g.merged_into=f.gid),
       gross AS (SELECT f.rid, COALESCE(sum(l.remaining_minor),0) AS amount FROM fam f
         JOIN loyalty_wallets w ON w.guest_id=f.gid AND w.venue_id=$1
         JOIN loyalty_lots l ON l.wallet_id=w.id AND l.expires_at>clock_timestamp() AND l.reversed_at IS NULL AND l.remaining_minor>0
         GROUP BY f.rid),
       debt AS (SELECT f.rid, COALESCE(sum(w.debt_minor),0) AS amount FROM fam f
         JOIN loyalty_wallets w ON w.guest_id=f.gid AND w.venue_id=$1 GROUP BY f.rid)
       SELECT ${regularFields},
         GREATEST(0, COALESCE(gross.amount,0)-COALESCE(debt.amount,0))::text AS "balanceMinor",
         (roots.root<>r.guest_id OR NOT g.provisional) AS "signedIn",
         (SELECT max(o.accepted_at) FROM dine_in_orders o WHERE o.guest_id=roots.root) AS "lastOrderAt"
       FROM venue_regulars r JOIN hostess_guests g ON g.id=r.guest_id
       LEFT JOIN roots ON roots.rid=r.id LEFT JOIN gross ON gross.rid=r.id LEFT JOIN debt ON debt.rid=r.id
       WHERE r.venue_id=$1
       ORDER BY r.created_at DESC LIMIT 1000`,
      [v.id],
    )
  ).rows;
  // Filter here: SQL case folding of Cyrillic depends on the database locale.
  const text = q.toLowerCase(),
    digits = q.replace(/\D/g, "");
  return q
    ? rows.filter(
        (row) =>
          String(row.name).toLowerCase().includes(text) ||
          (digits.length > 0 && String(row.phone).replace(/\D/g, "").includes(digits)),
      )
    : rows;
}

export async function updateRegular(staffId: string, id: string, raw: unknown) {
  const input = regularPatchSchema.parse(raw);
  return transaction(async (client) => {
    const row = (
      await client.query(
        `UPDATE venue_regulars SET name=COALESCE($2,name),note=COALESCE($3,note),active=COALESCE($4,active),
           opted_out=COALESCE($5,opted_out),updated_at=now() WHERE id=$1 RETURNING id`,
        [id, input.name ?? null, input.note ?? null, input.active ?? null, input.optedOut ?? null],
      )
    ).rows[0];
    if (!row) throw new ApiError(404, "NOT_FOUND", "Постоянник не найден");
    await audit(client, staffId, "regular_updated", id, { fields: Object.keys(input) });
    return { id };
  });
}

const personalise = (body: string, name: string) =>
  body.replace(/\{\s*(имя|name)\s*\}/gi, name.split(/\s+/)[0] || name);

/** Queues one personalised message per active regular. Nothing is sent from here. */
export async function createBroadcast(staffId: string, raw: unknown) {
  const input = broadcastSchema.parse(raw);
  return transaction(async (client) => {
    const v = await venue(client, "xoxo");
    const audience = (
      await client.query(
        `SELECT id,name,phone FROM venue_regulars
         WHERE venue_id=$1 AND active AND NOT opted_out AND ($2::uuid[] IS NULL OR id=ANY($2::uuid[]))
         ORDER BY name`,
        [v.id, input.regularIds ?? null],
      )
    ).rows;
    if (!audience.length)
      throw new ApiError(
        422,
        "NO_RECIPIENTS",
        "Некому отправлять: нет активных постоянников без отказа от рассылок",
      );
    const campaign = (
      await client.query(
        "INSERT INTO broadcast_campaigns(venue_id,title,body,created_by) VALUES($1,$2,$3,$4) RETURNING id",
        [v.id, input.title, input.body, staffId],
      )
    ).rows[0];
    for (const guest of audience)
      await client.query(
        `INSERT INTO broadcast_recipients(campaign_id,regular_id,name,phone,message) VALUES($1,$2,$3,$4,$5)`,
        [campaign.id, guest.id, guest.name, guest.phone, personalise(input.body, guest.name)],
      );
    await audit(client, staffId, "broadcast_created", campaign.id, { recipients: audience.length });
    return { id: campaign.id as string, recipients: audience.length };
  });
}

export async function listBroadcasts() {
  const v = await venue(pool, "xoxo");
  return (
    await pool.query(
      `SELECT c.id,c.title,c.body,c.status,c.created_at AS "createdAt",c.created_by AS "createdBy",
         count(r.*)::int AS total,
         count(r.*) FILTER (WHERE r.status='sent')::int AS sent,
         count(r.*) FILTER (WHERE r.status='failed')::int AS failed,
         count(r.*) FILTER (WHERE r.status='pending')::int AS pending
       FROM broadcast_campaigns c LEFT JOIN broadcast_recipients r ON r.campaign_id=c.id
       WHERE c.venue_id=$1 GROUP BY c.id ORDER BY c.created_at DESC LIMIT 100`,
      [v.id],
    )
  ).rows;
}

export async function broadcastRecipients(campaignId: string) {
  const rows = (
    await pool.query(
      `SELECT id,regular_id AS "regularId",name,phone,message,status,attempts,last_error AS "lastError",sent_at AS "sentAt"
       FROM broadcast_recipients WHERE campaign_id=$1 ORDER BY name`,
      [campaignId],
    )
  ).rows;
  return rows;
}

const markSchema = z
  .object({
    status: z.enum(["sent", "failed", "pending", "skipped"]),
    error: z.string().max(300).optional(),
  })
  .strict();

/** Staff marks a recipient by hand (until n8n sends automatically); the campaign closes when none are pending. */
export async function markRecipient(
  staffId: string,
  campaignId: string,
  recipientId: string,
  raw: unknown,
) {
  const input = markSchema.parse(raw);
  return transaction(async (client) => {
    const campaign = (
      await client.query("SELECT status FROM broadcast_campaigns WHERE id=$1 FOR UPDATE", [
        campaignId,
      ])
    ).rows[0];
    if (!campaign) throw new ApiError(404, "NOT_FOUND", "Рассылка не найдена");
    if (campaign.status === "cancelled") throw new ApiError(409, "CANCELLED", "Рассылка отменена");
    const row = (
      await client.query(
        `UPDATE broadcast_recipients SET status=$3,attempts=attempts+CASE WHEN $3='pending' THEN 0 ELSE 1 END,
           last_error=CASE WHEN $3='failed' THEN $4 ELSE NULL END,
           sent_at=CASE WHEN $3='sent' THEN now() ELSE NULL END,sent_by=CASE WHEN $3='sent' THEN $5 ELSE NULL END
         WHERE id=$1 AND campaign_id=$2 RETURNING id`,
        [recipientId, campaignId, input.status, input.error ?? null, `staff:${staffId}`],
      )
    ).rows[0];
    if (!row) throw new ApiError(404, "NOT_FOUND", "Получатель не найден");
    const pending = (
      await client.query(
        "SELECT count(*)::int AS n FROM broadcast_recipients WHERE campaign_id=$1 AND status='pending'",
        [campaignId],
      )
    ).rows[0].n;
    await client.query(
      `UPDATE broadcast_campaigns SET status=CASE WHEN $2=0 THEN 'done' ELSE 'queued' END,
         completed_at=CASE WHEN $2=0 THEN now() ELSE NULL END,updated_at=now() WHERE id=$1`,
      [campaignId, pending],
    );
    return { id: recipientId, pending };
  });
}

export async function cancelBroadcast(staffId: string, campaignId: string) {
  return transaction(async (client) => {
    const row = (
      await client.query(
        `UPDATE broadcast_campaigns SET status='cancelled',updated_at=now() WHERE id=$1 AND status='queued' RETURNING id`,
        [campaignId],
      )
    ).rows[0];
    if (!row) throw new ApiError(409, "NOT_CANCELLABLE", "Рассылку уже нельзя отменить");
    await client.query(
      "UPDATE broadcast_recipients SET status='skipped' WHERE campaign_id=$1 AND status='pending'",
      [campaignId],
    );
    await audit(client, staffId, "broadcast_cancelled", campaignId);
    return { id: campaignId };
  });
}
