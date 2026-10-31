import { z } from "zod";
import { checkStaffOrigin, session } from "../guest/auth";
import { ApiError } from "../guest/security";
import { body, failure, json } from "../dine-in/http";
import {
  broadcastRecipients,
  cancelBroadcast,
  createBroadcast,
  createRegular,
  listBroadcasts,
  listRegulars,
  markRecipient,
  updateRegular,
} from "./service";

const uuid = z.string().uuid();
const base = "/api/staff/v1/regulars";

/** Regulars hold phone numbers and bonus money, so the whole section is manager-only. */
export async function handleRegularsApi(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (!(url.pathname === base || url.pathname.startsWith(`${base}/`))) return null;
  try {
    const staff = await session(request, true);
    if (!staff?.staff_id) throw new ApiError(401, "STAFF_REQUIRED", "Требуется вход сотрудника");
    if (staff.role !== "manager")
      throw new ApiError(403, "MANAGER_REQUIRED", "Раздел доступен только менеджеру");
    const method = request.method;
    if (method !== "GET") checkStaffOrigin(request);
    const path = url.pathname.slice(base.length);

    if (path === "" && method === "GET")
      return json({ regulars: await listRegulars(url.searchParams.get("q") ?? "") });
    if (path === "" && method === "POST")
      return json(await createRegular(staff.staff_id, await body(request)), 201);
    const regular = /^\/([a-f0-9-]{36})$/.exec(path);
    if (regular && method === "PATCH")
      return json(await updateRegular(staff.staff_id, uuid.parse(regular[1]), await body(request)));

    if (path === "/broadcasts" && method === "GET")
      return json({ broadcasts: await listBroadcasts() });
    if (path === "/broadcasts" && method === "POST")
      return json(await createBroadcast(staff.staff_id, await body(request)), 201);
    const campaign = /^\/broadcasts\/([a-f0-9-]{36})$/.exec(path);
    if (campaign && method === "GET")
      return json({ recipients: await broadcastRecipients(uuid.parse(campaign[1])) });
    const cancel = /^\/broadcasts\/([a-f0-9-]{36})\/cancel$/.exec(path);
    if (cancel && method === "POST")
      return json(await cancelBroadcast(staff.staff_id, uuid.parse(cancel[1])));
    const mark = /^\/broadcasts\/([a-f0-9-]{36})\/recipients\/([a-f0-9-]{36})$/.exec(path);
    if (mark && method === "PATCH")
      return json(
        await markRecipient(
          staff.staff_id,
          uuid.parse(mark[1]),
          uuid.parse(mark[2]),
          await body(request),
        ),
      );
    throw new ApiError(404, "NOT_FOUND", "Операция недоступна");
  } catch (error) {
    return failure(error);
  }
}
