import { addDaysToDateKey, almatyDateKey, almatyTimeKey, almatyToIso } from "../formatters/time";

/** A service day belongs to the evening on which it started, including 00:00–03:59. */
export function operationalDate(instant: string | Date = new Date()): string {
  const date = almatyDateKey(instant);
  return almatyTimeKey(instant) < "04:00" ? addDaysToDateKey(date, -1) : date;
}

export function operationalWindow(date: string) {
  return {
    startsAt: almatyToIso(date, "17:00"),
    endsAt: almatyToIso(addDaysToDateKey(date, 1), "04:00"),
  };
}

export interface TimedInterval {
  id: string;
  startsAt: string;
  endsAt: string | null;
}

/** Half-open intervals that touch are consecutive, never a conflict. */
export function timelineLanes<T extends TimedInterval>(events: T[], windowEnd: string) {
  const ends: number[] = [];
  return [...events]
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id))
    .map((event) => {
      const start = Date.parse(event.startsAt);
      const end = Date.parse(event.endsAt ?? windowEnd);
      let lane = ends.findIndex((value) => value <= start);
      if (lane === -1) lane = ends.length;
      ends[lane] = end;
      return { event, lane };
    });
}

export function intervalPosition(event: TimedInterval, startsAt: string, endsAt: string) {
  const start = Date.parse(startsAt),
    end = Date.parse(endsAt);
  const left = Math.max(start, Date.parse(event.startsAt));
  const right = Math.min(end, Date.parse(event.endsAt ?? endsAt));
  if (right <= left) return null;
  return {
    left: ((left - start) / (end - start)) * 100,
    width: ((right - left) / (end - start)) * 100,
  };
}

export interface MapPosition {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  shape: string;
}
export function schematicPosition(index: number): MapPosition {
  return {
    x: 40 + (index % 4) * 180,
    y: 50 + Math.floor(index / 4) * 150,
    width: 140,
    height: 90,
    rotation: 0,
    shape: "rect",
  };
}

/** Conservative rotated bounds: layout editing never silently hides an overlap. */
export function layoutOverlaps(resources: { id: string; layout: MapPosition }[]): string[] {
  const bounds = ({ layout: p }: { layout: MapPosition }) => {
    const radians = (p.rotation * Math.PI) / 180;
    const width = Math.abs(p.width * Math.cos(radians)) + Math.abs(p.height * Math.sin(radians));
    const height = Math.abs(p.width * Math.sin(radians)) + Math.abs(p.height * Math.cos(radians));
    return { x: p.x + (p.width - width) / 2, y: p.y + (p.height - height) / 2, width, height };
  };
  const conflicts = new Set<string>();
  for (let a = 0; a < resources.length; a++)
    for (let b = a + 1; b < resources.length; b++) {
      const first = bounds(resources[a]),
        second = bounds(resources[b]);
      if (
        first.x < second.x + second.width &&
        first.x + first.width > second.x &&
        first.y < second.y + second.height &&
        first.y + first.height > second.y
      ) {
        conflicts.add(resources[a].id);
        conflicts.add(resources[b].id);
      }
    }
  return [...conflicts];
}
