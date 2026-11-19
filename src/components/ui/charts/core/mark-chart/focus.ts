import type { ChartFocusStrategy, ChartPoint } from "@tanstack/charts";
import type { MarkDatum, MarkHit } from "./types";

type Point = ChartPoint<MarkDatum, number, number>;

/** Even-odd containment in a polygon. */
const inPolygon = (points: readonly (readonly [number, number])[], x: number, y: number): boolean => {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i] as readonly [number, number];
    const [xj, yj] = points[j] as readonly [number, number];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
};

/** Whether `hit` contains the scene point (x, y). */
export const hitContains = (hit: MarkHit, x: number, y: number): boolean => {
  switch (hit.kind) {
    case "rect":
      return x >= hit.x0 && x <= hit.x1 && y >= hit.y0 && y <= hit.y1;
    case "circle":
      return (x - hit.cx) ** 2 + (y - hit.cy) ** 2 <= hit.r ** 2;
    case "band":
      return inPolygon(hit.points, x, y);
    case "rects":
      return hit.rects.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
    default:
      return false;
  }
};

/** The topmost item at (x, y), if any. */
export const itemAt = <Datum extends MarkDatum>(points: readonly Datum[], x: number, y: number): Datum | null => {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const datum = points[index] as Datum;
    if (hitContains(datum.hit, x, y)) {
      return datum;
    }
  }
  return null;
};

export const MARK_FOCUS: ChartFocusStrategy<MarkDatum, number, number> = {
  group: (_points, context) => [context.point],
  navigation: (points) => points,
  resolve: (points, { x, y }) => {
    for (let index = points.length - 1; index >= 0; index -= 1) {
      const point = points[index] as Point;
      if (hitContains(point.datum.hit, x, y)) {
        return [point];
      }
    }
    return [];
  },
};
