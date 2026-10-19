import { useRef, useState } from "react";
import { staffApi, controlClass, money } from "../../lib/dine-in-client";
import { useQueryClient } from "@tanstack/react-query";
type Preview = {
  previewToken: string;
  counts: Record<string, number>;
  applied: boolean;
  rows: { sourceKey: string; name: string; portion: string; priceMinor: number; status: string }[];
};
export function MenuImport() {
  const [items, setItems] = useState<unknown[] | null>(null),
    [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const attempt = useRef<string | null>(null),
    client = useQueryClient();
  const labels: Record<string, string> = {
    create: "Новые",
    update: "Обновления",
    unchanged: "Без изменений",
    exchange: "Исключены: биржа",
    duplicate: "Дубликаты",
  };
  async function submit(mode: "preview" | "apply") {
    setBusy(true);
    setError("");
    try {
      const result = await staffApi<Preview>("/dine-in/menu-import", {
        method: "POST",
        body: JSON.stringify({
          mode,
          items,
          ...(mode === "apply"
            ? {
                previewToken: preview!.previewToken,
                idempotencyKey: (attempt.current ??= crypto.randomUUID()),
              }
            : {}),
        }),
      });
      setPreview(result);
      if (result.applied) {
        void client.invalidateQueries({ queryKey: ["regular-menu-staff"] });
        attempt.current = null;
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="rounded-2xl border border-slate-200 bg-white p-4">
      <summary className="cursor-pointer text-sm font-semibold">Импорт меню</summary>
      <p className="mt-3 text-xs text-slate-500">
        Загрузите проверенный JSON с исходными идентификаторами. Сначала появится предварительный
        просмотр. Биржа и история заказов сохраняются.
      </p>
      <input
        type="file"
        accept="application/json,.json"
        aria-label="Файл импорта меню"
        disabled={busy}
        className="mt-4 block w-full text-sm"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setError("");
          setPreview(null);
          setItems(null);
          attempt.current = null;
          try {
            if (file.size > 2_000_000) throw new Error("Файл должен быть меньше 2 МБ");
            const parsed = JSON.parse(await file.text());
            const data = Array.isArray(parsed) ? parsed : parsed.items;
            if (!Array.isArray(data) || !data.length) throw new Error("В файле нет позиций");
            setItems(data);
          } catch (error) {
            setError((error as Error).message);
          }
        }}
      />
      {items && (
        <button
          className={`${controlClass} mt-3`}
          disabled={busy}
          onClick={() => {
            attempt.current = null;
            void submit("preview");
          }}
        >
          Предварительный просмотр · {items.length} позиций
        </button>
      )}
      {preview && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            {Object.entries(preview.counts).map(([key, count]) => (
              <span key={key} className="rounded-full bg-slate-100 px-3 py-2 text-xs">
                {labels[key] ?? key}: {count}
              </span>
            ))}
          </div>
          <div className="max-h-72 overflow-y-auto rounded-xl border">
            {preview.rows.map((row) => (
              <div key={row.sourceKey} className="flex justify-between gap-2 border-b p-3 text-xs">
                <span>
                  {row.name} {row.portion}
                  <small className="block text-slate-500">{labels[row.status] ?? row.status}</small>
                </span>
                <strong className="shrink-0">{money(row.priceMinor)}</strong>
              </div>
            ))}
          </div>
          {preview.applied ? (
            <p role="status" className="text-sm text-emerald-800">
              Импорт сохранён. Каталог доступен гостям и сотрудникам.
            </p>
          ) : (
            <button
              className={`${controlClass} w-full bg-slate-900! text-white`}
              disabled={busy}
              onClick={() => void submit("apply")}
            >
              Применить проверенные изменения
            </button>
          )}
        </div>
      )}
      {busy && (
        <p role="status" className="mt-3 text-sm">
          Проверяем каталог…
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}
    </details>
  );
}
