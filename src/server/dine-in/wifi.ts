import { z } from "zod";
import type { Pool, PoolClient } from "pg";
import { pool } from "../db/pool";
import { ApiError } from "../guest/security";

type Db = Pick<Pool | PoolClient, "query">;
export type Wifi = {
  ssid: string;
  password: string;
  security: "WPA" | "WEP" | "nopass";
  hidden: boolean;
  enabled: boolean;
  version: number;
  updatedAt: string;
  updatedBy: string | null;
};

export const wifiInput = z
  .object({
    // Spaces are part of the network name («P. S.  XOXO guest»): never trim or collapse them.
    ssid: z
      .string()
      .min(1, "Укажите название сети")
      .refine((v) => Buffer.byteLength(v) <= 32, "Название сети длиннее 32 байт"),
    password: z.string().max(63),
    security: z.enum(["WPA", "WEP", "nopass"]),
    hidden: z.boolean(),
    enabled: z.boolean(),
    version: z.number().int().positive().nullable(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.security === "WPA" && (v.password.length < 8 || v.password.length > 63))
      ctx.addIssue({ code: "custom", path: ["password"], message: "Пароль WPA: 8–63 символа" });
    if (v.security === "WEP" && ![5, 10, 13, 26].includes(v.password.length))
      ctx.addIssue({
        code: "custom",
        path: ["password"],
        message: "Пароль WEP: 5, 10, 13 или 26 символов",
      });
    if (v.security === "nopass" && v.password)
      ctx.addIssue({ code: "custom", path: ["password"], message: "У открытой сети нет пароля" });
  });

const select = `SELECT ssid,password,security,hidden,enabled,version,updated_at AS "updatedAt",
  updated_by AS "updatedBy" FROM venue_wifi WHERE venue_id=$1`;

export async function getWifi(venueId: string, db: Db = pool): Promise<Wifi | null> {
  return ((await db.query(select, [venueId])).rows[0] as Wifi | undefined) ?? null;
}

/** Version-checked upsert: two managers editing at once cannot silently overwrite each other. */
export async function saveWifi(client: PoolClient, venueId: string, actor: string, raw: unknown) {
  const input = wifiInput.parse(raw);
  // FOR UPDATE cannot lock a row that does not exist yet; the first save is serialized here.
  await client.query("SELECT pg_advisory_xact_lock(728411020)");
  const current = (await client.query(`${select} FOR UPDATE`, [venueId])).rows[0] as
    | Wifi
    | undefined;
  if ((current?.version ?? null) !== input.version)
    throw new ApiError(409, "VERSION_CONFLICT", "Настройки Wi-Fi изменились. Обновите страницу");
  await client.query(
    `INSERT INTO venue_wifi(venue_id,ssid,password,security,hidden,enabled,updated_by)
     VALUES($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT(venue_id) DO UPDATE SET ssid=EXCLUDED.ssid,password=EXCLUDED.password,
       security=EXCLUDED.security,hidden=EXCLUDED.hidden,enabled=EXCLUDED.enabled,
       updated_by=EXCLUDED.updated_by,updated_at=now(),version=venue_wifi.version+1`,
    [venueId, input.ssid, input.password, input.security, input.hidden, input.enabled, actor],
  );
  return (await getWifi(venueId, client))!;
}

/** Standard Wi-Fi QR payload understood by iOS and Android cameras. */
export function wifiQrPayload(w: Pick<Wifi, "ssid" | "password" | "security" | "hidden">) {
  const escape = (value: string) => value.replace(/([\\;,:"])/g, "\\$1");
  return `WIFI:T:${w.security};S:${escape(w.ssid)};${
    w.security === "nopass" ? "" : `P:${escape(w.password)};`
  }${w.hidden ? "H:true;" : ""};`;
}

/** What guests see: only an enabled network, never the editing metadata. */
export function guestWifi(w: Wifi | null) {
  if (!w?.enabled) return null;
  return {
    ssid: w.ssid,
    password: w.password,
    security: w.security,
    hidden: w.hidden,
    qr: wifiQrPayload(w),
  };
}
