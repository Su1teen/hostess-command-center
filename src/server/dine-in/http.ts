import { z } from "zod";
import { ApiError } from "../guest/security";
export const responseHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};
export function json(data: unknown, status = 200, setCookie?: string) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...responseHeaders, ...(setCookie ? { "set-cookie": setCookie } : {}) },
  });
}
export async function body(request: Request, maximumBytes = 32768) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new ApiError(415, "JSON_REQUIRED", "Ожидается JSON");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "INVALID_BODY", "Пустой запрос");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maximumBytes) {
      await reader.cancel();
      throw new ApiError(413, "TOO_LARGE", "Запрос слишком большой");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError(400, "INVALID_BODY", "Некорректный JSON");
  }
}
export function failure(error: unknown) {
  if (error instanceof ApiError)
    return json({ error: { code: error.code, message: error.message } }, error.status);
  if (error instanceof z.ZodError)
    return json({ error: { code: "INVALID_INPUT", message: "Проверьте поля запроса" } }, 422);
  const code = (error as { code?: string })?.code;
  if (code === "23P01")
    return json(
      {
        error: {
          code: "CONFLICT",
          message:
            "Есть пересекающиеся брони или удержания. Измените время или завершите текущие операции.",
        },
      },
      409,
    );
  if (code === "23505")
    return json({ error: { code: "CONFLICT", message: "Запись уже существует" } }, 409);
  if (code === "23503" || code === "23514")
    return json(
      {
        error: {
          code: "INVALID_REFERENCE",
          message: "Связанные данные недоступны или нарушено ограничение",
        },
      },
      422,
    );
  console.error("[dine-in] request failed", error instanceof Error ? error.name : "UnknownError");
  return json({ error: { code: "UNAVAILABLE", message: "Сервис временно недоступен" } }, 503);
}
