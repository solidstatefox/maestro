import type { DistributionAxisProps, DistributionChartProps, DistributionOrientedChartLoadingProps, DistributionSeriesProps, DistributionTooltipProps } from "./distribution";

/** Props of `ViolinChart`. */
export interface ViolinChartProps<Node, Style> extends DistributionChartProps<Node, Style> {
  /** Key of the column naming each row's category: one violin per category (per series), in first-seen order. */
  readonly categoryKey: string;
  /**
   * `"vertical"`: categories along the bottom, values up the side. `"horizontal"`: categories down the side, values along the bottom.
   * @default "vertical"
   */
  readonly orientation?: "vertical" | "horizontal";
  /** The value axis range `[min, max]`. Defaults to the observations' extent, rounded to nice values. */
  readonly domain?: readonly [number, number];
  /**
   * How many bins the density profiles are counted in across the value range (each then smoothed and scaled to its peak).
   * @default 28
   */
  readonly bins?: number;
}

/** Props of `Violin`: one series of observations, drawn per category as a mirrored density with its quartiles inside. */
export interface ViolinProps extends DistributionSeriesProps {
  /**
   * Width of a violin at its peak as a share of its category's band, from 0 to 1.
   * @default 0.9
   */
  readonly violinWidth?: number;
  /**
   * Draw the quartile bar, the range line and the median dot inside each violin.
   * @default true
   */
  readonly showBox?: boolean;
}

/** Props of `ViolinXAxis` and `ViolinYAxis`: on the value axis, its ticks; on the category axis, the categories. */
export interface ViolinAxisProps extends DistributionAxisProps {}

/** One series' summary in a category. */
export interface ViolinSummary {
  readonly label: string;
  readonly color: string;
  readonly count: number;
  readonly min: number;
  readonly q1: number;
  readonly median: number;
  readonly q3: number;
  readonly max: number;
}

/** A hovered category: what `ViolinTooltip`'s `content` is called with. */
export interface ViolinPoint {
  readonly category: string;
  /** Each series' summary, in declaration order (a series without observations in the category is left out). */
  readonly series: readonly ViolinSummary[];
}

/** Props of `ViolinTooltip`. */
export interface ViolinTooltipProps<Node> extends DistributionTooltipProps<Node, ViolinPoint> {}

/** Props of `ViolinChartLoading`: a ready-made placeholder, `ViolinChart` with no data and `status="loading"`, drawing its skeleton violins. */
export interface ViolinChartLoadingProps extends DistributionOrientedChartLoadingProps {}
