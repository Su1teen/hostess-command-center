import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  hash,
  randomToken,
  whatsappSubject,
  equalSecret,
  validateSelection,
} from "../src/server/guest/security";
import { HALL_TABLES } from "../src/lib/hall/layout";
import { handleBookingApi } from "../src/server/guest/api";
import { pool } from "../src/server/db/pool";

const config = process.env.TEST_BOOKING_DATABASE_URL;
if (
  !config ||
  !config.includes("127.0.0.1") ||
  !config.includes("hostess_test@") ||
  config !== process.env.DATABASE_URL
)
  throw new Error("Tests require the dedicated isolated local PostgreSQL runner");
const key = process.env.HOSTESS_BFF_KEY!,
  waKey = process.env.WHATSAPP_SERVICE_KEY!;
let counter = 0;
async function api(
  path: string,
  body?: unknown,
  options: { cookie?: string; wa?: boolean; jid?: string; origin?: string } = {},
) {
  const request = new Request(`https://command.test/api/guest/v1${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      "x-hostess-service-key": options.wa ? waKey : key,
      "x-hostess-client-id": `test-${++counter}`,
      ...(body ? { "content-type": "application/json" } : {}),
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.jid ? { "x-whatsapp-sender-jid": options.jid } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const response = (await handleBookingApi(request))!;
  return {
    status: response.status,
    data: await response.json(),
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  };
}
const fixture = () => ({ name: "Test Guest", phone: "+70000000001", consent: true });
const interval = (day: number) => {
  const base = new Date(Date.now() + day * 86400_000);
  const start = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), 14),
  );
  return {
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + 7200_000).toISOString(),
  };
};
const bootstrap = () => api("/bootstrap", fixture());
beforeAll(async () => {
  for (const file of [
    "0001_reservations.sql",
    "0002_reservation_tables.sql",
    "0003_guest_booking.sql",
    "0004_venue_inventory.sql",
    "0005_fix_normalized_resource_links.sql",
    "0006_dine_in.sql",
    "0007_physical_inventory_mapping.sql",
  ])
    await pool.query(
      readFileSync(new URL(`../src/server/db/migrations/${file}`, import.meta.url), "utf8"),
    );
});
afterAll(async () => {
  await pool.end();
});

describe("guest security", () => {
  test("rejects WhatsApp LID and normalizes real sender JID", () => {
    expect(() => whatsappSubject("70000000001@lid")).toThrow();
    expect(whatsappSubject("70000000001@s.whatsapp.net").subject).toBe("70000000001@c.us");
  });
  test("generates 256-bit unpredictable hashed tokens", () => {
    const a = randomToken(),
      b = randomToken();
    expect(a).toHaveLength(43);
    expect(a).not.toBe(b);
    expect(hash(a)).toHaveLength(64);
    expect(equalSecret(a, a)).toBe(true);
    expect(equalSecret(a, b)).toBe(false);
    expect(equalSecret("short", "short")).toBe(false);
  });
  test("does not merge by a typed phone", async () => {
    const a = await bootstrap(),
      b = await bootstrap();
    expect(a.status).toBe(201);
    expect(b.data.guestId).not.toBe(a.data.guestId);
  });
  test("denies public API without service auth", async () => {
    const response = (await handleBookingApi(
      new Request("https://command.test/api/guest/v1/profile"),
    ))!;
    expect(response.status).toBe(401);
  });
  test("browser cannot assert WhatsApp identity", async () => {
    const response = await api("/identity", {
      name: "Test",
      jid: "70000000001@c.us",
      consent: true,
    });
    expect(response.status).toBe(403);
  });
  test("rejects capacity and invalid groups", () => {
    expect(() =>
      validateSelection({ ...interval(20), guests: 7, tableIds: ["A1"] }, HALL_TABLES),
    ).toThrow();
    expect(() =>
      validateSelection({ ...interval(20), guests: 4, tableIds: ["A1", "C1"] }, HALL_TABLES),
    ).toThrow();
  });
});
describe("canonical reservation transactions", () => {
  test("VIP capacity, hold idempotency, saved resource link, and cancellation release", async () => {
    const guest = await bootstrap();
    const vip2 = (
      await pool.query("SELECT id FROM venue_resources WHERE venue_code='xoxo' AND code='VIP2'")
    ).rows[0].id as string;
    const vip3 = (
      await pool.query("SELECT id FROM venue_resources WHERE venue_code='xoxo' AND code='VIP3'")
    ).rows[0].id as string;
    const window = interval(30);
    const available = await api(
      `/availability?startsAt=${encodeURIComponent(window.startsAt)}&endsAt=${encodeURIComponent(window.endsAt)}&guests=8`,
      undefined,
      { cookie: guest.cookie },
    );
    const rooms = new Map(
      available.data.resources.map((room: { code: string; fitsGuestCount: boolean }) => [
        room.code,
        room,
      ]),
    );
    expect(available.status).toBe(200);
    expect(rooms.get("VIP2")?.fitsGuestCount).toBe(true);
    expect(rooms.get("VIP3")?.fitsGuestCount).toBe(false);

    const key = randomToken();
    const selection = { ...window, guests: 8, resourceId: vip2, idempotencyKey: key };
    const holds = await Promise.all([
      api("/holds", selection, { cookie: guest.cookie }),
      api("/holds", selection, { cookie: guest.cookie }),
    ]);
    expect(holds.map((result) => result.status)).toEqual([201, 201]);
    expect(holds[0].data.id).toBe(holds[1].data.id);

    const created = await api(
      "/reservations",
      { holdId: holds[0].data.id, idempotencyKey: randomToken() },
      { cookie: guest.cookie },
    );
    expect(created.status).toBe(201);
    expect(created.data.reservation.resourceName).toBe("VIP 2 — большая");
    const link = await pool.query(
      "SELECT resource_id FROM command_center_reservation_resources WHERE reservation_id=$1",
      [created.data.reservation.id],
    );
    expect(link.rows[0].resource_id).toBe(vip2);

    await pool.query("UPDATE command_center_reservations SET status='cancelled' WHERE id=$1", [
      created.data.reservation.id,
    ]);
    const next = await api(
      "/holds",
      { ...window, guests: 8, resourceId: vip2, idempotencyKey: randomToken() },
      { cookie: guest.cookie },
    );
    expect(next.status).toBe(201);
    const tooMany = await api(
      "/holds",
      { ...interval(31), guests: 6, resourceId: vip3, idempotencyKey: randomToken() },
      { cookie: guest.cookie },
    );
    expect(tooMany.status).toBe(422);
    expect(tooMany.data.error.code).toBe("CAPACITY");
  });

  test("parallel requests cannot reserve the same VIP room", async () => {
    const a = await bootstrap();
    const b = await bootstrap();
    const vip2 = (
      await pool.query("SELECT id FROM venue_resources WHERE venue_code='xoxo' AND code='VIP2'")
    ).rows[0].id as string;
    const window = interval(32);
    const selection = { ...window, guests: 8, resourceId: vip2 };
    const results = await Promise.all([
      api("/reservations", { selection, idempotencyKey: randomToken() }, { cookie: a.cookie }),
      api("/reservations", { selection, idempotencyKey: randomToken() }, { cookie: b.cookie }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
  });

  test("two concurrent holds: exactly one wins", async () => {
    const a = await bootstrap(),
      b = await bootstrap();
    const selection = { ...interval(1), guests: 2, tableIds: ["A1"] };
    const results = await Promise.all([
      api("/holds", selection, { cookie: a.cookie }),
      api("/holds", selection, { cookie: b.cookie }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });
  test("shared row, correct party size, idempotency and own history", async () => {
    const a = await bootstrap(),
      b = await bootstrap();
    const selection = { ...interval(2), guests: 5, tableIds: ["A1", "A2"] };
    const hold = await api("/holds", selection, { cookie: a.cookie });
    expect(hold.status).toBe(201);
    const payload = { holdId: hold.data.id, idempotencyKey: randomToken() };
    const results = await Promise.all([
      api("/reservations", payload, { cookie: a.cookie }),
      api("/reservations", payload, { cookie: a.cookie }),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    const id = results[0].data.reservation.id;
    expect(results[1].data.reservation.id).toBe(id);
    expect(results[0].data.reservation.guests).toBe(5);
    const row = (await pool.query("SELECT * FROM command_center_reservations WHERE id=$1", [id]))
      .rows[0];
    expect(row.guest_id).toBe(a.data.guestId);
    expect(row.table_ids).toEqual(["A1", "A2"]);
    expect(row.status).toBe("expected");
    expect(row.iiko_sync_status).toBe("staff_review");
    const profile = await api("/profile", undefined, { cookie: b.cookie });
    expect(profile.data.reservations).toHaveLength(0);
    const mismatch = await api(
      "/reservations",
      { ...payload, holdId: crypto.randomUUID() },
      { cookie: a.cookie },
    );
    expect(mismatch.status).toBe(409);
    const audit = await pool.query("SELECT actor FROM hostess_audit WHERE entity_id=$1", [id]);
    expect(audit.rows[0].actor).toBe(`bff:${a.data.guestId}`);
  });
  test("DB trigger rejects legacy insert into held table", async () => {
    const a = await bootstrap();
    await api("/holds", { ...interval(3), guests: 2, tableIds: ["B1"] }, { cookie: a.cookie });
    const { startsAt, endsAt } = interval(3);
    const client = await pool.connect();
    let code = "";
    try {
      await client.query(
        `INSERT INTO command_center_reservations(guest_name,phone,guests,starts_at,ends_at,table_id) VALUES('Test','+70000000000',2,$1,$2,'B1')`,
        [startsAt, endsAt],
      );
    } catch (e) {
      code = (e as { code: string }).code;
    } finally {
      client.release(true);
    }
    expect(code).toBe("23P01");
  });
  test("terminal reservation reactivation cannot bypass overlap guard", async () => {
    const { startsAt, endsAt } = interval(4);
    const old = await pool.query(
      `INSERT INTO command_center_reservations(guest_name,phone,guests,starts_at,ends_at,table_id,status) VALUES('Test','+70000000000',2,$1,$2,'C1','cancelled') RETURNING id`,
      [startsAt, endsAt],
    );
    await pool.query(
      `INSERT INTO command_center_reservations(guest_name,phone,guests,starts_at,ends_at,table_id) VALUES('Test','+70000000000',2,$1,$2,'C1')`,
      [startsAt, endsAt],
    );
    const client = await pool.connect();
    let code = "";
    try {
      await client.query("UPDATE command_center_reservations SET status='confirmed' WHERE id=$1", [
        old.rows[0].id,
      ]);
    } catch (e) {
      code = (e as { code: string }).code;
    } finally {
      client.release(true);
    }
    expect(code).toBe("23P01");
  });
  test("expired hold cannot produce false success", async () => {
    const a = await bootstrap();
    const hold = await api(
      "/holds",
      { ...interval(5), guests: 2, tableIds: ["B2"] },
      { cookie: a.cookie },
    );
    await pool.query("UPDATE hostess_holds SET expires_at=now()-interval '1 minute' WHERE id=$1", [
      hold.data.id,
    ]);
    const result = await api(
      "/reservations",
      { holdId: hold.data.id, idempotencyKey: randomToken() },
      { cookie: a.cookie },
    );
    expect(result.status).toBe(409);
    expect(result.data.error.code).toBe("HOLD_EXPIRED");
  });
  test("wrong guest cannot confirm someone else hold", async () => {
    const a = await bootstrap(),
      b = await bootstrap();
    const hold = await api(
      "/holds",
      { ...interval(6), guests: 2, tableIds: ["B3"] },
      { cookie: a.cookie },
    );
    expect(
      (
        await api(
          "/reservations",
          { holdId: hold.data.id, idempotencyKey: randomToken() },
          { cookie: b.cookie },
        )
      ).status,
    ).toBe(409);
  });
});
describe("WhatsApp magic links", () => {
  test("identity reuse, atomic redemption, cookie security, expiry, replay", async () => {
    const wa = { wa: true, jid: "70000000002@c.us" };
    const input = { name: "Test WA", jid: wa.jid, consent: true };
    const a = await api("/identity", input, wa),
      b = await api("/identity", input, wa);
    expect(a.data.guestId).toBe(b.data.guestId);
    const link = await api("/links", { guestId: a.data.guestId }, wa);
    expect(link.status).toBe(200);
    expect(new URL(link.data.url).origin).toBe("https://hostes.online");
    const token = new URL(link.data.url).hash.slice("#token=".length);
    expect(new URL(link.data.url).search).toBe("");
    const stored = (
      await pool.query("SELECT token_hash FROM hostess_magic_links WHERE guest_id=$1", [
        a.data.guestId,
      ])
    ).rows[0];
    expect(stored.token_hash).toBe(hash(token));
    expect(stored.token_hash).not.toBe(token);
    const redeemed = await Promise.all([api("/claims", { token }), api("/claims", { token })]);
    expect(redeemed.map((r) => r.status).sort()).toEqual([200, 410]);
    const winner = redeemed.find((r) => r.status === 200)!;
    expect((await api("/profile", undefined, { cookie: winner.cookie })).data.guest.id).toBe(
      a.data.guestId,
    );
    const expired = await api("/links", { guestId: a.data.guestId }, wa);
    const expToken = new URL(expired.data.url).hash.slice(7);
    await pool.query(
      "UPDATE hostess_magic_links SET expires_at=now()-interval '1 minute' WHERE token_hash=$1",
      [hash(expToken)],
    );
    expect((await api("/claims", { token: expToken })).status).toBe(410);
  });
  test("code plus verified WhatsApp links provisional booking to returning guest", async () => {
    const wa = { wa: true, jid: "70000000001@c.us" };
    const existing = await api("/identity", { name: "Test", jid: wa.jid, consent: true }, wa);
    const provisional = await bootstrap();
    const proof = await api("/ownership", {}, { cookie: provisional.cookie });
    const linked = await api(
      "/identity",
      { name: "Test", jid: wa.jid, consent: true, claimCode: proof.data.claimCode },
      wa,
    );
    expect(linked.data.guestId).toBe(existing.data.guestId);
    expect((await api("/profile", undefined, { cookie: provisional.cookie })).status).toBe(401);
    expect(
      (
        await api(
          "/identity",
          { name: "Test", jid: wa.jid, consent: true, claimCode: proof.data.claimCode },
          wa,
        )
      ).status,
    ).toBe(403);
  });
});

describe("sender binding, quotes and ownership", () => {
  test("WhatsApp cannot issue a link for another sender", async () => {
    const owner = { wa: true, jid: "70000000003@c.us" };
    const guest = await api("/identity", { name: "Test", jid: owner.jid, consent: true }, owner);
    const wrong = await api(
      "/links",
      { guestId: guest.data.guestId },
      { wa: true, jid: "70000000004@c.us" },
    );
    expect(wrong.status).toBe(403);
  });
  test("LID header and spoofed body do not prove identity", async () => {
    expect(
      (
        await api(
          "/identity",
          { name: "Test", jid: "70000000005@c.us", consent: true },
          { wa: true, jid: "70000000005@lid" },
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await api(
          "/identity",
          { name: "Test", jid: "70000000006@c.us", consent: true },
          { wa: true, jid: "70000000007@c.us" },
        )
      ).status,
    ).toBe(403);
  });
  test("quote snapshot is authoritative, consumed atomically, and staff sees same preorder", async () => {
    const guest = await bootstrap(),
      productId = crypto.randomUUID();
    const old = globalThis.fetch;
    process.env.EXCHANGE_API_ORIGIN = "https://exchange.test";
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          status: "ok",
          generatedAt: new Date().toISOString(),
          currentRound: { id: "test-round", endsAt: new Date(Date.now() + 600000).toISOString() },
          products: [
            {
              id: productId,
              name: "Test Drink",
              price: 1234.5,
              currency: "KZT",
              isAvailable: true,
            },
          ],
        }),
        { headers: { "content-type": "application/json" } },
      )) as typeof fetch;
    try {
      const quote = await api(
        "/quotes",
        { items: [{ productId, quantity: 2 }] },
        { cookie: guest.cookie },
      );
      expect(quote.status).toBe(201);
      expect(quote.data.lines[0].total).toBe(2469);
      const hold = await api(
        "/holds",
        { ...interval(8), guests: 2, tableIds: ["C2"] },
        { cookie: guest.cookie },
      );
      const result = await api(
        "/reservations",
        { holdId: hold.data.id, quoteId: quote.data.id, idempotencyKey: randomToken() },
        { cookie: guest.cookie },
      );
      expect(result.status).toBe(201);
      expect(Number(result.data.reservation.preorders[0].unitPrice)).toBe(1234.5);
      const preorder = (
        await pool.query(
          "SELECT * FROM command_center_reservation_preorders WHERE reservation_id=$1",
          [result.data.reservation.id],
        )
      ).rows[0];
      expect(preorder.product_id).toBe(productId);
      expect(preorder.preorder_status).toBe("pending");
      expect(preorder.round_id).toBe("test-round");
      const another = await api(
        "/holds",
        { ...interval(9), guests: 2, tableIds: ["C2"] },
        { cookie: guest.cookie },
      );
      expect(
        (
          await api(
            "/reservations",
            { holdId: another.data.id, quoteId: quote.data.id, idempotencyKey: randomToken() },
            { cookie: guest.cookie },
          )
        ).status,
      ).toBe(409);
    } finally {
      globalThis.fetch = old;
    }
  });
  test("expired quote rolls back reservation creation", async () => {
    const guest = await bootstrap();
    const quote = (
      await pool.query(
        "INSERT INTO hostess_quotes(guest_id,round_id,lines,expires_at) VALUES($1,'test','[]',now()-interval '1 minute') RETURNING id",
        [guest.data.guestId],
      )
    ).rows[0];
    const hold = await api(
      "/holds",
      { ...interval(10), guests: 2, tableIds: ["B4"] },
      { cookie: guest.cookie },
    );
    expect(
      (
        await api(
          "/reservations",
          { holdId: hold.data.id, quoteId: quote.id, idempotencyKey: randomToken() },
          { cookie: guest.cookie },
        )
      ).data.error.code,
    ).toBe("QUOTE_EXPIRED");
    expect(
      (await api("/profile", undefined, { cookie: guest.cookie })).data.reservations,
    ).toHaveLength(0);
  });
  test("offline exchange cannot create quote or sale", async () => {
    const guest = await bootstrap();
    const old = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("test-offline");
    }) as typeof fetch;
    try {
      const result = await api(
        "/quotes",
        { items: [{ productId: crypto.randomUUID(), quantity: 1 }] },
        { cookie: guest.cookie },
      );
      expect(result.status).toBe(503);
      expect(
        (await api("/profile", undefined, { cookie: guest.cookie })).data.reservations,
      ).toHaveLength(0);
    } finally {
      globalThis.fetch = old;
    }
  });
  test("revoked guest session is denied", async () => {
    const guest = await bootstrap();
    expect((await api("/logout", {}, { cookie: guest.cookie })).status).toBe(200);
    expect((await api("/profile", undefined, { cookie: guest.cookie })).status).toBe(401);
  });
  test("raw token never stored and secure cookie flags are set", async () => {
    const guest = await bootstrap();
    const raw = guest.cookie!.split("=")[1];
    const found = (
      await pool.query("SELECT token_hash FROM hostess_sessions WHERE guest_id=$1", [
        guest.data.guestId,
      ])
    ).rows[0];
    expect(found.token_hash).toBe(hash(raw));
    const response = (await handleBookingApi(
      new Request("https://command.test/api/guest/v1/bootstrap", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hostess-service-key": key,
          "x-hostess-client-id": randomToken(),
        },
        body: JSON.stringify(fixture()),
      }),
    ))!;
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("Domain=");
  });
});
describe("staff auth", () => {
  test("staff reads require server session", async () => {
    const response = (await handleBookingApi(new Request("https://command.test/api/staff/v1/me")))!;
    expect(response.status).toBe(401);
  });
  test("staff login rejects cross-origin before password verification", async () => {
    const response = (await handleBookingApi(
      new Request("https://command.test/api/staff/v1/login", {
        method: "POST",
        headers: { origin: "https://evil.test", "content-type": "application/json" },
        body: '{"username":"test","password":"test"}',
      }),
    ))!;
    expect(response.status).toBe(403);
  });
  test("staff viewer cannot move a reservation", async () => {
    const raw = randomToken();
    await pool.query(
      "INSERT INTO hostess_sessions(token_hash,staff_id,role,expires_at) VALUES($1,'test-viewer','viewer',now()+interval '1 hour')",
      [hash(raw)],
    );
    const response = (await handleBookingApi(
      new Request(`https://command.test/api/staff/v1/reservations/${crypto.randomUUID()}/move`, {
        method: "POST",
        headers: {
          cookie: `__Host-hostess-staff=${raw}`,
          origin: "https://command.test",
          "content-type": "application/json",
        },
        body: JSON.stringify({ tableIds: ["A1"], reason: "Test move" }),
      }),
    ))!;
    expect(response.status).toBe(403);
  });
});

