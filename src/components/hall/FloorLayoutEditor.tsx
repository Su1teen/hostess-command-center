import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { staffApi, controlClass } from "../../lib/dine-in-client";
import type { FloorLayoutInput, FloorZone } from "../../lib/floor-operations";
import { layoutOverlaps, type MapPosition } from "../../lib/hall/operations";
import { FloorPlan } from "./FloorPlan";
import { resourcePosition } from "../../lib/hall/presentation";

export function FloorLayoutEditor({
  zone: incomingZone,
  onDone,
}: {
  zone: FloorZone;
  onDone: () => void;
}) {
  // Keep draft membership and versions together; background inventory changes are
  // rejected by the server instead of introducing resources without draft positions.
  const zone = useRef(incomingZone).current;
  const originalResources = useRef(zone.resources);
  const saved = useRef(
    Object.fromEntries(
      zone.resources.map((resource, index) => [resource.id, resourcePosition(resource, index)]),
    ),
  );
  const [positions, setPositions] = useState<Record<string, MapPosition>>(saved.current),
    [selected, setSelected] = useState<string | null>(zone.resources[0]?.id ?? null);
  const client = useQueryClient(),
    key = useRef(crypto.randomUUID());
  const conflicts = useMemo(
    () =>
      layoutOverlaps(
        zone.resources.map((resource) => ({ id: resource.id, layout: positions[resource.id] })),
      ),
    [positions, zone.resources],
  );
  const mutation = useMutation({
    mutationFn: () =>
      staffApi("/floor/layout", {
        method: "PATCH",
        body: JSON.stringify({
          zoneId: zone.id,
          resources: zone.resources.map((resource) => ({
            resourceId: resource.id,
            version: originalResources.current.find((item) => item.id === resource.id)!.layout
              .version,
            ...positions[resource.id],
            shape: positions[resource.id].shape === "round" ? "round" : "rectangle",
          })),
          idempotencyKey: key.current,
        } satisfies FloorLayoutInput),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["floor"] });
      onDone();
    },
  });
  const position = selected ? positions[selected] : null;
  function update(value: Partial<MapPosition>) {
    if (selected && position)
      setPositions((previous) => ({ ...previous, [selected]: { ...position, ...value } }));
  }
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold">Редактирование плана · {zone.name}</h2>
        <p className="mt-1 text-xs text-slate-500">
          Координаты относятся только к этой зоне. Сохранение проверяет версию плана и пересечения
          столов.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={mutation.isPending || !!conflicts.length || !zone.resources.length}
            className={`${controlClass} bg-slate-900! text-white`}
            onClick={() => mutation.mutate()}
          >
            Сохранить план
          </button>
          <button
            type="button"
            disabled={mutation.isPending}
            className={controlClass}
            onClick={() => setPositions(saved.current)}
          >
            Восстановить сохранённый
          </button>
          <button
            type="button"
            disabled={mutation.isPending}
            className={controlClass}
            onClick={onDone}
          >
            Отменить изменения
          </button>
        </div>
        {!!conflicts.length && (
          <p role="alert" className="mt-3 text-xs text-amber-900">
            Столы пересекаются:{" "}
            {zone.resources
              .filter((resource) => conflicts.includes(resource.id))
              .map((resource) => resource.name)
              .join(", ")}
            . Раздвиньте их перед сохранением.
          </p>
        )}
        {mutation.error && (
          <p role="alert" className="mt-3 text-sm text-red-800">
            {mutation.error.message} При конфликте версий отмените изменения и обновите карту.
          </p>
        )}
      </div>
      <FloorPlan
        zoneName={zone.name}
        resources={zone.resources}
        selectedId={selected}
        onSelect={setSelected}
        editing
        positions={positions}
        onPosition={(id, value) => setPositions((previous) => ({ ...previous, [id]: value }))}
      />
      {position && (
        <section className="rounded-xl border bg-white p-4" aria-label="Настройки положения стола">
          <h3 className="mb-3 text-sm font-semibold">
            {zone.resources.find((resource) => resource.id === selected)?.name}
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {(
              [
                ["x", "Позиция X", 0, 1000 - position.width],
                ["y", "Позиция Y", 0, 700 - position.height],
                ["width", "Ширина", 40, 240],
                ["height", "Высота", 40, 240],
                ["rotation", "Поворот", 0, 359],
              ] as const
            ).map(([field, label, min, max]) => (
              <label key={field} className="text-xs text-slate-600">
                {label}
                <input
                  type="number"
                  min={min}
                  max={max}
                  value={position[field]}
                  className={`${controlClass} mt-1 w-full`}
                  onChange={(e) =>
                    update({ [field]: Math.min(max, Math.max(min, Number(e.target.value))) })
                  }
                />
              </label>
            ))}
            <label className="text-xs text-slate-600">
              Форма
              <select
                className={`${controlClass} mt-1 w-full`}
                value={position.shape === "round" ? "round" : "rectangle"}
                onChange={(e) => update({ shape: e.target.value })}
              >
                <option value="rectangle">Прямоугольник</option>
                <option value="round">Круг</option>
              </select>
            </label>
          </div>
        </section>
      )}
    </div>
  );
}
