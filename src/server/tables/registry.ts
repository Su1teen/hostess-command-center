import { z } from "zod";
import type { Pool, PoolClient } from "pg";
import { pool } from "../db/pool";
import { transaction, type Session } from "../guest/auth";
import { ApiError } from "../guest/security";
import { tableUrl } from "../dine-in/qr";

type Db = Pick<Pool | PoolClient, "query">;
const uuid = z.string().uuid();
const legacy = z.enum(["A1", "A2", "A3", "B1", "B2", "B3", "B4", "C1", "C2", "Bar"]);
export const registryInput = z
  .object({
    version: z.number().int().positive(),
    name: z.string().trim().min(1).max(100),
    zoneId: uuid,
    resourceType: z.enum(["table", "private_room", "bar_seating"]),
    capacity: z.number().int().min(1).max(200).nullable(),
    enabled: z.boolean(),
    bookable: z.boolean(),
    relationship: z.enum(["pending", "independent", "linked"]),
    linkedResourceId: uuid.nullable(),
    legacyCode: legacy.nullable(),
    verified: z.boolean(),
    verificationNote: z.string().trim().max(500),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.relationship === "linked" &&
      Number(!!value.linkedResourceId) + Number(!!value.legacyCode) !== 1
    )
      context.addIssue({
        code: "custom",
        message: "Выберите существующее место",
        path: ["linkedResourceId"],
      });
    if (value.relationship !== "linked" && (value.linkedResourceId || value.legacyCode))
      context.addIssue({
        code: "custom",
        message: "Уберите связь с существующим местом",
        path: ["relationship"],
      });
    if (value.relationship === "pending" && value.verified)
      context.addIssue({
        code: "custom",
        message: "Уточните физическое соответствие",
        path: ["relationship"],
      });
    if (value.relationship === "linked" && !value.verified)
      context.addIssue({
        code: "custom",
        message: "Подтвердите физическое соответствие выбранному месту",
        path: ["verified"],
      });
    if (value.verified && value.verificationNote.length < 3)
      context.addIssue({
        code: "custom",
        message: "Укажите основание проверки (не менее 3 символов)",
        path: ["verificationNote"],
      });
  });
