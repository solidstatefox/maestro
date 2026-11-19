import type { ChartFocusStrategy, ChartPoint } from "@tanstack/charts";
import type { RadarRow } from "./rows";

type RadarPoint = ChartPoint<RadarRow, string | number, number>;
type Vertex = readonly [number, number];

const EPS = 1e-6;
const LABEL_REACH = 22;
// bklit hit-tests the scaled (1.05x) hovered group, so the hovered series keeps focus out to its scaled outline. motion scales the
// group about the centre of its fill-box (`transform-box: fill-box; transform-origin: 50% 50%`), i.e. its vertex bounding box.
const HOVER_SCALE = 1.05;

// bklit hovers the series group: fill + stroke (2, hovered 3) + dots (r 4, hovered 6, plus their 2px stroke), so a pointer on a
// vertex dot or an edge stroke outside the fill still hovers the series.
const STROKE_REST = 2;
const STROKE_HOT = 3;
const DOT_REST = 4;
const DOT_HOT = 6;
const DOT_STROKE = 2;

interface RadarHitShape {
  readonly showPoints: boolean;
  readonly showStroke: boolean;
}

const distanceToSegment = (a: Vertex, b: Vertex, x: number, y: number): number => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / length));
  return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
};

const onSegment = (a: Vertex, b: Vertex, p: Vertex): boolean =>
  Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) <= EPS &&
  (p[0] - a[0]) * (p[0] - b[0]) + (p[1] - a[1]) * (p[1] - b[1]) <= EPS;

const inside = (polygon: readonly Vertex[], x: number, y: number): boolean => {
  let hit = false;
  let prev = polygon.at(-1);
  for (const next of polygon) {
    if (prev) {
      if (onSegment(prev, next, [x, y])) { return true; }
      if ((prev[1] > y) !== (next[1] > y) && x < ((next[0] - prev[0]) * (y - prev[1])) / (next[1] - prev[1]) + prev[0]) { hit = !hit; }
    }
    prev = next;
  }
  return hit;
};

export type { RadarHitShape };
export const createRadarFocus = (metricKeys: readonly string[], shapes: ReadonlyMap<number, RadarHitShape>): ChartFocusStrategy<RadarRow, string | number, number> => {
  const order = new Map(metricKeys.map((key, index) => [key, index]));
  const cache = new WeakMap<readonly RadarPoint[], Map<number, Vertex[]>>();
  const polygonsOf = (points: readonly RadarPoint[]): Map<number, Vertex[]> => {
    const hit = cache.get(points);
    if (hit) { return hit; }
    const byMetric = new Map<number, Map<string, Vertex>>();
    for (const point of points) {
      const { metric, series } = point.datum;
      if (series >= 0) {
        const bucket = byMetric.get(series) ?? new Map<string, Vertex>();
        bucket.set(metric, [point.x, point.y]);
        byMetric.set(series, bucket);
      }
    }
    const out = new Map<number, Vertex[]>();
    for (const [series, bucket] of byMetric) {
      out.set(series, [...bucket.entries()].sort((l, r) => (order.get(l[0]) ?? 0) - (order.get(r[0]) ?? 0)).map(([, v]) => v));
    }
    cache.set(points, out);
    return out;
  };
  let current: number | null = null;
  const scaled = (polygon: readonly Vertex[]): Vertex[] => {
    const xs = polygon.map((v) => v[0]);
    const ys = polygon.map((v) => v[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    return polygon.map(([vx, vy]) => [cx + (vx - cx) * HOVER_SCALE, cy + (vy - cy) * HOVER_SCALE]);
  };
  const hits = (series: number, polygon: readonly Vertex[], x: number, y: number): boolean => {
    const hot = series === current;
    const shape = shapes.get(series);
    const region = hot ? scaled(polygon) : polygon;
    if (inside(region, x, y)) { return true; }
    const scale = hot ? HOVER_SCALE : 1;
    if (shape?.showStroke !== false) {
      const reach = ((hot ? STROKE_HOT : STROKE_REST) / 2) * scale;
      let prev = region.at(-1);
      for (const next of region) {
        if (prev && distanceToSegment(prev, next, x, y) <= reach) { return true; }
        prev = next;
      }
    }
    if (shape?.showPoints !== false) {
      const reach = ((hot ? DOT_HOT : DOT_REST) + DOT_STROKE / 2) * scale;
      return region.some((vertex) => Math.hypot(vertex[0] - x, vertex[1] - y) <= reach);
    }
    return false;
  };
  const ofSeries = (points: readonly RadarPoint[], series: number): RadarPoint[] => points.filter((p) => p.datum.series === series);
  return {
    group: (points, { point }) => ofSeries(points, point.datum.series),
    // Hover and focus are per series (the whole polygon), so keyboard steps one stop per series, not per vertex: a per-vertex stop
    // would re-focus the same series and show no change. Each series' first vertex is its stop.
    navigation: (points) => {
      const first = new Map<number, RadarPoint>();
      for (const point of points) {
        const { metric, series } = point.datum;
        if (series >= 0 && point.markId.includes("radar:area-")) {
          const held = first.get(series);
          if (!held || (order.get(metric) ?? 0) < (order.get(held.datum.metric) ?? 0)) { first.set(series, point); }
        }
      }
      return [...first.values()].toSorted((l, r) => l.datum.series - r.datum.series);
    },
    resolve: (points, { x, y }) => {
      const polygons = polygonsOf(points);
      for (const series of [...polygons.keys()].sort((l, r) => r - l)) {
        const polygon = polygons.get(series);
        if (polygon && hits(series, polygon, x, y)) { current = series; return ofSeries(points, series); }
      }
      current = null;
      // Interactive axis labels: the pointer within reach of a label resolves to that label.
      let best: RadarPoint | undefined = undefined;
      let bestDistance = LABEL_REACH;
      for (const point of points) {
        const distance = point.markId === "radar:axis-labels" ? Math.hypot(point.x - x, point.y - y) : Number.POSITIVE_INFINITY;
        if (distance <= bestDistance) { best = point; bestDistance = distance; }
      }
      return best ? [best] : [];
    },
  };
};
