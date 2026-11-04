import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Wifi } from "lucide-react";
import { staffApi, useStaffRole, controlClass, dateTime } from "../../lib/dine-in-client";

type WifiSettingsValue = {
  ssid: string;
  password: string;
  security: "WPA" | "WEP" | "nopass";
  hidden: boolean;
  enabled: boolean;
  version: number;
  updatedAt: string;
  updatedBy: string | null;
};
const empty = { ssid: "", password: "", security: "WPA" as const, hidden: false, enabled: true };

/** Guest Wi-Fi shown on the Hostess dining page (QR on every table). */
export function WifiSettings() {
  const manager = useStaffRole() === "manager",
    client = useQueryClient();
  const query = useQuery({
    queryKey: ["venue-wifi"],
    queryFn: () => staffApi<{ wifi: WifiSettingsValue | null }>("/dine-in/wifi"),
  });
  const saved = query.data?.wifi ?? null;
  const [draft, setDraft] =
    useState<Omit<WifiSettingsValue, "version" | "updatedAt" | "updatedBy">>(empty);
  const [show, setShow] = useState(false),
    [done, setDone] = useState(false);
  useEffect(() => {
    if (saved) setDraft(saved);
  }, [saved]);
  const mutation = useMutation({
    mutationFn: () =>
      staffApi<{ wifi: WifiSettingsValue }>("/dine-in/wifi", {
        method: "PUT",
        body: JSON.stringify({ ...draft, version: saved?.version ?? null }),
      }),
    onSuccess: (data) => {
      client.setQueryData(["venue-wifi"], data);
      setDone(true);
    },
  });
  const change = (patch: Partial<typeof draft>) => {
    setDone(false);
    setDraft((previous) => ({ ...previous, ...patch }));
  };
  const dirty =
    !saved ||
    (["ssid", "password", "security", "hidden", "enabled"] as const).some(
      (k) => saved[k] !== draft[k],
    );
  const spaces = /\s{2,}|^\s|\s$/.test(draft.ssid);
  // Mirrors the server rules so a manager sees the reason before saving.
  const problem = !draft.ssid
    ? "Укажите название сети"
    : new TextEncoder().encode(draft.ssid).length > 32
      ? "Название сети длиннее 32 байт"
      : draft.security === "WPA" && (draft.password.length < 8 || draft.password.length > 63)
        ? "Пароль WPA: от 8 до 63 символов"
        : draft.security === "WEP" && ![5, 10, 13, 26].includes(draft.password.length)
          ? "Пароль WEP: 5, 10, 13 или 26 символов"
          : null;
  return (
    <section
      className="rounded-2xl border border-slate-200/80 bg-white p-4 sm:p-5"
      aria-label="Wi-Fi для гостей"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-slate-100">
            <Wifi size={18} />
          </span>
          <div>
            <h2 className="font-semibold">Wi-Fi для гостей</h2>
            <p className="mt-1 text-sm text-slate-500">
              Гости видят сеть и пароль на странице стола после сканирования QR и могут подключиться
              в одно нажатие.
            </p>
          </div>
        </div>
        {saved && (
          <p className="text-xs text-slate-400">
            Изменено {dateTime(saved.updatedAt)}
            {saved.updatedBy ? ` · ${saved.updatedBy.replace(/^staff:/, "")}` : ""}
          </p>
        )}
      </div>
      {query.isPending ? (
        <p role="status" className="mt-4 text-sm text-slate-500">
          Загружаем настройки…
        </p>
      ) : query.error ? (
        <p role="alert" className="mt-4 text-sm text-red-700">
          {query.error.message}
        </p>
      ) : (
        <form
          className="mt-4 grid gap-4 md:grid-cols-[1.4fr_1fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <label className="text-sm font-medium text-slate-700">
            Название сети
            <input
              className={`${controlClass} mt-1.5 w-full font-mono`}
              value={draft.ssid}
              disabled={!manager}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => change({ ssid: e.target.value })}
            />
            <span className="mt-1 block text-xs font-normal text-slate-500">
              Точно как в телефоне, включая пробелы и регистр.
              {spaces && " Здесь двойной пробел или пробел по краю: проверьте, что так и задумано."}
            </span>
          </label>
          <label className="text-sm font-medium text-slate-700">
            Пароль
            <span className="mt-1.5 flex gap-2">
              <input
                className={`${controlClass} w-full font-mono`}
                type={show ? "text" : "password"}
                value={draft.password}
                disabled={!manager || draft.security === "nopass"}
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => change({ password: e.target.value })}
              />
              <button
                type="button"
                className={controlClass}
                aria-label={show ? "Скрыть пароль" : "Показать пароль"}
                onClick={() => setShow(!show)}
              >
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </span>
            <select
              className={`${controlClass} mt-2 w-full`}
              aria-label="Защита сети"
              value={draft.security}
              disabled={!manager}
              onChange={(e) =>
                change({
                  security: e.target.value as typeof draft.security,
                  ...(e.target.value === "nopass" ? { password: "" } : {}),
                })
              }
            >
              <option value="WPA">WPA / WPA2 / WPA3</option>
              <option value="WEP">WEP (устаревшая)</option>
              <option value="nopass">Открытая сеть без пароля</option>
            </select>
          </label>
          <div className="flex flex-col justify-between gap-3 text-sm">
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                checked={draft.enabled}
                disabled={!manager}
                onChange={(e) => change({ enabled: e.target.checked })}
              />
              Показывать гостям
            </label>
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                checked={draft.hidden}
                disabled={!manager}
                onChange={(e) => change({ hidden: e.target.checked })}
              />
              Скрытая сеть
            </label>
            {manager && (
              <button
                type="submit"
                disabled={!dirty || !!problem || mutation.isPending}
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-900 px-4 font-medium text-white disabled:opacity-40"
              >
                {mutation.isPending ? "Сохраняем…" : "Сохранить"}
              </button>
            )}
          </div>
          {manager && dirty && problem && (
            <p role="alert" className="text-sm text-amber-700 md:col-span-3">
              {problem}
            </p>
          )}
          {!manager && (
            <p className="text-xs text-slate-500 md:col-span-3">Изменять Wi-Fi может менеджер.</p>
          )}
          {mutation.error && (
            <p role="alert" className="text-sm text-red-700 md:col-span-3">
              {mutation.error.message}
            </p>
          )}
          {done && !mutation.error && (
            <p role="status" className="text-sm text-emerald-700 md:col-span-3">
              Сохранено. Гости увидят новые данные при следующем открытии страницы стола.
            </p>
          )}
        </form>
      )}
    </section>
  );
}
