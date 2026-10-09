import { ApiError } from "../guest/security";
export function exchangeApiEnabled() {
  const mode = process.env.EXCHANGE_DATA_MODE ?? "shared-db";
  if (!["shared-db", "api"].includes(mode))
    throw new ApiError(503, "CONFIG_REQUIRED", "EXCHANGE_DATA_MODE должен быть shared-db или api");
  return mode === "api";
}
export async function exchangeRequest<T>(path: string, body?: unknown, actor?: string): Promise<T> {
  const origin = process.env.EXCHANGE_API_ORIGIN,
    key = process.env.COMMAND_CENTER_SERVICE_KEY;
  if (!origin || !key || key.length < 32)
    throw new ApiError(503, "CONFIG_REQUIRED", "Не настроен серверный доступ к бирже");
  const url = new URL(origin);
  if (
    url.protocol !== "https:" &&
    !(
      process.env.NODE_ENV !== "production" &&
      url.protocol === "http:" &&
      ["127.0.0.1", "localhost"].includes(url.hostname)
    )
  )
    throw new ApiError(503, "CONFIG_REQUIRED", "Недопустимый адрес биржи");
  const response = await fetch(`${url.origin}/api/v1/command-center${path}`, {
    method: body ? "PATCH" : "GET",
    redirect: "error",
    signal: AbortSignal.timeout(8000),
    headers: {
      "x-command-center-key": key,
      "Content-Type": "application/json",
      ...(actor ? { "x-staff-actor": actor } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok)
    throw new ApiError(
      response.status,
      "EXCHANGE_UNAVAILABLE",
      "Биржа недоступна или изменение отклонено",
    );
  return response.json() as Promise<T>;
}
