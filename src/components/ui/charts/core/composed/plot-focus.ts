import type { ChartFocusStrategy, ChartPoint } from "@tanstack/charts";
import { navigationPrimary } from "../cartesian/definition";
import type { ChartMargin } from "../theme";
import type { PlotSize } from "../cartesian/plot-size";

type Point = ChartPoint<unknown, Date, number>;

/** A point's row: its x value's time. A SeriesBar rect's point sits at its interval centre, which grouped bars shift off the row's x by their series slot,
 * so focus keys on the row's time, never on the point's pixel x. */
const timeOf = (p: Point): number => (p.xValue instanceof Date ? p.xValue.getTime() : Number(p.xValue));

/** One point per series (`group`) of the row at `time`, `first` leading and the rest in y order (focusGroupX's group). */
function rowPoints(points: readonly Point[], time: number, first: Point): Point[] {
  const byGroup = new Map<unknown, Point>([[first.group, first]]);
  for (const p of points) {
    if (timeOf(p) === time && !byGroup.has(p.group)) {
      byGroup.set(p.group, p);
    }
  }
  return [first, ...[...byGroup.values()].filter((p) => p !== first).toSorted((a, b) => a.y - b.y)];
}

/** bklit's composed tooltip bisects the data rows by x and shows every series of the row (bars, lines and areas); group-x keyed on point pixels split a row
 * of grouped bars, whose rect points sit left and right of the row's x. This keys focus, its group and keyboard navigation on the row's time.
 * Only inside the plot rect (bklit's hover overlay is the plot only: no tooltip, dim or pill over the margins or the tick-label row). */
export function plotFocusOf(margin: Readonly<ChartMargin>, size: () => PlotSize, xDomain: () => readonly [Date, Date] | undefined): ChartFocusStrategy {
  const inPlot = (x: number, y: number): boolean => {
    const { innerWidth, innerHeight } = size();
    return x >= margin.left && x <= margin.left + innerWidth && y >= margin.top && y <= margin.top + Math.max(0, innerHeight);
  };
  const strategy: ChartFocusStrategy<unknown, Date, number> = {
    resolve: (points, ctx) => {
      const domain = xDomain();
      const { innerWidth } = size();
      if (!inPlot(ctx.x, ctx.y) || domain === undefined || innerWidth <= 0) {
        return [];
      }
      const start = domain[0].getTime();
      const msPerPx = (domain[1].getTime() - start) / innerWidth;
      const pointer = start + (ctx.x - margin.left) * msPerPx;
      // bklit's bisectDate (x0 - d0 > d1 - x0) keeps the lower row on an exact midpoint tie: equal distances (within float noise) go to the earlier time.
      const tie = msPerPx * 1e-6;
      let best = Number.NaN;
      let distance = Number.POSITIVE_INFINITY;
      for (const p of points) {
        const t = timeOf(p);
        const d = Math.abs(t - pointer);
        if (Number.isFinite(t) && (d < distance - tie || (Math.abs(d - distance) <= tie && t < best))) {
          best = t;
          distance = d;
        }
      }
      const row = points.filter((p) => timeOf(p) === best);
      if (row.length === 0) {
        return [];
      }
      const primary = row.reduce((closest, p) => (Math.abs(p.y - ctx.y) < Math.abs(closest.y - ctx.y) ? p : closest));
      return navigationPrimary(rowPoints(row, best, primary), points);
    },
    group: (points, { point }) => rowPoints(points, timeOf(point), point),
    // One stop per row, its topmost point first (focusGroupX's (x, y) order), which `navigationPrimary` resumes from after a hover.
    navigation: (points) => {
      const firstOfRow = new Map<number, Point>();
      for (const p of points.toSorted((a, b) => timeOf(a) - timeOf(b) || a.y - b.y)) {
        if (!firstOfRow.has(timeOf(p))) {
          firstOfRow.set(timeOf(p), p);
        }
      }
      return [...firstOfRow.values()];
    },
  };
  // SAFETY: the composed definition's points are ChartPoint<Row, Date, number>; the strategy reads only their time, y and group.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
  return strategy as ChartFocusStrategy;
}
