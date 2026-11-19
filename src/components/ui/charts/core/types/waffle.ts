import type { ChartStatus } from "../motion/phase";
import type { MarkChartLoadingProps } from "./mark-chart-loading";

/** One category of a waffle: its share of the grid is its `value` over the chart's `total`. */
export interface WaffleDatum {
  readonly label: string;
  readonly value: number;
  /** This category's colour; the palette's by position otherwise. */
  readonly color?: string;
}

/** What a `ChartTooltip`'s `content({ point })` receives for a waffle category. */
export interface WafflePoint {
  readonly [key: string]: unknown;
  readonly label: string;
  readonly value: number;
  /** Its share of the total, 0 to 1. */
  readonly share: number;
  /** The cells it fills, and the grid's. */
  readonly cells: number;
  readonly totalCells: number;
  readonly color: string;
}

/** Props for `WaffleChart`. */
export interface WaffleChartProps {
  /** The categories, in fill order. */
  readonly data: readonly WaffleDatum[];
  /** Called with the hovered category's index, and `null` when the pointer leaves (pair it with a `ChartLegend`). */
  readonly onHoverChange?: (index: number | null) => void;
  /**
   * The value of the whole grid: cells past the categories' sum stay empty (a track). Defaults to the sum, so the grid is full.
   */
  readonly total?: number;
  /**
   * Cells per row.
   * @default 10
   */
  readonly columns?: number;
  /**
   * Rows of cells.
   * @default 10
   */
  readonly rows?: number;
  /**
   * Gap between cells, in px.
   * @default 3
   */
  readonly gap?: number;
  /**
   * `"square"` cells (rounded by `radius`) or `"circle"` dots.
   * @default "square"
   */
  readonly shape?: "square" | "circle";
  /**
   * Corner radius of a square cell, as a share of its side (0 to 0.5).
   * @default 0.2
   */
  readonly radius?: number;
  /**
   * Fill order: `"rows"` left to right from the top, `"columns"` top to bottom from the left.
   * @default "rows"
   */
  readonly fill?: "rows" | "columns";
  /** Category colours, in order (cycled). Defaults to `--chart-1` … `--chart-5`. */
  readonly colors?: readonly string[];
  /** Formats a value in the tooltip. */
  readonly formatValue?: (value: number) => string;
  /**
   * The value's name in the tooltip.
   * @default "Value"
   */
  readonly valueLabel?: string;
  /**
   * Width over height: a number or a string such as `"2 / 1"`. Defaults to the grid's own, `columns / rows`.
   */
  readonly aspectRatio?: string | number;
  /** A fixed height in px instead of an aspect ratio. */
  readonly height?: number;
  /**
   * Play the entrance: the cells pop in, in fill order.
   * @default true
   */
  readonly animate?: boolean;
  /**
   * `"loading"` draws a shimmering skeleton (the grid's muted cells) in place of the chart and ignores the pointer; switching to `"ready"` plays the
   * entrance. Switching back to `"loading"` fades the chart out first.
   * @default "ready"
   */
  readonly status?: ChartStatus;
  /** Text shown centered over the plot, with a shimmer, while `status` is `"loading"`. Nothing is shown when it is unset or empty. */
  readonly loadingLabel?: string;
  readonly ariaLabel?: string;
  readonly ariaDescription?: string;
}

/** Props of `WaffleChartLoading`: a ready-made placeholder, `<WaffleChart status="loading" />` with no data. */
export interface WaffleChartLoadingProps extends MarkChartLoadingProps, Pick<WaffleChartProps, "columns" | "rows" | "gap" | "shape" | "radius"> {}
