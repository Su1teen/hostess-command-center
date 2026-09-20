export function ScreenSkeletons() {
  return (
    <div className="space-y-4 px-4 pt-6">
      <div className="h-8 w-48 animate-pulse rounded-xl bg-slate-200" />
      <div className="grid grid-cols-2 gap-3">
        {[1, 2, 3, 4].map((item) => (
          <div key={item} className="h-28 animate-pulse rounded-3xl bg-slate-200" />
        ))}
      </div>
      <div className="h-56 animate-pulse rounded-3xl bg-slate-200" />
      <div className="h-40 animate-pulse rounded-3xl bg-slate-200" />
    </div>
  );
}
