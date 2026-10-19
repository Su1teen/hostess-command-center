import { beforeAll, afterAll, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { pool } from "../src/server/db/pool";
import { transaction, newSession } from "../src/server/guest/auth";
import { randomToken, hash } from "../src/server/guest/security";
import { handleBookingApi } from "../src/server/guest/api";
import { checkout, createQuote, changeStatus } from "../src/server/dine-in/service";
import {
  floorSnapshot,
  operationalDay,
  seatGuests,
  releaseGuests,
  createFloorReservation,
  updateFloorReservation,
  sessionFolio,
  saveFloorLayout,
} from "../src/server/floor/service";
import { listVenueAvailability, selectReservableResource } from "../src/server/guest/inventory";
import { occupancySignals } from "../src/server/dine-in/menu";

if (
  !process.env.TEST_FLOOR_DATABASE_URL?.includes("127.0.0.1") ||
  process.env.DATABASE_URL !== process.env.TEST_FLOOR_DATABASE_URL
)
  throw new Error("Isolated local PostgreSQL required");
let venueId: string;
let tables: { resource_id: string; token: string; zone_id: string; code: string }[] = [];
const staff: Record<string, string> = {},
  originalFetch = globalThis.fetch,
  productId = randomUUID(),
  roundId = randomUUID();
const future = (minutes: number) => new Date(Date.now() + minutes * 60000).toISOString();
const owner = () => ({ guestId: null, hash: hash(randomToken()) });
async function submit(resourceIndex: number, customer = owner()) {
  const quote = await createQuote(customer, {
    qrToken: tables[resourceIndex].token,
    items: [{ productId, quantity: 2 }],
    redeemMinor: 0,
  });
  return checkout(customer, { quoteId: quote.id, idempotencyKey: randomToken() });
}
async function api(path: string, role?: string, body?: unknown, method?: string) {
  return (await handleBookingApi(
    new Request("https://command.test/api/staff/v1/floor" + path, {
      method: method ?? (body ? "POST" : "GET"),
      headers: {
        ...(role ? { cookie: staff[role] } : {}),
        ...(body ? { "content-type": "application/json", origin: "https://command.test" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  ))!;
}
beforeAll(async () => {
  const dir = new URL("../src/server/db/migrations/", import.meta.url);
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await pool.query(readFileSync(new URL(file, dir), "utf8"));
  venueId = (await pool.query("SELECT id FROM hostess_venues WHERE slug='xoxo'")).rows[0].id;
  tables = (
    await pool.query(
      "SELECT q.*,r.zone_id,r.code FROM table_qr_codes q JOIN venue_resources r ON r.id=q.resource_id ORDER BY r.code",
    )
  ).rows;
  // Explicit fixture survey, never production or ordinal zone assignments.
  await pool.query(
    "UPDATE venue_resource_mappings SET relationship='independent',verified_at=now(),verified_by='fixture',note='Isolated fixture survey'",
  );
  await pool.query(
    "UPDATE venue_resources r SET capacity=6,is_reservable=true WHERE EXISTS(SELECT 1 FROM table_qr_codes q WHERE q.resource_id=r.id)",
  );
  for (const role of ["viewer", "operator", "manager"])
    staff[role] = (await transaction((c) => newSession(c, null, role, role))).split(";")[0];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith("/api/v1/public/snapshot"))
      return Response.json({
        status: "ok",
        generatedAt: new Date().toISOString(),
        currentRound: { id: roundId, endsAt: future(60) },
        products: [
          {
            id: productId,
            name: "Historical price",
            price: 1590,
            currency: "KZT",
            isAvailable: true,
          },
        ],
      });
    return originalFetch(input, init);
  }) as typeof fetch;
});
afterAll(async () => {
  globalThis.fetch = originalFetch;
  await pool.end();
});

test("operational day is Almaty 17:00–04:00 and midnight belongs to previous operation", () => {
  expect(operationalDay(undefined, new Date("2035-10-18T00:30:00+05:00"))).toEqual({
    date: "2035-10-17",
    startsAt: "2035-10-17T12:00:00.000Z",
    endsAt: "2035-10-17T23:00:00.000Z",
  });
  expect(operationalDay("2035-10-18").startsAt).toBe("2035-10-18T12:00:00.000Z");
});

test("occupancy counts confirmed seating only, never QR activity or unknown coverage", async () => {
  const unknown = (await occupancySignals(["not-connected"])).signals[0];
  expect(unknown).toMatchObject({ valuePercent: null, level: "unknown", source: "unavailable" });
  const before = (await occupancySignals(["xoxo"])).signals[0];
  expect(before).toMatchObject({
    valuePercent: 0,
    capacity: 17,
    occupiedUnits: 0,
    source: "staff_confirmed",
  });
  await submit(16);
  expect((await occupancySignals(["xoxo"])).signals[0].occupiedUnits).toBe(0);
  const seated = await seatGuests(venueId, "operator", {
    resourceId: tables[16].resource_id,
    guests: 2,
    expectedEndAt: future(60),
    idempotencyKey: randomToken(),
  });
  expect((await occupancySignals(["xoxo"])).signals[0]).toMatchObject({
    valuePercent: 6,
    capacity: 17,
    occupiedUnits: 1,
  });
  await releaseGuests(venueId, "operator", seated.session.id, {
    version: seated.session.version,
    reason: "Occupancy fixture finished",
    idempotencyKey: randomToken(),
  });
  expect((await occupancySignals(["xoxo"])).signals[0].occupiedUnits).toBe(0);
});

test("staff RBAC, origin protection and no public folio capability", async () => {
  expect((await api("")).status).toBe(401);
  expect((await api("", "viewer")).status).toBe(200);
  const input = {
    resourceId: tables[0].resource_id,
    guests: 2,
    expectedEndAt: future(60),
    idempotencyKey: randomToken(),
  };
  expect((await api("/seat", "viewer", input)).status).toBe(403);
  expect(
    (
      await api("/reservations", "operator", {
        resourceId: tables[0].resource_id,
        guestName: "No permission",
        guests: 2,
        startsAt: future(1440),
        endsAt: future(1500),
        source: "manual",
        idempotencyKey: randomToken(),
      })
    ).status,
  ).toBe(201);
  await pool.query(
    "UPDATE command_center_reservations SET status='cancelled' WHERE guest_name='No permission'",
  );
  const forged = await handleBookingApi(
    new Request("https://command.test/api/staff/v1/floor/seat", {
      method: "POST",
      headers: {
        cookie: staff.operator,
        "content-type": "application/json",
        origin: "https://evil.test",
      },
      body: JSON.stringify(input),
    }),
  );
  expect(forged?.status).toBe(403);
});

test("concurrent seating is atomic, retries replay, terminal orders retain confirmed presence and folio separates visits", async () => {
  const resourceId = tables[0].resource_id,
    seat = { resourceId, guests: 4, expectedEndAt: future(90), idempotencyKey: randomToken() };
  const parallel = await Promise.allSettled([
    seatGuests(venueId, "operator", seat),
    seatGuests(venueId, "manager", { ...seat, idempotencyKey: randomToken() }),
  ]);
  expect(parallel.filter((r) => r.status === "fulfilled").length).toBe(1);
  const active = (
    parallel.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<
      Awaited<ReturnType<typeof seatGuests>>
    >
  ).value.session;
  const winningStaff = (
    await pool.query("SELECT seated_by FROM dining_sessions WHERE id=$1", [active.id])
  ).rows[0].seated_by;
  const winningInput = winningStaff === "operator" ? seat : null;
  if (winningInput)
    expect((await seatGuests(venueId, winningStaff, winningInput)).session.id).toBe(active.id);
  const a = await submit(0),
    b = await submit(0);
  await changeStatus(a.order.id, venueId, "manager", undefined, "Fixture cancellation");
  for (const status of ["accepted", "preparing", "delivered", "closed"] as const)
    await changeStatus(b.order.id, venueId, "manager", status);
  const current = (await floorSnapshot(venueId, {})).zones
    .flatMap((z) => z.resources)
    .find((r) => r.id === resourceId)!;
  expect(current.state).toBe("seated");
  expect(current.currentSession?.orderCount).toBe(2);
  expect(current.currentSession?.activeOrderCount).toBe(0);
  const folio = await sessionFolio(venueId, active.id);
  expect(folio.session.guestName).toBeNull();
  expect(folio.orders.length).toBe(2);
  expect(folio.totals.payableMinor).toBe("318000");
  expect(folio.totals.cancelledMinor).toBe("318000");
  expect(JSON.stringify(folio).includes("receipt_hash")).toBe(false);
  expect(JSON.stringify(folio).includes("owner_hash")).toBe(false);
  expect(folio.orders[0].items[0].unitPriceMinor).toBe("159000");
  const release = {
    version: current.currentSession!.version,
    reason: "Guests departed",
    idempotencyKey: randomToken(),
  };
  const released = await releaseGuests(venueId, "operator", active.id, release);
  expect(released.session.closedAt).not.toBeNull();
  expect((await releaseGuests(venueId, "operator", active.id, release)).session.id).toBe(active.id);
  const next = await seatGuests(venueId, "operator", { ...seat, idempotencyKey: randomToken() });
  expect(next.session.id).not.toBe(active.id);
  expect((await sessionFolio(venueId, next.session.id)).orders.length).toBe(0);
});

test("QR activity is unconfirmed, shared session preserves private ownership and survives restart recovery", async () => {
  const a = await submit(1),
    b = await submit(1);
  let resource = (await floorSnapshot(venueId, {})).zones
    .flatMap((z) => z.resources)
    .find((r) => r.id === tables[1].resource_id)!;
  expect(resource.state).toBe("qr_activity");
  expect(resource.currentSession?.seatedAt).toBeNull();
  expect(resource.currentSession?.orderCount).toBe(2);
  const shared = resource.currentSession!.id;
  const upgraded = await seatGuests(venueId, "operator", {
    resourceId: resource.id,
    guests: 2,
    expectedEndAt: future(60),
    idempotencyKey: randomToken(),
  });
  expect(upgraded.session.id).toBe(shared);
  await changeStatus(a.order.id, venueId, "operator", undefined, "Fixture cleanup");
  await changeStatus(b.order.id, venueId, "operator", undefined, "Fixture cleanup");
  const v = await sessionFolio(venueId, shared);
  await releaseGuests(venueId, "operator", shared, {
    version: v.session.version,
    reason: "Group departed",
    idempotencyKey: randomToken(),
  });
  const anonymous = await submit(1);
  const anonymousSession = (
    await pool.query("SELECT dining_session_id FROM dine_in_orders WHERE id=$1", [
      anonymous.order.id,
    ])
  ).rows[0].dining_session_id;
  await changeStatus(anonymous.order.id, venueId, "operator", undefined, "Fixture cleanup");
  await pool.query(
    "UPDATE dining_sessions SET last_activity_at=now()-interval '31 minutes' WHERE id=$1",
    [anonymousSession],
  );
  resource = (await floorSnapshot(venueId, {})).zones
    .flatMap((z) => z.resources)
    .find((r) => r.id === resource.id)!;
  expect(resource.currentSession).toBeNull();
  expect((await sessionFolio(venueId, anonymousSession)).session.status).toBe("expired");
});

test("17:00 visit and 19:00 booking coexist, future selection changes state, half-open night interval and history are canonical", async () => {
  const resourceId = tables[2].resource_id;
  const booking = await createFloorReservation(venueId, "manager", {
    resourceId,
    guestName: "Dayan guest",
    guests: 4,
    startsAt: "2035-10-17T19:00:00+05:00",
    endsAt: "2035-10-17T21:00:00+05:00",
    source: "whatsapp",
    idempotencyKey: randomToken(),
  });
  await pool.query(
    `INSERT INTO dining_sessions(venue_id,resource_id,opened_at,seated_at,seated_by,expected_end_at,guests,visit_status,closed_at)
    VALUES($1,$2,'2035-10-17T17:00:00+05:00','2035-10-17T17:00:00+05:00','fixture','2035-10-17T18:30:00+05:00',4,'released','2035-10-17T18:30:00+05:00')`,
    [venueId, resourceId],
  );
  const get = async (at: string, endsAt: string) =>
    (await floorSnapshot(venueId, { date: "2035-10-17", at, endsAt })).zones
      .flatMap((z) => z.resources)
      .find((r) => r.id === resourceId)!;
  const early = await get("2035-10-17T17:00:00+05:00", "2035-10-17T18:30:00+05:00");
  expect(early.state).toBe("seated");
  expect(early.nextReservation?.id).toBe(booking.reservation.id);
  expect(early.events.filter((e) => e.source === "session").length).toBe(1);
  expect(early.events.filter((e) => e.source === "reservation").length).toBe(1);
  const late = await get("2035-10-17T19:00:00+05:00", "2035-10-17T21:00:00+05:00");
  expect(late.state).toBe("reserved");
  expect(late.currentSession).toBeNull();
  const full = await get("2035-10-17T18:55:00+05:00", "2035-10-17T20:55:00+05:00");
  expect(full.available).toBe(false);
  const night = await createFloorReservation(venueId, "manager", {
    resourceId,
    guestName: "Night",
    guests: 2,
    startsAt: "2035-10-18T00:30:00+05:00",
    endsAt: "2035-10-18T02:00:00+05:00",
    source: "manual",
    idempotencyKey: randomToken(),
  });
  expect(
    (await get("2035-10-18T00:30:00+05:00", "2035-10-18T02:00:00+05:00")).currentReservation?.id,
  ).toBe(night.reservation.id);
  const nextDay = await floorSnapshot(venueId, {
    date: "2035-10-18",
    at: "2035-10-18T17:00:00+05:00",
  });
  expect(
    nextDay.zones
      .flatMap((z) => z.resources)
      .find((r) => r.id === resourceId)!
      .events.some((e) => e.id === night.reservation.id),
  ).toBe(false);
});

test("canonical conflicting reservations serialize, sequential intervals, cancellation audit, no-show and move retain links", async () => {
  const input = {
    resourceId: tables[3].resource_id,
    guestName: "Manual",
    guests: 2,
    startsAt: "2035-10-19T19:00:00+05:00",
    endsAt: "2035-10-19T21:00:00+05:00",
    source: "manual" as const,
    idempotencyKey: randomToken(),
  };
  const concurrent = await Promise.allSettled([
    createFloorReservation(venueId, "manager", input),
    createFloorReservation(venueId, "manager", { ...input, idempotencyKey: randomToken() }),
  ]);
  expect(concurrent.filter((r) => r.status === "fulfilled").length).toBe(1);
  const first = (
    concurrent.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<
      Awaited<ReturnType<typeof createFloorReservation>>
    >
  ).value.reservation;
  const sequential = await createFloorReservation(venueId, "manager", {
    ...input,
    startsAt: input.endsAt,
    endsAt: "2035-10-19T23:00:00+05:00",
    idempotencyKey: randomToken(),
  });
  const changed = await updateFloorReservation(venueId, "manager", sequential.reservation.id, {
    version: sequential.reservation.version,
    startsAt: "2035-10-20T17:00:00+05:00",
    endsAt: "2035-10-20T19:00:00+05:00",
    resourceId: tables[4].resource_id,
    reason: "Guest requested move",
    idempotencyKey: randomToken(),
  });
  expect(changed.reservation.resourceId).toBe(tables[4].resource_id);
  await updateFloorReservation(venueId, "manager", first.id, {
    version: first.version,
    status: "no_show",
    reason: "Guest did not arrive",
    idempotencyKey: randomToken(),
  });
  await expect(
    updateFloorReservation(venueId, "manager", sequential.reservation.id, {
      version: sequential.reservation.version,
      status: "cancelled",
      reason: "Stale draft cancellation",
      idempotencyKey: randomToken(),
    }),
  ).rejects.toMatchObject({ code: "STALE_RESERVATION" });
  await updateFloorReservation(venueId, "manager", sequential.reservation.id, {
    version: changed.reservation.version,
    status: "cancelled",
    reason: "Guest cancelled",
    idempotencyKey: randomToken(),
  });
  expect(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM hostess_audit WHERE action='floor_reservation_changed' AND entity_id=ANY($1)",
        [[first.id, sequential.reservation.id]],
      )
    ).rows[0].n,
  ).toBe(3);
});

test("booking check-in links canonical guest and order folio, next reservation survives release", async () => {
  const resourceId = tables[5].resource_id;
  const b = await createFloorReservation(venueId, "manager", {
    resourceId,
    guestName: "Verified staff profile",
    phone: "+77010009998",
    guests: 3,
    startsAt: future(-1),
    endsAt: future(60),
    source: "whatsapp",
    idempotencyKey: randomToken(),
  });
  const next = await createFloorReservation(venueId, "manager", {
    resourceId,
    guestName: "Next group",
    guests: 2,
    startsAt: future(90),
    endsAt: future(150),
    source: "phone",
    idempotencyKey: randomToken(),
  });
  const seat = await seatGuests(venueId, "operator", {
    resourceId,
    reservationId: b.reservation.id,
    guests: 3,
    expectedEndAt: future(60),
    idempotencyKey: randomToken(),
  });
  expect(seat.session.reservationId).toBe(b.reservation.id);
  expect(seat.session.guestName).toBe("Verified staff profile");
  await submit(5);
  await submit(5);
  const folio = await sessionFolio(venueId, seat.session.id);
  expect(folio.orders.length).toBe(2);
  expect(folio.reservation?.status).toBe("arrived");
  await changeStatus(folio.orders[0].id, venueId, "operator", undefined, undefined, true);
  const paid = await sessionFolio(venueId, seat.session.id);
  expect(paid.totals.manualReceivedMinor).toBe("318000");
  expect(paid.totals.withoutManualReceiptMinor).toBe("318000");
  const snapshot = (await floorSnapshot(venueId, {})).zones
    .flatMap((z) => z.resources)
    .find((r) => r.id === resourceId)!;
  expect(snapshot.currentSession?.id).toBe(seat.session.id);
  expect(snapshot.nextReservation?.id).toBe(next.reservation.id);
  expect((await api(`/sessions/${seat.session.id}/folio`)).status).toBe(401);
  expect((await api(`/sessions/${seat.session.id}/folio`, "viewer")).status).toBe(200);
});

test("layout versions and idempotency protect zone edits without changing tokens or aliases", async () => {
  const before = (await pool.query("SELECT token,resource_id FROM table_qr_codes ORDER BY token"))
    .rows;
  const data = (await floorSnapshot(venueId, {})).zones.find((z) => z.resources.length > 0)!;
  const input = {
    zoneId: data.id,
    resources: data.resources.map((r, i) => ({
      resourceId: r.id,
      version: r.layout.version,
      x: (i % 5) * 160,
      y: Math.floor(i / 5) * 140,
      width: 100,
      height: 80,
      shape: "rectangle" as const,
      rotation: 0,
    })),
    idempotencyKey: randomToken(),
  };
  expect((await saveFloorLayout(venueId, "manager", input)).saved).toBe(true);
  expect((await saveFloorLayout(venueId, "manager", input)).saved).toBe(true);
  await expect(
    saveFloorLayout(venueId, "manager", { ...input, idempotencyKey: randomToken() }),
  ).rejects.toMatchObject({ code: "STALE_LAYOUT" });
  expect(
    (await pool.query("SELECT token,resource_id FROM table_qr_codes ORDER BY token")).rows,
  ).toEqual(before);
  expect((await api("/layout", "operator", input, "PATCH")).status).toBe(403);
});

test("future projection uses expected departure, actual overdue seating never silently clears and concurrent release rejects stale version", async () => {
  const resourceId = tables[7].resource_id;
  const seat = await seatGuests(venueId, "operator", {
    resourceId,
    guests: 2,
    expectedEndAt: future(30),
    idempotencyKey: randomToken(),
  });
  const next = await createFloorReservation(venueId, "manager", {
    resourceId,
    guestName: "Future guests",
    guests: 2,
    startsAt: future(60),
    endsAt: future(120),
    source: "phone",
    idempotencyKey: randomToken(),
  });
  const forecast = (await floorSnapshot(venueId, { at: future(90), endsAt: future(110) })).zones
    .flatMap((z) => z.resources)
    .find((r) => r.id === resourceId)!;
  expect(forecast.state).toBe("reserved");
  expect(forecast.currentReservation?.id).toBe(next.reservation.id);
  expect(forecast.currentSession).toBeNull();
  expect(forecast.projectedSession?.id).toBe(seat.session.id);
  expect(forecast.warnings.some((w) => w.includes("Прогноз"))).toBe(true);
  const current = (await floorSnapshot(venueId, {})).zones
    .flatMap((z) => z.resources)
    .find((r) => r.id === resourceId)!;
  expect(current.state).toBe("seated");
  const releases = await Promise.allSettled([
    releaseGuests(venueId, "operator", seat.session.id, {
      version: current.currentSession!.version,
      reason: "Guests departed",
      idempotencyKey: randomToken(),
    }),
    releaseGuests(venueId, "manager", seat.session.id, {
      version: current.currentSession!.version,
      reason: "Concurrent release",
      idempotencyKey: randomToken(),
    }),
  ]);
  expect(releases.filter((r) => r.status === "fulfilled").length).toBe(1);
  const overdue = (
    await pool.query(
      `INSERT INTO dining_sessions(venue_id,resource_id,opened_at,seated_at,seated_by,expected_end_at,guests,visit_status)
    VALUES($1,$2,now()-interval '2 hours',now()-interval '2 hours','fixture',now()-interval '1 hour',2,'seated') RETURNING id`,
      [venueId, resourceId],
    )
  ).rows[0];
  const late = (await floorSnapshot(venueId, {})).zones
    .flatMap((z) => z.resources)
    .find((r) => r.id === resourceId)!;
  expect(late.state).toBe("overdue");
  expect(late.currentSession?.id).toBe(overdue.id);
  const stillLate = (await floorSnapshot(venueId, { at: future(180), endsAt: future(240) })).zones
    .flatMap((z) => z.resources)
    .find((r) => r.id === resourceId)!;
  expect(stillLate.currentSession?.id).toBe(overdue.id);
  expect(stillLate.available).toBe(false);
});

test("VIP physical alias reuses canonical room reservation, prevents double booking and preserves exact physical visit", async () => {
  const resourceId = tables[6].resource_id,
    target = (
      await pool.query("SELECT id FROM venue_resources WHERE code='VIP1' AND venue_id=$1", [
        venueId,
      ])
    ).rows[0].id;
  await pool.query(
    "UPDATE venue_resources r SET is_reservable=false,zone_id=t.zone_id,resource_type=t.resource_type,capacity=t.capacity FROM venue_resources t WHERE r.id=$1 AND t.id=$2",
    [resourceId, target],
  );
  await pool.query(
    "UPDATE venue_resource_mappings SET relationship='linked',linked_resource_id=$2,legacy_code=NULL,verified_at=now(),verified_by='fixture',note='Explicit isolated VIP relationship' WHERE resource_id=$1",
    [resourceId, target],
  );
  const booking = await createFloorReservation(venueId, "manager", {
    resourceId,
    guestName: "VIP canonical guest",
    guests: 2,
    startsAt: future(-1),
    endsAt: future(45),
    source: "whatsapp",
    idempotencyKey: randomToken(),
  });
  expect(booking.reservation.resourceId).toBe(target);
  await expect(
    createFloorReservation(venueId, "manager", {
      resourceId,
      guestName: "Duplicate VIP",
      guests: 2,
      startsAt: future(1),
      endsAt: future(40),
      source: "manual",
      idempotencyKey: randomToken(),
    }),
  ).rejects.toMatchObject({ code: "23P01" });
  const seat = await seatGuests(venueId, "operator", {
    resourceId,
    reservationId: booking.reservation.id,
    guests: 2,
    expectedEndAt: future(44),
    idempotencyKey: randomToken(),
  });
  expect(seat.session.resourceId).toBe(resourceId);
  expect(seat.session.reservationId).toBe(booking.reservation.id);
  const row = (await floorSnapshot(venueId, {})).zones
    .flatMap((z) => z.resources)
    .find((r) => r.id === resourceId)!;
  expect(row.currentReservation?.id).toBe(booking.reservation.id);
  expect(row.currentSession?.id).toBe(seat.session.id);
  expect(row.qrUrl).toContain(`/v/xoxo/t/${tables[6].code}/`);
});

test("legacy and Dayan allocation writers and availability honor confirmed visits, aliases and overdue occupancy", async () => {
  const table = tables[8];
  await pool.query(
    "UPDATE venue_resource_mappings SET relationship='linked',legacy_code='A2',verified_at=now(),verified_by='fixture',note='Explicit isolated legacy A2 survey' WHERE resource_id=$1",
    [table.resource_id],
  );
  const active = await seatGuests(venueId, "operator", {
    resourceId: table.resource_id,
    guests: 2,
    expectedEndAt: future(60),
    idempotencyKey: randomToken(),
  });
  const legacy = () =>
    pool.query(
      "INSERT INTO command_center_reservations(guest_name,phone,guests,starts_at,ends_at,table_id,table_ids) VALUES('Legacy writer','',2,$1,$2,'A2',ARRAY['A2'])",
      [future(1), future(30)],
    );
  await expect(legacy()).rejects.toMatchObject({ code: "23P01" });
  await expect(
    transaction((c) =>
      selectReservableResource(c, {
        resourceId: table.resource_id,
        startsAt: future(1),
        endsAt: future(30),
        guests: 2,
      }),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const availability = await listVenueAvailability(pool, future(1), future(30), 2, null);
  expect(availability.resources.find((r) => r.id === table.resource_id)?.available).toBe(false);
  const guest = (
    await pool.query(
      "INSERT INTO hostess_guests(name,source) VALUES('Dayan hold fixture','whatsapp') RETURNING id",
    )
  ).rows[0].id;
  await expect(
    pool.query(
      "INSERT INTO hostess_holds(guest_id,table_ids,guests,starts_at,ends_at) VALUES($1,ARRAY['A2'],2,$2,$3)",
      [guest, future(1), future(30)],
    ),
  ).rejects.toMatchObject({ code: "23P01" });
  await releaseGuests(venueId, "operator", active.session.id, {
    version: active.session.version,
    reason: "Walk-in departed",
    idempotencyKey: randomToken(),
  });
  const next = await createFloorReservation(venueId, "manager", {
    resourceId: table.resource_id,
    guestName: "Existing future reservation",
    guests: 2,
    startsAt: future(120),
    endsAt: future(180),
    source: "whatsapp",
    idempotencyKey: randomToken(),
  });
  const stale = (
    await pool.query(
      `INSERT INTO dining_sessions(venue_id,resource_id,opened_at,seated_at,seated_by,expected_end_at,guests,visit_status)
    VALUES($1,$2,now()-interval '2 hours',now()-interval '2 hours','fixture',now()-interval '1 hour',2,'seated') RETURNING id`,
      [venueId, table.resource_id],
    )
  ).rows[0];
  await expect(
    pool.query(
      "INSERT INTO command_center_reservations(guest_name,phone,guests,starts_at,ends_at,table_id,table_ids) VALUES('New future legacy','',2,$1,$2,'A2',ARRAY['A2'])",
      [future(300), future(360)],
    ),
  ).rejects.toMatchObject({ code: "23P01" });
  // An overdue visit leaves the already promised future reservation intact, including deposit updates.
  await pool.query("UPDATE command_center_reservations SET deposit_status='paid' WHERE id=$1", [
    next.reservation.id,
  ]);
  expect(
    (
      await pool.query("SELECT status FROM command_center_reservations WHERE id=$1", [
        next.reservation.id,
      ])
    ).rows[0].status,
  ).toBe("confirmed");
  await expect(
    pool.query("UPDATE command_center_reservations SET status='arrived' WHERE id=$1", [
      next.reservation.id,
    ]),
  ).rejects.toMatchObject({ code: "23P01" });
  const after = await sessionFolio(venueId, stale.id);
  await releaseGuests(venueId, "operator", stale.id, {
    version: after.session.version,
    reason: "Staff verified departure",
    idempotencyKey: randomToken(),
  });
  expect(
    (await listVenueAvailability(pool, future(300), future(360), 2, null)).resources.find(
      (r) => r.id === table.resource_id,
    )?.available,
  ).toBe(true);
});

test("manual booking normalizes 8-prefixed phone to canonical +7 guest without a duplicate profile", async () => {
  const phone = "+77015556677";
  const canonical = (
    await pool.query(
      "INSERT INTO hostess_guests(name,phone,source,provisional) VALUES('Canonical guest',$1,'whatsapp',false) RETURNING id",
      [phone],
    )
  ).rows[0];
  const countBefore = (await pool.query("SELECT count(*)::int AS count FROM hostess_guests"))
    .rows[0].count;
  const input = {
    resourceId: tables[10].resource_id,
    guestName: "Staff entered guest",
    phone: "8 (701) 555-66-77",
    guests: 2,
    startsAt: "2035-11-01T17:00:00+05:00",
    endsAt: "2035-11-01T19:00:00+05:00",
    source: "phone" as const,
    idempotencyKey: randomToken(),
  };
  const result = await createFloorReservation(venueId, "manager", input);
  expect(result.reservation.guestId).toBe(canonical.id);
  expect(result.reservation.phone).toBe(phone);
  expect(
    (await pool.query("SELECT count(*)::int AS count FROM hostess_guests")).rows[0].count,
  ).toBe(countBefore);
  await expect(
    createFloorReservation(venueId, "manager", {
      ...input,
      phone: "12345",
      idempotencyKey: randomToken(),
    }),
  ).rejects.toMatchObject({ code: "INVALID_PHONE" });
  expect(
    (await pool.query("SELECT count(*)::int AS count FROM hostess_guests")).rows[0].count,
  ).toBe(countBefore);
});

test("unconfirmed 12-hour idle activity expires with forgotten orders, isolates next company and never expires seated guests", async () => {
  const first = await submit(11);
  const previousId = (
    await pool.query("SELECT dining_session_id FROM dine_in_orders WHERE id=$1", [first.order.id])
  ).rows[0].dining_session_id;
  await pool.query(
    "UPDATE dining_sessions SET last_activity_at=now()-interval '12 hours 1 minute' WHERE id=$1",
    [previousId],
  );
  const next = await submit(11);
  const nextId = (
    await pool.query("SELECT dining_session_id FROM dine_in_orders WHERE id=$1", [next.order.id])
  ).rows[0].dining_session_id;
  expect(nextId).not.toBe(previousId);
  const previous = await sessionFolio(venueId, previousId),
    current = await sessionFolio(venueId, nextId);
  expect(previous.session.status).toBe("expired");
  expect(previous.session.closedAt).not.toBeNull();
  expect(previous.orders.length).toBe(1);
  expect(previous.orders[0].id).toBe(first.order.id);
  expect(previous.orders[0].status).toBe("new");
  expect(current.orders.length).toBe(1);
  expect(current.orders[0].id).toBe(next.order.id);
  expect(previous.totals.payableMinor).toBe("318000");
  const expiry = previous.events.find((e) => e.type === "qr_activity_expired")!;
  expect(expiry.details).toMatchObject({
    idleMinutes: 720,
    reason: "stale_qr_activity",
    ordersPreserved: true,
  });
  const seated = (
    await pool.query(
      "SELECT id FROM dining_sessions WHERE resource_id=$1 AND seated_at IS NOT NULL AND closed_at IS NULL",
      [tables[0].resource_id],
    )
  ).rows[0].id;
  await pool.query(
    "UPDATE dining_sessions SET last_activity_at=now()-interval '13 hours' WHERE id=$1",
    [seated],
  );
  const seatedOrder = await submit(0);
  expect(
    (
      await pool.query("SELECT dining_session_id FROM dine_in_orders WHERE id=$1", [
        seatedOrder.order.id,
      ])
    ).rows[0].dining_session_id,
  ).toBe(seated);
  expect((await sessionFolio(venueId, seated)).session.closedAt).toBeNull();
});

test("unknown physical capacity and pending attestation allow booking and seating independently of QR access", async () => {
  const target = (
    await pool.query(`SELECT r.id,r.code,q.token FROM venue_resources r JOIN table_qr_codes q ON q.resource_id=r.id
    JOIN venue_resource_mappings m ON m.resource_id=r.id WHERE m.linked_resource_id IS NULL AND m.legacy_code IS NULL
    AND NOT EXISTS(SELECT 1 FROM dining_sessions s WHERE s.resource_id=r.id AND s.closed_at IS NULL)
    AND NOT EXISTS(SELECT 1 FROM command_center_reservations b WHERE b.status NOT IN('cancelled','no_show') AND hostess_inventory_conflicts(COALESCE(b.table_ids,ARRAY[b.table_id]),ARRAY[r.code])) ORDER BY r.code DESC LIMIT 1`)
  ).rows[0];
  expect(!!target).toBe(true);
  await pool.query(
    "UPDATE venue_resource_mappings SET relationship='pending',verified_at=NULL,verified_by=NULL WHERE resource_id=$1",
    [target.id],
  );
  await pool.query("UPDATE venue_resources SET capacity=NULL,is_reservable=true WHERE id=$1", [
    target.id,
  ]);
  await pool.query("UPDATE table_qr_codes SET enabled=false WHERE resource_id=$1", [target.id]);
  const startsAt = future(70 * 1440),
    endsAt = future(70 * 1440 + 120);
  const availability = await listVenueAvailability(pool, startsAt, endsAt, 20, null);
  expect(availability.resources.find((r) => r.id === target.id)).toMatchObject({
    capacity: null,
    bookable: true,
    fitsGuestCount: true,
    available: true,
  });
  const booking = await createFloorReservation(venueId, "operator", {
    resourceId: target.id,
    guestName: "Unknown capacity fixture",
    guests: 20,
    startsAt,
    endsAt,
    source: "whatsapp",
    idempotencyKey: randomToken(),
  });
  await expect(
    createFloorReservation(venueId, "operator", {
      resourceId: target.id,
      guestName: "Competing public fixture",
      guests: 2,
      startsAt,
      endsAt,
      source: "website",
      idempotencyKey: randomToken(),
    }),
  ).rejects.toMatchObject({ code: "23P01" });
  expect(booking.reservation.source).toBe("whatsapp");
  const seated = await seatGuests(venueId, "operator", {
    resourceId: target.id,
    guests: 6,
    expectedEndAt: future(60),
    idempotencyKey: randomToken(),
  });
  const snapshot = await floorSnapshot(venueId, {});
  const visible = snapshot.zones.flatMap((z) => z.resources).find((r) => r.id === target.id)!;
  expect(visible.state).toBe("seated");
  expect(visible.warnings.some((w) => w.includes("физического соответствия"))).toBe(false);
  await expect(
    createQuote(
      { guestId: null, hash: hash(randomToken()) },
      { qrToken: target.token, items: [{ productId, quantity: 1 }] },
    ),
  ).rejects.toMatchObject({ code: "TABLE_DISABLED" });
  const staffOwner = { guestId: null, hash: hash("staff:independent-qr") };
  const q = await createQuote(
    staffOwner,
    { qrToken: target.token, items: [{ productId, quantity: 1 }] },
    { actor: "staff:independent-qr", sessionId: seated.session.id },
  );
  const order = await checkout(
    staffOwner,
    { quoteId: q.id, idempotencyKey: randomToken() },
    "staff:independent-qr",
  );
  expect(order.order.source).toBe("staff");
});
