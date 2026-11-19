import type { ChartPoint } from "@tanstack/charts";
import { focusNearestX } from "@tanstack/charts/focus";
import { scaleBand } from "@tanstack/charts/scales/band";
import { fittingCategories, fittingValueTicks } from "../axis-fit";
import { propsFor } from "../carriers/table";
import type { ChildTable } from "../carriers/table";
import type { GridGuideProps } from "../cartesian/grid-guides";
import type { HoverOverlayModel, OverlayDot, OverlayPlot } from "../cartesian/hover-overlay";
import type { Row } from "../cartesian/series";
import { scaleLinear } from "../scales";
import { DEFAULT_MARGIN } from "../theme";
import type { ChartMargin } from "../theme";
import type { TooltipBoxMotionProps } from "../tooltip/box-motion";
import type { BarXAxisProps, BarYAxisProps } from "../types/bar";
import { categoryAxis, categoryDomain, scaleGrid, valueAxis, valueFormat } from "./definition";
import type { SkeletonShape, SkeletonSize } from "./loading";
import type { PlotChrome, PlotSizeStore } from "./types";

/** `ChartTooltip`'s chrome props a category chart reads. */
export interface CategoryTooltipProps extends TooltipBoxMotionProps {
  readonly showCrosshair?: boolean;
  readonly showDots?: boolean;
  readonly showDatePill?: boolean;
  readonly dotSize?: number;
  readonly dotStrokeWidth?: number;
  readonly indicatorDasharray?: string;
}

/** The carriers every category chart reads. */
export interface CategoryCarriers {
  readonly grid: GridGuideProps | undefined;
  readonly xAxis: BarXAxisProps | undefined;
  readonly yAxis: BarYAxisProps | undefined;
  readonly tooltip: CategoryTooltipProps | undefined;
}

export const categoryCarriers = (table: ChildTable): CategoryCarriers => ({
  grid: propsFor<GridGuideProps>(table, "grid").at(0),
  xAxis: propsFor<BarXAxisProps>(table, "barXAxis").at(0),
  yAxis: propsFor<BarYAxisProps>(table, "barYAxis").at(0),
  tooltip: propsFor<CategoryTooltipProps>(table, "tooltip").at(0),
});

/** One category chart's frame. */
export interface CategoryFrame {
  readonly count: number;
  readonly labels: readonly string[];
  readonly horizontal: boolean;
  /** The band padding (bklit's bar gap). */
  readonly padding: number;
  readonly margin: ChartMargin;
  /** The value domain, niced: the definition and the chrome place by the same one. */
  readonly domain: readonly [number, number];
}

/** The frame's margin: bklit's 40px all round, the reader's over it. */
export const categoryMargin = (margin: Partial<ChartMargin> | undefined): ChartMargin => ({ ...DEFAULT_MARGIN, ...margin });

/** Category `index`'s band centre within the plot, at a category axis `inner` px long. */
export const bandCenter = (frame: CategoryFrame, index: number, inner: number): number => {
  const scale = scaleBand<string>().domain(categoryDomain(frame.count)).range([0, inner]).padding(frame.padding);
  return (scale(String(index)) ?? 0) + scale.bandwidth() / 2;
};

/** A category's bandwidth within the plot. */
export const bandWidth = (frame: CategoryFrame, inner: number): number =>
  scaleBand<string>().domain(categoryDomain(frame.count)).range([0, inner]).padding(frame.padding).bandwidth();

/** A value's position within the plot along the value axis (`inner` px long): from the bottom (vertical) or the left (horizontal). */
export const valueOffset = (frame: CategoryFrame, value: number, inner: number): number => {
  const [lo, hi] = frame.domain;
  const t = (value - lo) / (hi - lo || 1);
  return frame.horizontal ? t * inner : inner - t * inner;
};

/** The two scales: categories (the row indices as strings, labelled) and values (`frame.domain`), on the sides the orientation puts them.
 * The value ticks take the value axis' `formatValue`, else `format` (the series'), else bklit's. In a chart `width` px wide, the axis
 * along the bottom thins its labels when they would run together: every n-th category, or fewer value ticks (core/axis-fit.ts). */
