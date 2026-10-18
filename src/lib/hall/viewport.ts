export const PLAN_WIDTH = 1000;
export const PLAN_HEIGHT = 700;

export function boundedView(zoom: number, pan: { x: number; y: number }) {
  const scale = Math.max(1, Math.min(3, zoom));
  const clamp = (value: number, size: number) =>
    Math.max((-size * (scale - 1)) / 2, Math.min((size * (scale - 1)) / 2, value));
  return { zoom: scale, pan: { x: clamp(pan.x, PLAN_WIDTH), y: clamp(pan.y, PLAN_HEIGHT) } };
}
