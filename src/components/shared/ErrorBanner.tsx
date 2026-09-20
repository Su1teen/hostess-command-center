export function ErrorBanner({ children = "Нет связи с базой данных" }: { children?: string }) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      {children}
    </div>
  );
}
