import { describe, expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import {
  calculate,
  toMinor,
  normalizePhone,
  assertTransition,
  priceLines,
  quoteInput,
  type Snapshot,
} fr…20042 tokens truncated…lThis.fetch = old;
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
