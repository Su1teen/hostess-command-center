import { useEffect, useState, type ReactNode } from "react";
export function StaffGate({ children }: { children: ReactNode }) {
  const [staff, setStaff] = useState<{ id: string; role: string } | null>(null),
    [checking, setChecking] = useState(true),
    [error, setError] = useState(""),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [pending, setPending] = useState(false);
  useEffect(() => {
    let active = true;
    void fetch("/api/staff/v1/me", { cache: "no-store" })
      .then(async (r) => {
        if (r.ok && active) setStaff((await r.json()).staff);
      })
      .catch(() => {
        if (active) setError("Сервис входа недоступен");
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, []);
  if (checking)
    return (
      <p className="p-6" role="status">
        Проверяем доступ сотрудника…
      </p>
    );
  if (staff)
    return (
      <>
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-2 text-xs text-slate-500">
          <span>
            {staff.id} · {staff.role}
          </span>
          <button
            className="min-h-11 px-3"
            onClick={() => {
              void fetch("/api/staff/v1/logout", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "{}",
              }).then((r) => {
                if (r.ok) {
                  setStaff(null);
                  location.reload();
                }
              });
            }}
          >
            Выйти
          </button>
        </div>
        {children}
      </>
    );
  return (
    <div className="mx-auto max-w-sm px-5 py-16">
      <p className="text-xs uppercase tracking-widest text-slate-500">Hostess Command Center</p>
      <h1 className="mt-4 text-3xl font-semibold">Вход сотрудника</h1>
      <form
        className="mt-8 space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          setError("");
          try {
            const r = await fetch("/api/staff/v1/login", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ username, password }),
            });
            const data = await r.json();
            if (!r.ok) throw new Error(data.error?.message ?? "Вход недоступен");
            setPassword("");
            setStaff(data.staff);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Вход недоступен");
          } finally {
            setPending(false);
          }
        }}
      >
        <label className="block text-sm">
          Логин
          <input
            required
            autoComplete="username"
            className="mt-2 min-h-12 w-full rounded-xl border px-3"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          Пароль
          <input
            required
            type="password"
            autoComplete="current-password"
            className="mt-2 min-h-12 w-full rounded-xl border px-3"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <button
          disabled={pending}
          className="min-h-12 w-full rounded-xl bg-slate-900 text-white disabled:opacity-50"
        >
          {pending ? "Входим…" : "Войти"}
        </button>
      </form>
    </div>
  );
}
