import type { ChartBounds, ChartFocusStrategy, ChartPoint } from "@tanstack/charts";
import type { GridGuideProps } from "../cartesian/grid-guides";
import { gridLineStyle } from "../cartesian/grid-guides";
import { CHART_PALETTE } from "../palette";
import { BKLIT_TOOLTIP_PLACEMENT, TOOLTIP_MOTION, TOOLTIP_OFFSET, X_TICK_PADDING } from "../theme";
import type { ChartMargin } from "../theme";
import { bklitTooltip } from "../tooltip/bklit-tooltip";
import { bklitTooltipPlacement } from "../tooltip/bklit-tooltip-portal";
import type { DistributionAxisProps } from "../types/distribution";

/** What the marks write as they draw and the focus reads at pointer time: the plot box of the latest draw. */
export interface DistributionLive {
  chart: ChartBounds | null;
}

export const createLive = (): DistributionLive => ({ chart: null });

/** bklit's y axis label: `1.2k` from 1000 up unless `formatLargeNumbers` is off. */
export const formatAxisValue = (axis: DistributionAxisProps | undefined) => (value: number): string => {
  if (axis?.formatValue !== undefined) {
    return axis.formatValue(value);
  }
  if (axis?.formatLargeNumbers !== false && Math.abs(value) >= 1000) {
    return `${Math.round(value / 100) / 10}k`;
  }
  return String(Math.round(value * 1000) / 1000);
};

const numberFormat = /* @__PURE__ */ new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
/** The tooltip's value format: the tooltip's own, the value axis's, then en-US with two decimals at most. */
export const formatTooltipValue = (own: ((value: number) => string) | undefined, axis: DistributionAxisProps | undefined): ((value: number) => string) =>
  own ?? axis?.formatValue ?? ((value: number): string => numberFormat.format(value));

/** The series colour: the given fill, else the palette's for its position. */
export const seriesColor = (fill: string | undefined, index: number): string => fill ?? CHART_PALETTE[index % CHART_PALETTE.length];

/** A finite number from a row's cell, or null. */
export const finite = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** A value axis (TanStack scale `axis` config): bklit's look, `numTicks` ticks. */
export const valueAxis = (axis: DistributionAxisProps | undefined, side: "x" | "y"): unknown =>
  axis === undefined
    ? false
    : {
        line: false,
        ticks: { count: axis.numTicks ?? 5, size: 0, ...(side === "x" ? { padding: X_TICK_PADDING } : {}), format: formatAxisValue(axis) },
        tickLabels: { fontSize: 12, opacity: 1, thin: false },
      };

/** A category axis, bklit's look: every category's label, or only `labelled` ones (the categories that fit, core/axis-fit.ts). */
export const categoryAxis = (shown: boolean, side: "x" | "y", labelled?: readonly string[]): unknown =>
  shown
    ? { line: false, ticks: { size: 0, ...(side === "x" ? { padding: X_TICK_PADDING } : {}), ...(labelled === undefined ? {} : { values: labelled }) }, tickLabels: { fontSize: 12, opacity: 1, thin: false } }
    : false;

/** The native grid on a value scale for `Grid`'s rows (`horizontal`, on a vertical chart) or columns (`vertical`). */
export const gridOn = (grid: GridGuideProps | undefined, lines: "rows" | "columns"): unknown => {
  if (grid === undefined) {
    return false;
  }
  const shown = lines === "rows" ? grid.horizontal !== false : grid.vertical === true;
  return shown ? gridLineStyle(grid) : false;
};

/** The plot margins: room for the axes that are drawn, the reader's sides over them. */
export const plotMargin = (given: Partial<ChartMargin> | undefined, room: { readonly left: number; readonly bottom: number }): ChartMargin => ({
  top: given?.top ?? 16,
  right: given?.right ?? 16,
  bottom: given?.bottom ?? room.bottom,
  left: given?.left ?? room.left,
});

/** The left margin a category axis needs for its longest label (12px text, about 6.6px a character). */
export const categoryLabelRoom = (labels: readonly string[]): number => Math.ceil(Math.max(24, ...labels.map((label) => label.length * 6.6)) + 14);

/** The left margin a value axis needs for its labels. */
export const valueLabelRoom = (domain: readonly [number, number], axis: DistributionAxisProps | undefined): number => {
  const format = formatAxisValue(axis);
  const longest = Math.max(format(domain[0]).length, format(domain[1]).length, format((domain[0] + domain[1]) / 2).length);
  return Math.ceil(longest * 7 + 14);
};

const within = (live: DistributionLive, x: number, y: number): boolean => {
  const { chart } = live;
  return chart === null || (x >= chart.x - 1 && x <= chart.x + chart.width + 1 && y >= chart.y - 1 && y <= chart.y + chart.height + 1);
};

/**
 * Band focus: inside the plot, the point nearest the pointer along `axis` (a bin's or a category's column, wherever the pointer is in it);
 * one point per focus, the keyboard stepping through them in order.
 */
export const bandFocus = (axis: "x" | "y", live: DistributionLive): ChartFocusStrategy => ({
  resolve: (points, context) => {
    if (!within(live, context.x, context.y)) {
      return [];
    }
    let best: ChartPoint | undefined;
    let distance = Number.POSITIVE_INFINITY;
    for (const point of points) {
      const d = Math.abs(axis === "x" ? point.x - context.x : point.y - context.y);
      if (d < distance) {
        distance = d;
        best = point;
      }
    }
    return best === undefined ? [] : [best];
  },
  group: (_points, { point }) => [point],
  navigation: (points) => points.toSorted((a, b) => (axis === "x" ? a.x - b.x : a.y - b.y)),
});

/** Nearest focus within `reach` px of the pointer, inside the plot: a beeswarm's dots. */
export const nearestFocus = (live: DistributionLive, reach: number): ChartFocusStrategy => ({
  resolve: (points, context) => {
    if (!within(live, context.x, context.y)) {
      return [];
    }
    let best: ChartPoint | undefined;
    let distance = reach * reach;
    for (const point of points) {
      const dx = point.x - context.x;
      const dy = point.y - context.y;
      const d = dx * dx + dy * dy;
      if (d <= distance) {
        distance = d;
        best = point;
      }
    }
    return best === undefined ? [] : [best];
  },
  group: (_points, { point }) => [point],
  navigation: (points) => points.toSorted((a, b) => a.x - b.x || a.y - b.y),
});

// Beside the focused point, centred on it (a horizontal chart's rows), flipping left at the edge.
const POINT_PLACEMENT = /* @__PURE__ */ (() => ({ anchor: "point", offset: TOOLTIP_OFFSET, portal: bklitTooltipPlacement({}) }) as const)();

/**
 * The definition's focus and tooltip options: bklit's tooltip when the chart has one, pinned to the plot top beside the focused x
 * (`"top"`, a vertical chart's columns) or beside the focused point (`"point"`, a horizontal chart's rows).
 */
export const interactionOptions = (focus: ChartFocusStrategy, tooltip: boolean, placement: "top" | "point" = "top"): Readonly<Record<string, unknown>> => ({
  focus,
  maxFocusDistance: Number.POSITIVE_INFINITY,
  focusRing: false,
  tooltip: tooltip ? { use: bklitTooltip, ...(placement === "top" ? BKLIT_TOOLTIP_PLACEMENT : POINT_PLACEMENT), sticky: false, motion: TOOLTIP_MOTION } : false,
});
