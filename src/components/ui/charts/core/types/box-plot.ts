import type { DistributionAxisProps, DistributionChartProps, DistributionOrientedChartLoadingProps, DistributionSeriesProps, DistributionTooltipProps } from "./distribution";

/** Props of `BoxPlotChart`. */
export interface BoxPlotChartProps<Node, Style> extends DistributionChartProps<Node, Style> {
  /** Key of the column naming each row's category: one box per category (per series), in first-seen order. */
  readonly categoryKey: string;
  /**
   * `"vertical"`: categories along the bottom, values up the side. `"horizontal"`: categories down the side, values along the bottom.
   * @default "vertical"
   */
  readonly orientation?: "vertical" | "horizontal";
  /** The value axis range `[min, max]`. Defaults to the observations' extent, rounded to nice values. */
  readonly domain?: readonly [number, number];
}

/** Props of `BoxPlot`: one series of observations, summarized per category (quartiles, median, Tukey whiskers, outliers). */
export interface BoxPlotProps extends DistributionSeriesProps {
  /**
   * Corner radius of the box in pixels.
   * @default 6
   */
  readonly radius?: number;
  /**
   * Width of the box as a share of its category's band, from 0 to 1.
   * @default 0.62
   */
  readonly boxWidth?: number;
  /**
   * Draw the observations past the whiskers (1.5 times the interquartile range) as dots.
   * @default true
   */
  readonly showOutliers?: boolean;
}

/** Props of `BoxPlotXAxis` and `BoxPlotYAxis`: on the value axis, its ticks; on the category axis, the categories. */
export interface BoxPlotAxisProps extends DistributionAxisProps {}

/** One series' summary in a category. */
export interface BoxPlotSummary {
  readonly label: string;
  readonly color: string;
  /** Observations in the category. */
  readonly count: number;
  /** The lower whisker: the lowest observation within 1.5 IQR below the first quartile. */
  readonly low: number;
  readonly q1: number;
  readonly median: number;
  readonly q3: number;
  /** The upper whisker: the highest observation within 1.5 IQR above the third quartile. */
  readonly high: number;
  /** The observations past the whiskers. */
  readonly outliers: readonly number[];
}

/** A hovered category: what `BoxPlotTooltip`'s `content` is called with. */
export interface BoxPlotPoint {
  readonly category: string;
  /** Each series' summary, in declaration order (a series without observations in the category is left out). */
  readonly series: readonly BoxPlotSummary[];
}

/** Props of `BoxPlotTooltip`. */
export interface BoxPlotTooltipProps<Node> extends DistributionTooltipProps<Node, BoxPlotPoint> {}

/** Props of `BoxPlotChartLoading`: a ready-made placeholder, `BoxPlotChart` with no data and `status="loading"`, drawing its skeleton boxes. */
export interface BoxPlotChartLoadingProps extends DistributionOrientedChartLoadingProps {}