describe("automation event dedup", () => {
  test("atomic create with a stable WAHA event key returns same row on retry", async () => {
    const wa = { wa: true, jid: "70000000010@c.us" };
    const identity = await api(
      "/identity",
      { name: "Test Automation", jid: wa.jid, consent: true },
      wa,
    );
    const payload = {
      guestId: identity.data.guestId,
      selection: { ...interval(12), tableIds: ["A3"], guests: 3 },
      idempotencyKey: "wa:sulya:fixture-event-00001",
    };
    const first = await api("/reservations", payload, wa),
      second = await api("/reservations", payload, wa);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.data.reservation.id).toBe(second.data.reservation.id);
  });
});

describe("full authorized history", () => {
  test("pagination handles more than 200 records with identical timestamps", async () => {
    const guest = await bootstrap();
    await pool.query(
      `INSERT INTO command_center_reservations(guest_id,guest_name,phone,guests,starts_at,ends_at,status) SELECT $1,'Test History','+70000000000',1,now(),now()+interval '2 hours','cancelled' FROM generate_series(1,205)`,
      [guest.data.guestId],
    );
    const first = await api("/profile", undefined, { cookie: guest.cookie });
    expect(first.data.reservations).toHaveLength(200);
    const second = await api(
      "/profile?before=" + encodeURIComponent(first.data.nextCursor),
      undefined,
      { cookie: guest.cookie },
    );
    expect(second.data.reservations).toHaveLength(5);
    expect(
      new Set([...first.data.reservations, ...second.data.reservations].map((r) => r.id)).size,
    ).toBe(205);
  });
});

