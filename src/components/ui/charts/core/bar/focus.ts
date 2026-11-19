import type { ChartFocusStrategy, ChartPoint } from "@tanstack/charts";

export interface PlotRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface BarFocusInput {
  readonly categories: readonly string[];
  readonly horizontal: boolean;
  /** Read lazily at pointer time (host size changes must not rebuild the definition). */
  readonly plot: () => PlotRect;
}

export function barFocusStrategy<TDatum>(input: BarFocusInput): ChartFocusStrategy<TDatum> {
  type AnyPoint = ChartPoint<TDatum>;
  const { categories, horizontal } = input;
  const categoryOf = (point: AnyPoint): string => String(horizontal ? point.yValue : point.xValue);
  const crossOf = (point: AnyPoint): number => (horizontal ? point.x : point.y);
  const along = (point: AnyPoint): number => (horizontal ? point.y : point.x);
  const byAlong = (a: AnyPoint, b: AnyPoint): number => along(a) - along(b) || crossOf(a) - crossOf(b);
  // The category index of a column is a pure lookup, so the per-category groups are built once per `points` array (the scene's points
  // are stable between pointer moves; a new layout or data hands a new array) instead of filtering and sorting on every move.
  interface Column {
    /** The first candidate of each series group in input order, sorted along / cross: the rest of a group list. */
    readonly sorted: readonly AnyPoint[];
    /** The hovered column's focus list: the keyboard-first point, then the other groups. */
    readonly resolved: readonly AnyPoint[];
  }
  let cachedPoints: readonly AnyPoint[] | null = null;
  let columns = new Map<string, Column>();
  const columnsFor = (points: readonly AnyPoint[]): ReadonlyMap<string, Column> => {
    if (points === cachedPoints) {
      return columns;
    }
    const candidates = new Map<string, AnyPoint[]>();
    for (const point of points) {
      const category = categoryOf(point);
      const list = candidates.get(category);
      if (list === undefined) {
        candidates.set(category, [point]);
      } else {
        list.push(point);
      }
    }
    columns = new Map();
    for (const [category, list] of candidates) {
      let primary = list[0];
      const firstOfGroup = new Map<string, AnyPoint>();
      for (const candidate of list) {
        if (byAlong(candidate, primary) < 0) {
          primary = candidate;
        }
        const key = String(candidate.group);
        if (!firstOfGroup.has(key)) {
          firstOfGroup.set(key, candidate);
        }
      }
      const sorted = [...firstOfGroup.values()].toSorted(byAlong);
      columns.set(category, { sorted, resolved: [primary, ...sorted.filter((p) => String(p.group) !== String(primary.group))] });
    }
    cachedPoints = points;
    return columns;
  };
  // A point's own group list: the point first, then one point per other series group (first in input order), sorted.
  const group = (points: readonly AnyPoint[], point: AnyPoint): readonly AnyPoint[] => {
    const column = columnsFor(points).get(categoryOf(point));
    if (column === undefined) {
      return [point];
    }
    const own = String(point.group);
    return [point, ...column.sorted.filter((p) => String(p.group) !== own)];
  };
  return {
    resolve(points, { x, y }) {
      const plot = input.plot();
      const count = categories.length;
      if (count === 0 || plot.width <= 0 || plot.height <= 0) {
        return [];
      }
      const px = x - plot.left;
      const py = y - plot.top;
      if (px < 0 || py < 0 || px > plot.width || py > plot.height) {
        return [];
      }
      const extent = horizontal ? plot.height : plot.width;
      const pos = horizontal ? py : px;
      const index = Math.max(0, Math.min(count - 1, Math.floor(pos / (extent / count))));
      // The representative is the point keyboard navigation walks (first in along / cross order), not the bar nearest the
      // pointer, so an arrow key after a hover continues from the hovered category.
      return columnsFor(points).get(categories[index])?.resolved ?? [];
    },
    group: (points, { point }) => group(points, point),
    navigation(points) {
      const seen = new Map<string, AnyPoint>();
      for (const p of points.toSorted((a, b) => along(a) - along(b) || crossOf(a) - crossOf(b))) {
        const key = categoryOf(p);
        if (!seen.has(key)) {
          seen.set(key, p);
        }
      }
      return [...seen.values()];
    },
  };
}
