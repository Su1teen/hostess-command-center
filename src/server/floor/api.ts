import { z } from "zod";
import { session, checkStaffOrigin } from "../guest/auth";
import { ApiError } from "../guest/security";
import { body, failure, json } from "../dine-in/http";
import { venue } from "../dine-in/service";
import { pool } from "../db/pool";
import {
  floorSnapshot,
  seatGuests,
  releaseGuests,
  createFloorReservation,
  updateFloorReservation,
  saveFloorLayout,
  sessionFolio,
  seatSchema,
  releaseSchema,
  reservationSchema,
  reservationChangeSchema,
  layoutSchema,
} from "./service";

export async function handleFloorApi(request: Request): Promise<Response | null> {
  const url = new URL(request.url),
    base = "/api/staff/v1/floor";
  if (!(url.pathname === base || url.pathname.startsWith(`${base}/`))) return null;
  try {
    const staff = await session(request, true);
    if (!staff?.staff_id) throw new ApiError(401, "STAFF_REQUIRED", "Требуется вход сотрудника");
    const write = request.method !== "GET";
    if (write) {
      checkStaffOrigin(request);
      if (staff.role === "viewer")
        throw new ApiError(403, "STAFF_REQUIRED", "Недостаточно прав для изменения");
    }
    const v = await venue(pool, "xoxo"),
      path = url.pathname.slice(base.length);
    if (path === "" && request.method === "GET")
      return json(
        await floorSnapshot(
          v.id,
          Object.fromEntries(
            [...url.searchParams].filter(([key]) => ["date", "at", "endsAt"].includes(key)),
          ),
        ),
      );
    const folio = /^\/sessions\/([a-f0-9-]{36})\/folio$/.exec(path);
    if (folio && request.method === "GET")
      return json({ folio: await sessionFolio(v.id, z.string().uuid().parse(folio[1])) });
    if (path === "/seat" && request.method === "POST")
      return json(await seatGuests(v.id, staff.staff_id, seatSchema.parse(await body(request))));
    const release = /^\/sessions\/([a-f0-9-]{36})\/release$/.exec(path);
    if (release && request.method === "POST")
      return json(
        await releaseGuests(
          v.id,
          staff.staff_id,
          z.string().uuid().parse(release[1]),
          releaseSchema.parse(await body(request)),
        ),
      );
    if (path === "/reservations" && request.method === "POST") {
      if (staff.role !== "manager")
        throw new ApiError(403, "MANAGER_REQUIRED", "Бронирования изменяет менеджер");
      return json(
        await createFloorReservation(
          v.id,
          staff.staff_id,
          reservationSchema.parse(await body(request)),
        ),
        201,
      );
    }
    const reservationChange = /^\/reservations\/([a-f0-9-]{36})$/.exec(path);
    if (reservationChange && request.method === "PATCH") {
      if (staff.role !== "manager")
        throw new ApiError(403, "MANAGER_REQUIRED", "Бронирования изменяет менеджер");
      return json(
        await updateFloorReservation(
          v.id,
          staff.staff_id,
          z.string().uuid().parse(reservationChange[1]),
          reservationChangeSchema.parse(await body(request)),
        ),
      );
    }
    if (path === "/layout" && request.method === "PATCH") {
      if (staff.role !== "manager")
        throw new ApiError(403, "MANAGER_REQUIRED", "План изменяет менеджер");
      return json(
        await saveFloorLayout(v.id, staff.staff_id, layoutSchema.parse(await body(request))),
      );
    }
    throw new ApiError(404, "NOT_FOUND", "Маршрут не найден");
  } catch (error) {
    return failure(error);
  }
}
