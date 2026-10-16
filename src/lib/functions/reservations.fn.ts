import { requireStaff } from "../../server/guest/auth";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { DepositStatus, ReservationPreorder, ReservationStatus } from "../types/reservations";
import {
  createReservation as create,
  getReservationsBoard as getBoard,
  getTableAvailability as getAvailability,
  setDepositStatus as setDeposit,
  setReservationStatus as setStatus,
} from "../../server/services/reservations.service";

const preorderSchema = z.object({
  productName: z.string().min(1),
  quantity: z.number().int().min(1),
  unitPrice: z.number().min(0),
  comment: z.string().optional(),
});
const sourceSchema = z.enum(["whatsapp", "instagram", "phone", "website", "manual", "other"]);
const depositSchema = z.enum(["none", "pending", "paid", "refunded"]);
const statusSchema = z.enum(["confirmed", "expected", "arrived", "cancelled", "no_show"]);
const dateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const getReservationsBoard = createServerFn({ method: "GET" })
  .inputValidator(z.object({ date: dateKeySchema.optional() }).default({}))
  .handler(async ({ data }) => {
    await requireStaff();
    try {
      return await getBoard(data.date);
    } catch (error) {
      console.error("[command-center] operation failed");
      throw new Error("База данных недоступна");
    }
  });

export const getTableAvailability = createServerFn({ method: "GET" })
  .inputValidator(z.object({ startsAt: z.string().datetime(), endsAt: z.string().datetime() }))
  .handler(async ({ data }) => {
    await requireStaff();
    try {
      return await getAvailability(data.startsAt, data.endsAt);
    } catch (error) {
      console.error("[command-center] operation failed");
      throw new Error("База данных недоступна");
    }
  });

export const createReservation = createServerFn({ method: "POST" })
  .inputValidator(
    z
      .object({
        tableId: z.string().min(1).optional(),
        resourceId: z.string().uuid().optional(),
        guestName: z.string().min(1),
        phone: z.string().min(5),
        guests: z.number().int().min(1).max(50),
        startsAt: z.string().datetime(),
        endsAt: z.string().datetime(),
        source: sourceSchema,
        depositAmount: z.number().min(0).default(0),
        depositStatus: depositSchema.default("none"),
        comment: z.string().optional(),
        preorders: z.array(preorderSchema).default([]),
      })
      .refine(
        (value) => Boolean(value.tableId) || Boolean(value.resourceId),
        "Выберите стол или ресурс",
      ),
  )
  .handler(async ({ data }) => {
    await requireStaff(true, true);
    try {
      return await create(data, data.preorders as ReservationPreorder[]);
    } catch (error) {
      console.error("[command-center] operation failed");
      throw new Error("База данных недоступна");
    }
  });

export const setReservationStatus = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string().uuid(), status: statusSchema }))
  .handler(async ({ data }) => {
    await requireStaff(true);
    try {
      return await setStatus(data.id, data.status as ReservationStatus);
    } catch (error) {
      console.error("[command-center] operation failed");
      throw new Error("База данных недоступна");
    }
  });

export const setDepositStatus = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string().uuid(), status: depositSchema }))
  .handler(async ({ data }) => {
    await requireStaff(true, true);
    try {
      return await setDeposit(data.id, data.status as DepositStatus);
    } catch (error) {
      console.error("[command-center] operation failed");
      throw new Error("База данных недоступна");
    }
  });
