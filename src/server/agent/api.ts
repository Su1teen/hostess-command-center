import { z } from "zod";
import { checkStaffOrigin, rateLimit, serviceActor, session } from "../guest/auth";
import { ApiError } from "../guest/security";
import { body, failure, json } from "../dine-in/http";
import {
  checkAvailability,
  conversationMessages,
  createAgentBooking,
  listConversations,
  recordFailedAttempt,
  recordInbound,
  recordReply,
  searchMenu,
  setPaused,
} from "./service";
import {
  addDays,
  agentKnowledge,
  astanaDate,
  deleteEvent,
  deletePromotion,
  listEvents,
  listPromotions,
  saveEvent,
  savePromotion,
} from "./knowledge";

const uuid = z.string().uuid();

/** Trusted n8n integration (WhatsApp service key) — the Dayan agent's only backend. */
async function handleIntegration(request: Request, path: string) {
  if (serviceActor(request) !== "whatsapp") throw new ApiError(403, "FORBIDDEN", "Доступ запрещён");
  await rateLimit("agent-integration", 600);
  const method = request.method;
  if (path === "/inbound" && method === "POST")
    return json(await recordInbound(await body(request)));
  if (path === "/reply" && method === "POST") return json(await recordReply(await body(request)));
  if (path === "/knowledge" && method === "GET") return json(await agentKnowledge());
  if (path === "/availability" && method === "POST")
    return json(await checkAvailability(await body(request)));
  if (path === "/menu" && method === "GET")
    return json(await searchMenu(new URL(request.url).searchParams.get("q") ?? ""));
  if (path === "/handoff" && method === "POST") {
    const input = z
      .object({ chatKey: z.string(), reason: z.string().trim().min(1).max(500) })
      .strict()
      .parse(await body(request));
    return json(await setPaused(input.chatKey, true, input.reason, "Даян"));
  }
  if (path === "/bookings" && method === "POST") {
    const raw = await body(request);
    try {
      return json(await createAgentBooking(raw), 201);
    } catch (error) {
      const input = raw as { chatKey?: unknown; idempotencyKey?: unknown };
      if (typeof input?.chatKey === "string" && typeof input?.idempotencyKey === "string")
        await recordFailedAttempt(
          input.chatKey,
          input.idempotencyKey,
          raw,
          error instanceof ApiError
            ? `${error.code}: ${error.message}`
            : String((error as Error)?.name),
        ).catch(() => undefined);
      throw error;
    }
  }
  throw new ApiError(404, "NOT_FOUND", "Операция недоступна");
}

/** Staff screens: events calendar, promotions and the Dayan dialog monitor. */
async function handleStaff(request: Request, path: string, url: URL) {
  const staff = await session(request, true);
  if (!staff?.staff_id) throw new ApiError(401, "STAFF_REQUIRED", "Требуется вход сотрудника");
  const method = request.method;
  if (method !== "GET") {
    checkStaffOrigin(request);
    if (staff.role === "viewer")
      throw new ApiError(403, "STAFF_REQUIRED", "Недостаточно прав для изменения");
  }
  if (path === "/events" && method === "GET") {
    const from = url.searchParams.get("from") ?? astanaDate();
    return json({
      events: await listEvents(from, url.searchParams.get("to") ?? addDays(from, 42)),
    });
  }
  if (path === "/events" && method === "POST")
    return json({ event: await saveEvent(staff.staff_id, await body(request)) }, 201);
  const event = /^\/events\/([a-f0-9-]{36})$/.exec(path);
  if (event && method === "PATCH")
    return json({
      event: await saveEvent(staff.staff_id, await body(request), uuid.parse(event[1])),
    });
  if (event && method === "DELETE") {
    await deleteEvent(uuid.parse(event[1]));
    return json({ ok: true });
  }
  if (path === "/promotions" && method === "GET")
    return json({ promotions: await listPromotions() });
  if (path === "/promotions" && method === "POST")
    return json({ promotion: await savePromotion(staff.staff_id, await body(request)) }, 201);
  const promotion = /^\/promotions\/([a-f0-9-]{36})$/.exec(path);
  if (promotion && method === "PATCH")
    return json({
      promotion: await savePromotion(staff.staff_id, await body(request), uuid.parse(promotion[1])),
    });
  if (promotion && method === "DELETE") {
    await deletePromotion(uuid.parse(promotion[1]));
    return json({ ok: true });
  }
  if (path === "/knowledge" && method === "GET") return json(await agentKnowledge());
  if (path === "/conversations" && method === "GET")
    return json({ conversations: await listConversations() });
  const key = url.searchParams.get("key") ?? "";
  if (path === "/conversations/messages" && method === "GET")
    return json({ messages: await conversationMessages(key) });
  if (path === "/conversations/pause" && method === "POST") {
    const input = z
      .object({ paused: z.boolean(), reason: z.string().trim().max(500).optional() })
      .strict()
      .parse(await body(request));
    return json({
      conversation: await setPaused(
        key,
        input.paused,
        input.reason || "остановлено сотрудником",
        staff.staff_id,
      ),
    });
  }
  throw new ApiError(404, "NOT_FOUND", "Операция недоступна");
}

export async function handleAgentApi(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const integration = "/api/agent/v1",
    staff = "/api/staff/v1/agent";
  try {
    if (url.pathname.startsWith(`${integration}/`))
      return await handleIntegration(request, url.pathname.slice(integration.length));
    if (url.pathname.startsWith(`${staff}/`))
      return await handleStaff(request, url.pathname.slice(staff.length), url);
    return null;
  } catch (error) {
    return failure(error);
  }
}