describe("staff guest ownership", () => {
  const staffCall = async (path: string, role: string, body?: unknown) => {
    const raw = randomToken();
    await pool.query(
      "INSERT INTO hostess_sessions(token_hash,staff_id,role,expires_at) VALUES($1,'test-staff',$2,now()+interval '1 hour')",
      [hash(raw), role],
    );
    const response = (await handleBookingApi(
      new Request("https://command.test/api/staff/v1" + path, {
        method: body ? "POST" : "GET",
        headers: {
          cookie: "__Host-hostess-staff=" + raw,
          origin: "https://command.test",
          "content-type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    ))!;
    return { status: response.status, data: await response.json() };
  };
  test("staff directory is real and viewer cannot attach legacy records", async () => {
    const directory = await staffCall("/guests", "viewer");
    expect(directory.status).toBe(200);
    expect(directory.data.guests.length).toBeGreaterThan(0);
    const denied = await staffCall(
      "/guests/" + crypto.randomUUID() + "/link-reservation",
      "viewer",
      { reservationId: crypto.randomUUID(), reason: "Verified test ownership" },
    );
    expect(denied.status).toBe(403);
  });
  test("manager links a matching legacy record only to verified identity with audit", async () => {
    const wa = { wa: true, jid: "70000000018@c.us" };
    const identity = await api(
      "/identity",
      { name: "Test Legacy Owner", jid: wa.jid, consent: true },
      wa,
    );
    const reservation = (
      await pool.query(
        "INSERT INTO command_center_reservations(guest_name,phone,guests,starts_at,ends_at,status) VALUES('Test Legacy','+7 000 000 0018',1,now(),now()+interval '2 hours','cancelled') RETURNING id",
      )
    ).rows[0];
    const result = await staffCall(
      "/guests/" + identity.data.guestId + "/link-reservation",
      "manager",
      { reservationId: reservation.id, reason: "Verified test ownership" },
    );
    expect(result.status).toBe(200);
    const own = await api("/profile?guestId=" + identity.data.guestId, undefined, wa);
    expect(own.data.reservations.some((r) => r.id === reservation.id)).toBe(true);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM hostess_audit WHERE action='legacy_guest_link' AND entity_id=$1",
          [reservation.id],
        )
      ).rows[0].n,
    ).toBe(1);
    const other = await api(
      "/identity",
      { name: "Test Wrong Owner", jid: "70000000019@c.us", consent: true },
      { wa: true, jid: "70000000019@c.us" },
    );
    const wrong = await staffCall(
      "/guests/" + other.data.guestId + "/link-reservation",
      "manager",
      { reservationId: reservation.id, reason: "Incorrect test ownership" },
    );
    expect(wrong.status).toBe(409);
  });
});

describe("guest mutations retry safely", () => {
  test("reschedule and cancellation preserve the record and repeat successfully", async () => {
    const guest = await bootstrap();
    const hold = await api(
      "/holds",
      { ...interval(20), tableIds: ["B1"], guests: 2 },
      { cookie: guest.cookie },
    );
    const created = await api(
      "/reservations",
      { holdId: hold.data.id, idempotencyKey: crypto.randomUUID() },
      { cookie: guest.cookie },
    );
    const replacement = await api(
      "/holds",
      { ...interval(21), tableIds: ["B2"], guests: 2 },
      { cookie: guest.cookie },
    );
    const mutate = async (body: unknown) => {
      const response = (await handleBookingApi(
        new Request(
          "https://command.test/api/guest/v1/reservations/" + created.data.reservation.id,
          {
            method: "PATCH",
            headers: {
              "x-hostess-service-key": key,
              cookie: guest.cookie!,
              "content-type": "application/json",
            },
            body: JSON.stringify(body),
          },
        ),
      ))!;
      return { status: response.status, data: await response.json() };
    };
    const first = await mutate({ action: "reschedule", holdId: replacement.data.id });
    const retry = await mutate({ action: "reschedule", holdId: replacement.data.id });
    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(retry.data.reservation.id).toBe(created.data.reservation.id);
    expect(retry.data.reservation.tableIds).toEqual(["B2"]);
    expect((await mutate({ action: "cancel" })).status).toBe(200);
    expect((await mutate({ action: "cancel" })).status).toBe(200);
    expect(
      (await api("/profile", undefined, { cookie: guest.cookie })).data.reservations[0].status,
    ).toBe("cancelled");
  });
});
