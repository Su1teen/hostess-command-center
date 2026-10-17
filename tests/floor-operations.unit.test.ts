import { describe, expect, test } from "bun:test";
import {
  intervalPosition,
  layoutOverlaps,
  operationalDate,
  operationalWindow,
  timelineLanes,
} from "../src/lib/hall/operations";

describe("floor operational time independent from browser timezone", () => {
  test("17:00 through 03:59 belongs to the same evening", () => {
    for (const instant of [
      "2026-10-17T17:00:00+05:00",
      "2026-10-18T00:30:00+05:00",
      "2026-10-18T03:59:59+05:00",
    ]) {
      expect(operationalDate(instant)).toBe("2026-10-17");
    }
    expect(operationalDate("2026-10-18T04:00:00+05:00")).toBe("2026-10-18");
  });
  test("year transition and 17→04 window use Almaty offsets", () => {
    expect(operationalDate("2027-01-01T00:30:00+05:00")).toBe("2026-12-31");
    expect(operationalWindow("2026-12-31")).toEqual({
      startsAt: "2026-12-31T12:00:00.000Z",
      endsAt: "2026-12-31T23:00:00.000Z",
    });
  });
});

describe("timeline preserves concurrent evidence and day boundaries", () => {
  const event = (id: string, startsAt: string, endsAt: string | null) => ({ id, startsAt, endsAt });
  const start = "2026-10-17T12:00:00.000Z",
    end = "2026-10-17T23:00:00.000Z";
  test("current 17:00 visit and future 19:00 reservation remain separate", () => {
    const result = timelineLanes(
      [
        event("visit", start, "2026-10-17T13:30:00.000Z"),
        event("booking", "2026-10-17T14:00:00.000Z", "2026-10-17T16:00:00.000Z"),
      ],
      end,
    );
    expect(result.map((item) => item.event.id)).toEqual(["visit", "booking"]);
    expect(result.map((item) => item.lane)).toEqual([0, 0]);
  });
  test("overlap has separate lanes; touching half-open intervals reuse a lane", () => {
    const result = timelineLanes(
      [
        event("booking", "2026-10-17T14:00:00.000Z", "2026-10-17T16:00:00.000Z"),
        event("visit", start, "2026-10-17T15:00:00.000Z"),
        event("next", "2026-10-17T16:00:00.000Z", end),
      ],
      end,
    );
    expect(result.map((item) => item.lane)).toEqual([0, 1, 0]);
  });
  test("ongoing visit occupies a lane until window end", () => {
    expect(
      timelineLanes(
        [event("open", start, null), event("later", "2026-10-17T14:00:00.000Z", end)],
        end,
      ).map((item) => item.lane),
    ).toEqual([0, 1]);
  });
  test("events outside selected service day are excluded and crossing events are clipped", () => {
    expect(
      intervalPosition(event("past", "2026-10-16T12:00:00Z", "2026-10-16T23:00:00Z"), start, end),
    ).toBeNull();
    expect(intervalPosition(event("next", end, "2026-10-18T01:00:00Z"), start, end)).toBeNull();
    expect(
      intervalPosition(event("cross", "2026-10-17T11:00:00Z", "2026-10-18T00:00:00Z"), start, end),
    ).toEqual({ left: 0, width: 100 });
  });
});

describe("floor layout overlap validation", () => {
  const item = (id: string, x: number, rotation = 0) => ({
    id,
    layout: { x, y: 0, width: 100, height: 100, rotation, shape: "rectangle" },
  });
  test("touching edges are valid; actual overlap identifies both resources", () => {
    expect(layoutOverlaps([item("a", 0), item("b", 100)])).toEqual([]);
    expect(layoutOverlaps([item("a", 0), item("b", 99)])).toEqual(["a", "b"]);
  });
  test("rotated tables use conservative visual bounds", () => {
    expect(layoutOverlaps([item("a", 0, 45), item("b", 110)])).toEqual(["a", "b"]);
  });
});
