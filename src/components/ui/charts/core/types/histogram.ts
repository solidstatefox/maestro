import type { DistributionAxisProps, DistributionChartLoadingProps, DistributionChartProps, DistributionSeriesProps, DistributionTooltipProps } from "./distribution";

/** Props of `HistogramChart`. */
export interface HistogramChartProps<Node, Style> extends DistributionChartProps<Node, Style> {
  /**
   * The bins: a target bin count (the boundaries are rounded to nice values) or the exact bin boundaries, in order. Defaults to Sturges'
   * rule on the number of observations.
   */
  readonly thresholds?: number | readonly number[];
  /** The binned range `[min, max]`. Defaults to the observations' extent. */
  readonly domain?: readonly [number, number];
  /**
   * Stack the series' bars in each bin. Otherwise they overlap, each translucent.
   * @default false
   */
  readonly stacked?: boolean;
}

/** Props of `Histogram`: one series of observations, binned on the chart's shared bins. */
export interface HistogramProps extends DistributionSeriesProps {
  /**
   * Radius of each bar's top corners in pixels.
   * @default 4
   */
  readonly radius?: number;
  /** Opacity of the bars' fill. Defaults to 1, or 0.55 when several series overlap. */
  readonly fillOpacity?: number;
}

/** Props of `HistogramXAxis` (the binned values) and `HistogramYAxis` (the counts). */
export interface HistogramAxisProps extends DistributionAxisProps {}

/** One series' count in a bin. */
export interface HistogramPointSeries {
  readonly label: string;
  readonly color: string;
  readonly count: number;
}

/** A hovered bin: what `HistogramTooltip`'s `content` is called with. */
export interface HistogramPoint {
  /** The bin's lower bound (inclusive). */
  readonly x0: number;
  /** The bin's upper bound (exclusive, inclusive for the last bin). */
  readonly x1: number;
  /** Observations in the bin across the series. */
  readonly total: number;
  /** Each series' count, in declaration order. */
  readonly series: readonly HistogramPointSeries[];
}

/** Props of `HistogramTooltip`. */
export interface HistogramTooltipProps<Node> extends DistributionTooltipProps<Node, HistogramPoint> {}

/** Props of `HistogramChartLoading`: a ready-made placeholder, `HistogramChart` with no data and `status="loading"`, drawing its skeleton bins. */
export interface HistogramChartLoadingProps extends DistributionChartLoadingProps {}
