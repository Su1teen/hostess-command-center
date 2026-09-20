export function LastUpdated({ generatedAt }: { generatedAt: string }) {
  return (
    <p className="text-xs text-slate-500">
      Обновлено{" "}
      {new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(
        new Date(generatedAt),
      )}{" "}
      · авто каждые 20 с
    </p>
  );
}
