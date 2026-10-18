import { describe, expect, test } from "bun:test";
import { boundedView, PLAN_WIDTH, PLAN_HEIGHT } from "../src/lib/hall/viewport";

describe("floor viewport stays inside the room", () => {
  test("fit view cannot pan into empty space", () => {
    expect(boundedView(1, { x: 9000, y: -9000 })).toEqual({ zoom: 1, pan: { x: 0, y: -0 } });
    expect(boundedView(0.1, { x: 4, y: 5 }).zoom).toBe(1);
  });
  test("pinching and dragging are bounded at every zoom", () => {
    for (const zoom of [1, 1.1, 1.5, 2, 3, 9]) {
      const view = boundedView(zoom, { x: 100000, y: -100000 });
      expect(view.zoom).toBeLessThanOrEqual(3);
      expect(Math.abs(view.pan.x)).toBeLessThanOrEqual((PLAN_WIDTH * (view.zoom - 1)) / 2);
      expect(Math.abs(view.pan.y)).toBeLessThanOrEqual((PLAN_HEIGHT * (view.zoom - 1)) / 2);
      expect(boundedView(1, view.pan).pan.x).toBe(0);
    }
  });
});