export const bulkInput = z
  .object({
    changes: z
      .array(
        z
          .object({
            resourceId: uuid,
            version: z.number().int().positive(),
            name: z.string().trim().min(1).max(100).optional(),
            zoneId: uuid.optional(),
          })
          .strict()
          .refine((v) => v.name !== undefined || v.zoneId !== undefined),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .refine(
    (v) => new Set(v.changes.map((c) => c.resourceId)).size === v.changes.length,
    "Точка повторяется",
  );

export async function listRegistry(venueId: string, db: Db = pool) {
  const result = await db.query(
    `SELECT q.id,q.resource_id AS "resourceId",q.token,q.enabled,q.generation,
    q.issued_at AS "issuedAt",q.rotated_at AS "rotatedAt",r.code,r.name,r.zone_id AS "zoneId",z.name AS "zoneName",z.code AS "zoneCode",
    r.resource_type AS "resourceType",r.capacity,r.registry_version AS version,
    m.legacy_code AS "legacyCode",COALESCE(m.relationship,'pending') AS relationship,
    m.linked_resource_id AS "linkedResourceId",target.name AS "linkedResourceName",target.code AS "linkedResourceCode",
    m.note AS "verificationNote",m.verified_at AS "verifiedAt",(m.verified_at IS NOT NULL) AS "mappingVerified",
    CASE WHEN m.verified_at IS NOT NULL AND m.linked_resource_id IS NOT NULL THEN target.is_reservable ELSE r.is_reservable END AS bookable,
    CASE WHEN
      CASE WHEN m.linked_resource_id IS NOT NULL THEN target.is_reservable AND target.status='active' AND target_zone.is_active
      ELSE r.is_reservable AND r.status='active' AND z.is_active END THEN 'available' ELSE 'unavailable' END AS "bookingState"
    FROM table_qr_codes q JOIN venue_resources r ON r.id=q.resource_id JOIN venue_zones z ON z.id=r.zone_id
    LEFT JOIN venue_resource_mappings m ON m.resource_id=r.id LEFT JOIN venue_resources target ON target.id=m.linked_resource_id
    LEFT JOIN venue_zones target_zone ON target_zone.id=target.zone_id
    WHERE q.venue_id=$1 ORDER BY r.code`,
    [venueId],
  );
  return result.rows.map((table) => ({ ...table, url: tableUrl(table.code, table.token) }));
}
export function registryDistribution(tables: { zoneCode: string }[]) {
  const expected = [
    { code: "first_hall", name: "Первый зал", count: 8 },
    { code: "second_hall", name: "Второй зал", count: 3 },
    { code: "ps", name: "ПС", count: 3 },
    { code: "vip", name: "VIP", count: 3 },
  ];
  return {
    matchesExpected:
      expected.every(
        (zone) => tables.filter((table) => table.zoneCode === zone.code).length === zone.count,
      ) && tables.length === expected.reduce((sum, zone) => sum + zone.count, 0),
    expectedLabel: expected.map((zone) => `${zone.name} — ${zone.count}`).join("; "),
  };
}

export async function bookingTargets(venueId: string) {
  const targets = (
    await pool.query(
      `SELECT r.id,r.code,r.name,r.resource_type AS "resourceType",r.capacity,r.is_reservable AS bookable,z.name AS "zoneName",
    m.resource_id AS "linkedFromResourceId" FROM venue_resources r JOIN venue_zones z ON z.id=r.zone_id
    LEFT JOIN venue_resource_mappings m ON m.linked_resource_id=r.id
    WHERE r.venue_id=$1 AND NOT EXISTS(SELECT 1 FROM table_qr_codes q WHERE q.resource_id=r.id) ORDER BY z.display_order,r.code`,
      [venueId],
    )
  ).rows;
  const historical = (
    await pool.query(
      `SELECT code,m.resource_id AS "linkedFromResourceId"
    FROM unnest(ARRAY['A1','A2','A3','B1','B2','B3','B4','C1','C2','Bar']) t(code)
    LEFT JOIN venue_resource_mappings m ON m.venue_id=$1 AND m.legacy_code=t.code`,
      [venueId],
    )
  ).rows.map((row) => ({
    id: `legacy:${row.code}`,
    code: row.code,
    name:
      row.code === "Bar"
        ? "Барная посадка (историческая запись)"
        : `Посадочное место ${row.code} (историческая запись)`,
    resourceType: row.code === "Bar" ? "bar_seating" : "table",
    capacity: ["A1", "A2", "A3", "Bar"].includes(row.code) ? 6 : 4,
    zoneName: "Расположение требует проверки",
    linkedFromResourceId: row.linkedFromResourceId,
    bookable: false,
  }));
  return [...targets, ...historical];
}
async function audit(
  client: PoolClient,
  staff: Session,
  action: string,
  id: string,
  details: unknown,
) {
  await client.query(
    "INSERT INTO hostess_audit(actor,action,entity_id,details) VALUES($1,$2,$3,$4)",
    [`staff:${staff.staff_id}`, action, id, JSON.stringify(details)],
  );
}
async function lockTable(client: PoolClient, venueId: string, id: string, version: number) {
  const row = (
    await client.query(
      `SELECT r.*,m.relationship,m.legacy_code,m.linked_resource_id,m.verified_at,m.note
    FROM venue_resources r JOIN table_qr_codes q ON q.resource_id=r.id LEFT JOIN venue_resource_mappings m ON m.resource_id=r.id
    WHERE r.id=$1 AND q.venue_id=$2 FOR UPDATE OF r,q`,
      [id, venueId],
    )
  ).rows[0];
  if (!row) throw new ApiError(404, "NOT_FOUND", "Точка обслуживания не найдена");
  if (row.registry_version !== version)
    throw new ApiError(
      409,
      "STALE_VERSION",
      "Другой сотрудник изменил эту точку. Обновите данные и повторите изменения",
    );
  return row;
}
async function validZone(client: PoolClient, venueId: string, zoneId: string) {
  if (
    !(
      await client.query(
        `SELECT z.id FROM venue_zones z JOIN hostess_venues v ON v.slug=z.venue_code
    WHERE z.id=$1 AND v.id=$2 AND z.is_active AND z.code<>'qr_unassigned'`,
        [zoneId, venueId],
      )
    ).rowCount
  )
    throw new ApiError(422, "INVALID_ZONE", "Выберите действующую зону заведения");
}

export async function saveRegistry(venueId: string, id: string, raw: unknown, staff: Session) {
  if (staff.role !== "manager")
    throw new ApiError(403, "FORBIDDEN", "Управлять инвентарём может менеджер");
  const parsed = registryInput.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const labels: Record<string, string> = {
      name: "Название",
      zoneId: "Зона",
      resourceType: "Тип точки",
      capacity: "Вместимость",
      verificationNote: "Основание проверки",
      version: "Версия записи",
    };
    throw new ApiError(
      422,
      "INVALID_INPUT",
      issue.code === "custom"
        ? issue.message
        : `Проверьте поле «${labels[String(issue.path[0])] ?? "Настройки"}»: значение отсутствует или выходит за допустимые пределы`,
    );
  }
  const input = parsed.data;
  await transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(728411001)");
    const previous = await lockTable(client, venueId, id, input.version);
    await validZone(client, venueId, input.zoneId);
    if (input.legacyCode && input.verified) {
      const confirmedCapacity = ["A1", "A2", "A3", "Bar"].includes(input.legacyCode) ? 6 : 4;
      if (input.capacity !== confirmedCapacity)
        throw new ApiError(
          422,
          "TARGET_MISMATCH",
          `Вместимость существующего места: ${confirmedCapacity}. Уточните соответствие до изменения инвентаря`,
        );
    }
    if (input.linkedResourceId) {
      const target = (
        await client.query(
          `SELECT r.* FROM venue_resources r WHERE r.id=$1 AND r.venue_id=$2
        AND NOT EXISTS(SELECT 1 FROM table_qr_codes WHERE resource_id=r.id) FOR UPDATE`,
          [input.linkedResourceId, venueId],
        )
      ).rows[0];
      if (!target)
        throw new ApiError(
          422,
          "INVALID_TARGET",
          "Выберите существующее бронируемое место этого заведения",
        );
      if (
        input.verified &&
        (target.zone_id !== input.zoneId ||
          target.capacity !== input.capacity ||
          target.resource_type !== input.resourceType)
      )
        throw new ApiError(
          422,
          "TARGET_MISMATCH",
          "Для одного физического места должны совпадать зона, тип и вместимость. Используйте параметры выбранного места",
        );
    }
    // Disable the QR booking row before changing its physical relationship; all steps share a transaction.
    await client.query("UPDATE venue_resources SET is_reservable=false WHERE id=$1", [id]);
    await client.query(
      `INSERT INTO venue_resource_mappings(resource_id,venue_id,relationship,linked_resource_id,legacy_code,verified_at,verified_by,note)
      VALUES($1,$2,$3,$4,$5,CASE WHEN $6 THEN now() END,CASE WHEN $6 THEN $7 END,$8)
      ON CONFLICT(resource_id) DO UPDATE SET relationship=EXCLUDED.relationship,linked_resource_id=EXCLUDED.linked_resource_id,
      legacy_code=EXCLUDED.legacy_code,verified_at=CASE WHEN EXCLUDED.verified_at IS NULL THEN NULL
      WHEN (venue_resource_mappings.relationship,venue_resource_mappings.linked_resource_id,venue_resource_mappings.legacy_code)
        IS DISTINCT FROM (EXCLUDED.relationship,EXCLUDED.linked_resource_id,EXCLUDED.legacy_code) THEN EXCLUDED.verified_at
      ELSE COALESCE(venue_resource_mappings.verified_at,EXCLUDED.verified_at) END,
      verified_by=EXCLUDED.verified_by,note=EXCLUDED.note`,
      [
        id,
        venueId,
        input.relationship,
        input.linkedResourceId,
        input.legacyCode,
        input.verified,
        staff.staff_id,
        input.verificationNote,
      ],
    );
    if (input.verified && input.linkedResourceId)
      await client.query(
        "UPDATE venue_resources SET is_reservable=$2,updated_at=now(),registry_version=registry_version+1 WHERE id=$1",
        [input.linkedResourceId, input.bookable],
      );
    await client.query(
      `UPDATE venue_resources SET name=$2,zone_id=$3,resource_type=$4,capacity=$5,is_reservable=$6,
      updated_at=now(),registry_version=registry_version+1,metadata=metadata||jsonb_build_object('physical_position_verified',$7::boolean) WHERE id=$1`,
      [
        id,
        input.name,
        input.zoneId,
        input.resourceType,
        input.capacity,
        input.bookable && !input.linkedResourceId,
        input.verified,
      ],
    );
    await client.query(
      "UPDATE table_qr_codes SET enabled=$2 WHERE resource_id=$1 AND venue_id=$3",
      [id, input.enabled, venueId],
    );
    await audit(client, staff, "physical_table_updated", id, {
      before: {
        name: previous.name,
        zoneId: previous.zone_id,
        capacity: previous.capacity,
        relationship: previous.relationship,
        linkedResourceId: previous.linked_resource_id,
        legacyCode: previous.legacy_code,
      },
      after: input,
    });
  });
  return { tables: await listRegistry(venueId) };
}
export async function bulkRegistry(venueId: string, raw: unknown, staff: Session) {
  if (staff.role !== "manager")
    throw new ApiError(403, "FORBIDDEN", "Управлять инвентарём может менеджер");
  const input = bulkInput.parse(raw);
  await transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(728411001)");
    for (const change of [...input.changes].sort((a, b) =>
      a.resourceId.localeCompare(b.resourceId),
    )) {
      const before = await lockTable(client, venueId, change.resourceId, change.version);
      if (change.zoneId) {
        await validZone(client, venueId, change.zoneId);
        if (before.verified_at && before.linked_resource_id && change.zoneId !== before.zone_id)
          throw new ApiError(
            422,
            "LINKED_ZONE",
            "Зону связанного места меняйте в его карточке после проверки соответствия",
          );
      }
      await client.query(
        `UPDATE venue_resources SET name=COALESCE($2,name),zone_id=COALESCE($3,zone_id),updated_at=now(),registry_version=registry_version+1 WHERE id=$1`,
        [change.resourceId, change.name ?? null, change.zoneId ?? null],
      );
      await audit(client, staff, "physical_table_bulk_updated", change.resourceId, {
        before: { name: before.name, zoneId: before.zone_id },
        after: change,
      });
    }
  });
  return { tables: await listRegistry(venueId) };
}
export async function registryHistory(venueId: string, id: string) {
  if (
    !(
      await pool.query("SELECT id FROM table_qr_codes WHERE venue_id=$1 AND resource_id=$2", [
        venueId,
        id,
      ])
    ).rowCount
  )
    throw new ApiError(404, "NOT_FOUND", "Точка обслуживания не найдена");
  return (
    await pool.query(
      `SELECT action,actor,details,created_at AS "createdAt" FROM hostess_audit
    WHERE entity_id=$1 AND action IN('physical_table_updated','physical_table_bulk_updated','physical_mapping_updated','qr_updated','qr_rotated')
    ORDER BY created_at DESC,id DESC LIMIT 50`,
      [id],
    )
  ).rows;
}
