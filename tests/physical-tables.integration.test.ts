import { beforeAll, afterAll, test } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { pool } from "../src/server/db/pool";
import { transaction, newSession, type Session } from "../src/server/guest/auth";
import {
  listRegistry,
  saveRegistry,
  bulkRegistry,
  bookingTargets,
  registryHistory,
} from "../src/server/tables/registry";
import { handleBookingApi } from "../src/server/guest/api";
import { listVenueAvailability } from "../src/server/guest/inventory";
import type { QrTable } from "../src/lib/dine-in-client";

if (
  !process.env.TEST_PHYSICAL_DATABASE_URL?.includes("127.0.0.1") ||
  process.env.DATABASE_URL !== process.env.TEST_PHYSICAL_DATABASE_URL
)
  throw new Error("Isolated local PostgreSQL required");
const manager: Session = { staff_id: "registry-manager", role: "manager", guest_id: null };
let venueId: string, before: unknown[], unrelatedBooking: string;
let zones: Record<string, string> = {};
const cookies: Record<string, string> = {};
const migrations = new URL("../src/server/db/migrations/", import.meta.url);
async function snapshot() {
  return (
    await pool.query(
      `SELECT r.id,r.code,r.zone_id,q.token,q.generation FROM table_qr_codes q JOIN venue_resources r ON r.id=q.resource_id ORDER BY r.code`,
    )
  ).rows;
}
async function table(code: string) {
  return (await listRegistry(venueId)).find((r) => r.code === code)!;
}
function input(t: QrTable, extra = {}) {
  return {
    version: t.version,
    name: t.name,
    zoneId: t.zoneId,
    resourceType: t.resourceType,
    capacity: t.capacity,
    enabled: t.enabled,
    bookable: t.bookable,
    relationship: t.relationship,
    linkedResourceId: t.linkedResourceId,
    legacyCode: t.legacyCode,
    verified: t.mappingVerified,
    verificationNote: t.verificationNote,
    ...extra,
  };
}
async function booking(code: string, resourceId: string | null = null, offset = 20, guests = 2) {
  return transaction(async (client) => {
    const row = (
      await client.query(
        `INSERT INTO command_center_reservations(guest_name,phone,guests,starts_at,ends_at,table_id,table_ids)
      VALUES('Registry fixture','+77010000000',$2,now()+$3*interval '1 day',now()+$3*interval '1 day'+interval '2 hours',$1,ARRAY[$1]) RETURNING id`,
        [code, guests, offset],
      )
    ).rows[0];
    if (resourceId)
      await client.query(
        "INSERT INTO command_center_reservation_resources(reservation_id,resource_id) VALUES($1,$2)",
        [row.id, resourceId],
      );
    return row.id;
  });
}
async function api(path: string, role?: string, data?: unknown, method = data ? "PATCH" : "GET") {
  return (await handleBookingApi(
    new Request(`https://command.test/api/staff/v1${path}`, {
      method,
      headers: {
        ...(role ? { cookie: cookies[role] } : {}),
        ...(data ? { "content-type": "application/json", origin: "https://command.test" } : {}),
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    }),
  ))!;
}
beforeAll(async () => {
  for (const file of readdirSync(migrations)
    .filter((f) => f.endsWith(".sql") && Number(f.slice(0, 4)) <= 7)
    .sort())
    await pool.query(readFileSync(new URL(file, migrations), "utf8"));
  venueId = (await pool.query("SELECT id FROM hostess_venues WHERE slug='xoxo'")).rows[0].id;
  zones = Object.fromEntries(
    (await pool.query("SELECT code,id FROM venue_zones WHERE venue_code='xoxo'")).rows.map((z) => [
      z.code,
      z.id,
    ]),
  );
  // Deliberately non-sequential physical placement: migration must preserve it verbatim.
  const groups = {
    first_hall: ["01", "03", "04", "07", "08", "11", "13", "17"],
    second_hall: ["02", "06", "12"],
    ps: ["05", "10", "16"],
    vip: ["09", "14", "15"],
  };
  for (const [zone, codes] of Object.entries(groups))
    await pool.query("UPDATE venue_resources SET zone_id=$1 WHERE code=ANY($2::text[])", [
      zones[zone],
      codes,
    ]);
  const vip = (await pool.query("SELECT id FROM venue_resources WHERE code='VIP3'")).rows[0];
  unrelatedBooking = await booking("VIP3", vip.id, 25);
  before = await snapshot();
  await pool.query(readFileSync(new URL("0008_physical_table_registry.sql", migrations), "utf8"));
  for (const file of readdirSync(migrations)
    .filter((f) => f.endsWith(".sql") && Number(f.slice(0, 4)) > 8)
    .sort())
    await pool.query(readFileSync(new URL(file, migrations), "utf8"));
  for (const role of ["manager", "operator", "viewer"])
    cookies[role] = (await transaction((c) => newSession(c, null, `registry-${role}`, role))).split(
      ";",
    )[0];
});
afterAll(async () => {
  await pool.end();
});

test("additive migration and repeated bootstrap preserve all 17 IDs, tokens and real zone assignments", async () => {
  assert.deepEqual(await snapshot(), before);
  await pool.query("SELECT hostess_bootstrap_qr()");
  await pool.query("SELECT hostess_bootstrap_qr()");
  assert.deepEqual(await snapshot(), before);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM venue_resources")).rows[0].n, 20);
  assert.equal(
    (await pool.query("SELECT count(*)::int AS n FROM venue_resource_mappings")).rows[0].n,
    17,
  );
  const counts = (
    await pool.query(
      `SELECT z.code,count(*)::int AS n FROM table_qr_codes q JOIN venue_resources r ON r.id=q.resource_id JOIN venue_zones z ON z.id=r.zone_id GROUP BY z.code ORDER BY z.code`,
    )
  ).rows;
  assert.deepEqual(counts, [
    { code: "first_hall", n: 8 },
    { code: "ps", n: 3 },
    { code: "second_hall", n: 3 },
    { code: "vip", n: 3 },
  ]);
});

test("atomic registry save keeps QR active independently and records audit without changing URL", async () => {
  const t = await table("01");
  const result = await saveRegistry(
    venueId,
    t.resourceId,
    input(t, { name: "У окна", zoneId: zones.second_hall }),
    manager,
  );
  const saved = result.tables.find((r) => r.resourceId === t.resourceId)!;
  assert.equal(saved.url, t.url);
  assert.equal(saved.enabled, true);
  assert.equal(saved.bookable, false);
  assert.equal(saved.name, "У окна");
  assert.equal(saved.zoneId, zones.second_hall);
  assert.equal(saved.version, t.version + 1);
  assert.equal((await registryHistory(venueId, t.resourceId))[0].action, "physical_table_updated");
  await assert.rejects(
    saveRegistry(venueId, t.resourceId, input(t, { name: "Lost update" }), manager),
    { code: "STALE_VERSION" },
  );
  await saveRegistry(
    venueId,
    saved.resourceId,
    input(saved, { name: t.name, zoneId: t.zoneId }),
    manager,
  );
});

test("unconfirmed booking/capacity and cross-venue target validation roll back every edited field", async () => {
  const t = await table("02");
  await assert.rejects(
    saveRegistry(
      venueId,
      t.resourceId,
      input(t, { name: "Must not save", enabled: false, bookable: true }),
      manager,
    ),
  );
  const unchanged = await table("02");
  assert.equal(unchanged.name, t.name);
  assert.equal(unchanged.enabled, t.enabled);
  assert.equal(unchanged.version, t.version);
  await assert.rejects(
    saveRegistry(
      venueId,
      t.resourceId,
      input(t, {
        relationship: "independent",
        verified: true,
        verificationNote: "Owner survey",
        capacity: 0,
      }),
      manager,
    ),
  );
  assert.equal((await table("02")).capacity, null);
});

test("unrelated future VIP occupancy does not block confirmation of a separate physical table", async () => {
  const t = await table("03");
  await saveRegistry(
    venueId,
    t.resourceId,
    input(t, {
      relationship: "independent",
      verified: true,
      verificationNote: "Owner inspected separate position",
      capacity: 4,
      bookable: true,
    }),
    manager,
  );
  const saved = await table("03");
  assert.equal(saved.bookable, true);
  assert.equal(saved.mappingVerified, true);
  await assert.rejects(
    pool.query("UPDATE venue_resources SET capacity=0 WHERE id=$1", [t.resourceId]),
    { code: "23514" },
  );
});

test("confirmed VIP mapping uses original booking room and one capacity with alias conflicts", async () => {
  const t = await table("09"),
    vip = (await pool.query("SELECT * FROM venue_resources WHERE code='VIP1'")).rows[0];
  const targets = await bookingTargets(venueId);
  assert.ok(targets.some((r) => r.id === vip.id));
  await saveRegistry(
    venueId,
    t.resourceId,
    input(t, {
      relationship: "linked",
      linkedResourceId: vip.id,
      zoneId: vip.zone_id,
      resourceType: "private_room",
      capacity: 6,
      verified: true,
      verificationNote: "Owner physically confirmed same VIP room",
      bookable: true,
    }),
    manager,
  );
  const saved = await table("09");
  assert.equal(saved.linkedResourceId, vip.id);
  assert.equal(saved.bookable, true);
  await pool.query("SELECT hostess_bootstrap_qr()");
  assert.equal((await table("09")).resourceType, "private_room");
  assert.equal(
    (await pool.query("SELECT is_reservable FROM venue_resources WHERE id=$1", [saved.resourceId]))
      .rows[0].is_reservable,
    false,
  );
  assert.equal(
    (await pool.query("SELECT hostess_inventory_conflicts(ARRAY['VIP1'],ARRAY['09']) AS conflict"))
      .rows[0].conflict,
    true,
  );
  const id = await booking("VIP1", vip.id);
  const interval = (
    await pool.query("SELECT starts_at,ends_at FROM command_center_reservations WHERE id=$1", [id])
  ).rows[0];
  const availability = await listVenueAvailability(
    pool,
    interval.starts_at.toISOString(),
    interval.ends_at.toISOString(),
    2,
    null,
  );
  assert.equal(availability.resources.find((r) => r.id === vip.id)!.available, false);
  assert.equal(availability.resources.find((r) => r.id === saved.resourceId)!.bookable, false);
  await assert.rejects(
    saveRegistry(
      venueId,
      saved.resourceId,
      input(saved, {
        relationship: "pending",
        linkedResourceId: null,
        verified: false,
        bookable: false,
      }),
      manager,
    ),
    { code: "23P01" },
  );
  const note = await saveRegistry(
    venueId,
    saved.resourceId,
    input(saved, { verificationNote: "Same physical place, updated note" }),
    manager,
  );
  assert.equal(note.tables.find((r) => r.resourceId === t.resourceId)!.linkedResourceId, vip.id);
  await assert.rejects(
    pool.query("UPDATE venue_resources SET capacity=3 WHERE id=$1", [t.resourceId]),
    { code: "23514" },
  );
  await pool.query("UPDATE command_center_reservations SET status='cancelled' WHERE id=$1", [id]);
});

test("affected legacy alias blocks remapping, duplicate VIP mapping rolls back QR settings", async () => {
  const existing = await booking("A1", null, 27);
  const t = await table("04");
  await assert.rejects(
    saveRegistry(
      venueId,
      t.resourceId,
      input(t, {
        relationship: "linked",
        legacyCode: "A1",
        capacity: 6,
        verified: true,
        verificationNote: "Physical alias survey",
        bookable: true,
      }),
      manager,
    ),
    { code: "23P01" },
  );
  await pool.query("UPDATE command_center_reservations SET status='cancelled' WHERE id=$1", [
    existing,
  ]);
  await saveRegistry(
    venueId,
    t.resourceId,
    input(t, {
      relationship: "linked",
      legacyCode: "A1",
      capacity: 6,
      verified: true,
      verificationNote: "Physical alias survey",
      bookable: true,
    }),
    manager,
  );
  const alias = await table("04");
  const results = await Promise.allSettled([
    booking("A1", null, 29),
    booking("04", alias.resourceId, 29),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  for (const result of results)
    if (result.status === "fulfilled")
      await pool.query("UPDATE command_center_reservations SET status='cancelled' WHERE id=$1", [
        result.value,
      ]);
  const vip = (await pool.query("SELECT * FROM venue_resources WHERE code='VIP1'")).rows[0],
    other = await table("14");
  await assert.rejects(
    saveRegistry(
      venueId,
      other.resourceId,
      input(other, {
        enabled: false,
        relationship: "linked",
        linkedResourceId: vip.id,
        zoneId: vip.zone_id,
        resourceType: "private_room",
        capacity: 6,
        verified: true,
        verificationNote: "Duplicate must reject",
      }),
      manager,
    ),
    { code: "23505" },
  );
  assert.equal((await table("14")).enabled, true);
  assert.equal((await table("14")).mappingVerified, false);
});

test("bulk operations are atomic under concurrent changes and preserve all tokens", async () => {
  const a = await table("05"),
    b = await table("06");
  await assert.rejects(
    bulkRegistry(
      venueId,
      {
        changes: [
          { resourceId: a.resourceId, version: a.version, name: "Rolled back" },
          { resourceId: b.resourceId, version: b.version + 1, name: "Stale" },
        ],
      },
      manager,
    ),
    { code: "STALE_VERSION" },
  );
  assert.equal((await table("05")).name, a.name);
  await bulkRegistry(
    venueId,
    {
      changes: [
        { resourceId: a.resourceId, version: a.version, name: "ПС у окна" },
        { resourceId: b.resourceId, version: b.version, zoneId: zones.ps },
      ],
    },
    manager,
  );
  assert.equal((await table("05")).name, "ПС у окна");
  assert.equal((await table("06")).zoneId, zones.ps);
  assert.equal((await table("05")).url, a.url);
  assert.equal((await table("06")).url, b.url);
});

test("an open QR visit blocks physical remapping until the visit has ended", async () => {
  const t = await table("08");
  const visit = (
    await pool.query(
      "INSERT INTO dining_sessions(venue_id,resource_id) VALUES($1,$2) RETURNING id",
      [venueId, t.resourceId],
    )
  ).rows[0];
  await assert.rejects(
    saveRegistry(
      venueId,
      t.resourceId,
      input(t, {
        relationship: "independent",
        verified: true,
        verificationNote: "Checked in venue",
        capacity: 4,
      }),
      manager,
    ),
    { code: "23P01" },
  );
  assert.equal((await table("08")).mappingVerified, false);
  await pool.query(
    "UPDATE dining_sessions SET closed_at=now(),visit_status='released' WHERE id=$1",
    [visit.id],
  );
  await saveRegistry(
    venueId,
    t.resourceId,
    input(t, {
      relationship: "independent",
      verified: true,
      verificationNote: "Checked in venue",
      capacity: 4,
    }),
    manager,
  );
  assert.equal((await table("08")).mappingVerified, true);
});

test("manager boundaries, CSRF and private QR manifest remain enforced", async () => {
  const t = await table("07");
  assert.equal((await api("/tables/qr")).status, 401);
  assert.equal((await api(`/tables/${t.resourceId}/registry`, "operator", input(t))).status, 403);
  assert.equal(
    (
      await api(
        "/tables/qr/bulk",
        "operator",
        { changes: [{ resourceId: t.resourceId, version: t.version, name: "Forbidden" }] },
        "POST",
      )
    ).status,
    403,
  );
  assert.equal((await api("/tables/qr", "viewer")).status, 200);
  const guest = await handleBookingApi(
    new Request("https://command.test/api/guest/v1/tables/qr", {
      headers: { "x-hostess-service-key": process.env.HOSTESS_BFF_KEY! },
    }),
  );
  assert.equal(guest?.status, 404);
  await assert.rejects(
    saveRegistry(venueId, t.resourceId, input(t), { ...manager, role: "operator" }),
    { status: 403 },
  );
});

test("selected-zone print and ZIP include only requested tables, correct zone and permanent public origin", async () => {
  const t = await table("01");
  const print = await api(`/tables/qr/print?ids=${t.resourceId}`, "viewer"),
    html = await print.text();
  assert.equal(print.status, 200);
  assert.equal((html.match(/class="panel"/g) ?? []).length, 1);
  assert.ok(html.includes(t.zoneName));
  assert.ok(!html.includes("resourceId"));
  assert.ok(!html.includes("Оплата официанту"));
  const zip = await api(`/tables/qr/export.zip?ids=${t.resourceId}`, "viewer");
  assert.equal(zip.status, 200);
  assert.ok(zip.headers.get("content-disposition")?.includes("xoxo-1-qr.zip"));
  const data = Buffer.from(await zip.arrayBuffer()).toString("utf8");
  assert.ok(data.includes("https://hostes.online/v/xoxo/t/01/"));
  assert.equal((await table("01")).url, t.url);
  assert.equal((await api("/tables/qr/print?ids=", "viewer")).status, 422);
  await pool.query("UPDATE command_center_reservations SET status='cancelled' WHERE id=$1", [
    unrelatedBooking,
  ]);
});
