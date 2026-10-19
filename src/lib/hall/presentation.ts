import type { FloorResource, FloorState } from "../floor-operations";
import { schematicPosition, type MapPosition } from "./operations";

export const OCCUPANCY_COLOR = { free: "#86bba7", booked: "#93b6dc", seated: "#d5af65" };

export const FLOOR_STATE_LABEL: Record<FloorState, string> = {
  free: "Свободен",
  reserved: "Забронирован",
  seated: "Гости на месте",
  qr_activity: "Ожидается заказ · посадка не подтверждена",
  overdue: "Время визита превышено",
  blocked: "Вне обслуживания",
  unconfigured: "Бронирование отключено",
};
export const FLOOR_STATE_STYLE: Record<
  FloorState,
  { fill: string; stroke: string; text: string; mark: string }
> = {
  free: { fill: "#ecfdf5", stroke: "#86bba7", text: "#16634b", mark: "○" },
  reserved: { fill: "#eff6ff", stroke: "#93b6dc", text: "#254f82", mark: "◷" },
  seated: { fill: "#fffbeb", stroke: "#d5af65", text: "#855517", mark: "●" },
  qr_activity: { fill: "#f5f3ff", stroke: "#b6a0de", text: "#654491", mark: "↗" },
  overdue: { fill: "#fff1f2", stroke: "#e5a2aa", text: "#9f3448", mark: "!" },
  blocked: { fill: "#f1f5f9", stroke: "#b6c1ce", text: "#526172", mark: "−" },
  unconfigured: { fill: "#fff7ed", stroke: "#deb58a", text: "#9a562c", mark: "?" },
};

export function resourcePosition(resource: FloorResource, index: number): MapPosition {
  const fallback = schematicPosition(index),
    layout = resource.layout;
  return {
    x: layout.x ?? fallback.x,
    y: layout.y ?? fallback.y,
    width: layout.width ?? 140,
    height: layout.height ?? 90,
    shape: layout.shape ?? "rectangle",
    rotation: layout.rotation ?? 0,
  };
}