export function categoryScales(frame: CategoryFrame, carriers: CategoryCarriers, format?: (value: number) => string, width = 0): Record<"x" | "y", object> {
  const { grid, xAxis, yAxis } = carriers;
  const categoryAxisProps = frame.horizontal ? yAxis : xAxis;
  const valueAxisProps = frame.horizontal ? xAxis : yAxis;
  const across = width - frame.margin.left - frame.margin.right;
  const domain = categoryDomain(frame.count);
  const category = {
    scale: scaleBand<string>().domain(domain).padding(frame.padding),
    grid: false,
    axis: categoryAxis(frame.labels, frame.horizontal ? "y" : "x", categoryAxisProps !== undefined, frame.horizontal ? undefined : fittingCategories(domain, frame.labels, across)),
  };
  const ticks = (valueAxisProps as BarYAxisProps | undefined)?.numTicks ?? grid?.numTicksRows ?? 5;
  const formatTick = valueFormat({ formatValue: format, ...(valueAxisProps as BarYAxisProps | undefined) });
  const value = {
    scale: scaleLinear().domain([...frame.domain]),
    // The value axis' rules: `Grid` `horizontal` on a vertical chart, `vertical` (by default) on a horizontal one.
    grid: frame.horizontal ? scaleGrid(grid === undefined ? undefined : { ...grid, vertical: grid.vertical ?? true }, "x") : scaleGrid(grid, "y"),
    axis: valueAxis(formatTick, ticks, valueAxisProps !== undefined, frame.horizontal ? "x" : "y", frame.horizontal ? fittingValueTicks(frame.domain, ticks, formatTick, across) : undefined),
  };
  return frame.horizontal ? { x: value, y: category } : { x: category, y: value };
}

const outside = (value: number, start: number, length: number): boolean => value < start || value > start + length;

/** The focus: the `hitId` mark's point whose band is nearest the pointer along the category axis, while the pointer is in the plot. */
export function categoryFocus(hitId: string, frame: CategoryFrame, size: PlotSizeStore) {
  const { margin, horizontal } = frame;
  const hits = (points: readonly ChartPoint[]): ChartPoint[] => points.filter((p) => p.markId === hitId);
  return {
    ...focusNearestX,
    resolve: (points: readonly ChartPoint[], context: { readonly x: number; readonly y: number }): ChartPoint[] => {
      const { width, height } = size.get();
      const innerWidth = width - margin.left - margin.right;
      const innerHeight = height - margin.top - margin.bottom;
      if (width > 0 && (outside(context.x, margin.left, innerWidth) || outside(context.y, margin.top, innerHeight))) {
        return [];
      }
      let best: ChartPoint | undefined;
      let distance = Number.POSITIVE_INFINITY;
      for (const point of hits(points)) {
        const d = Math.abs(horizontal ? point.y - context.y : point.x - context.x);
        if (d < distance) {
          distance = d;
          best = point;
        }
      }
      return best === undefined ? [] : [best];
    },
    group: (_points: readonly ChartPoint[], context: { readonly point: ChartPoint }): ChartPoint[] => [context.point],
    navigation: (points: readonly ChartPoint[]): ChartPoint[] => hits(points).toSorted((a, b) => (horizontal ? a.y - b.y : a.x - b.x)),
  };
}

/** A value the chrome puts a dot on, for item `index` (undefined: none), in `color` (or one per row). */
export interface ChromeDot {
  readonly valueOf: (index: number) => number | undefined;
  readonly color: string | ((index: number) => string);
}

/** bklit's hover chrome on a vertical category chart (none horizontal): the crosshair, a dot per value and the category pill, as
 * `ChartTooltip`'s `showCrosshair`, `showDots` and `showDatePill` say. `rowOf(index)` is the row the overlay is focused with. */
export function categoryChrome(frame: CategoryFrame, tooltip: CategoryTooltipProps | undefined, dots: readonly ChromeDot[], rowIndex: ReadonlyMap<unknown, number>): PlotChrome | null {
  if (tooltip === undefined || frame.horizontal) {
    return null;
  }
  const indexOfRow = (row: Row): number => rowIndex.get(row) ?? -1;
  const overlayDots: OverlayDot[] = tooltip.showDots === false
    ? []
    : dots.map((dot): OverlayDot => {
        const fill = typeof dot.color === "string" ? dot.color : dot.color(0);
        return {
          yAxis: "y",
          valueOf: () => undefined,
          at: (_row: Row, plot: OverlayPlot, key: number) => {
            const value = dot.valueOf(key);
            return value === undefined || !Number.isFinite(value) ? undefined : { dx: 0, y: valueOffset(frame, value, plot.innerHeight) };
          },
          shapes: [{ r: tooltip.dotSize ?? 5, fill, ...(typeof dot.color === "string" ? null : { fillOf: (row: Row) => (dot.color as (index: number) => string)(indexOfRow(row)) }), stroke: "var(--chart-background)", strokeWidth: tooltip.dotStrokeWidth ?? 2 }],
          glide: true,
        };
      });
  const model: HoverOverlayModel = {
    crosshair: tooltip.showCrosshair === false ? null : { color: "var(--chart-crosshair)", width: 1, dash: tooltip.indicatorDasharray },
    pill: tooltip.showDatePill === false ? null : { labels: frame.labels, layout: null },
    dots: overlayDots,
    indexOf: (key) => key,
    xOf: (key, plot) => bandCenter(frame, key, plot.innerWidth),
  };
  return { model, keyOf: (index) => index };
}

// --- The loading skeleton's placement (core/plot/loading.ts) ----------------------------------------------------------------------------
// A category family lays its skeleton out on its own frame, so the shapes sit on the bands the axis labels: in shares of the value axis
// (0 its start, 1 its end), converted to the plot's pixels here.

/** The skeleton's frame: the chart's, or `fallback` evenly spaced bands when it has no rows yet (a placeholder with no data). */
export const skeletonFrame = (frame: CategoryFrame, fallback: number): CategoryFrame => (frame.count > 0 ? frame : { ...frame, count: fallback, labels: [] });

/** Where zero sits on the value axis, as a share of it (clamped into the domain): a skeleton's stems and bars start there. */
export const zeroShare = (frame: CategoryFrame): number => {
  const [lo, hi] = frame.domain;
  return Math.min(1, Math.max(0, (0 - lo) / (hi - lo || 1)));
};

/** A skeleton bar on band `index` from share `from` to share `to` of the value axis, `thickness` px across (the band's width by default). */
export function categorySpan(frame: CategoryFrame, size: SkeletonSize, index: number, from: number, to: number, options: { readonly thickness?: number; readonly radius?: number; readonly tone?: number } = {}): SkeletonShape {
  const across = frame.horizontal ? size.height : size.width;
  const along = frame.horizontal ? size.width : size.height;
  const center = bandCenter(frame, index, across);
  const thick = Math.min(options.thickness ?? Number.POSITIVE_INFINITY, bandWidth(frame, across));
  const lo = Math.min(from, to) * along;
  const hi = Math.max(from, to) * along;
  const radius = Math.min(options.radius ?? 0, thick / 2);
  return frame.horizontal
    ? { kind: "rect", x: lo, y: center - thick / 2, width: hi - lo, height: thick, radius, tone: options.tone }
    : { kind: "rect", x: center - thick / 2, y: along - hi, width: thick, height: hi - lo, radius, tone: options.tone };
}

/** A skeleton dot on band `index` at share `at` of the value axis. */
export function categoryDot(frame: CategoryFrame, size: SkeletonSize, index: number, at: number, r: number, tone?: number): SkeletonShape {
  const center = bandCenter(frame, index, frame.horizontal ? size.height : size.width);
  return frame.horizontal ? { kind: "dot", x: at * size.width, y: center, r, tone } : { kind: "dot", x: center, y: size.height * (1 - at), r, tone };
}
