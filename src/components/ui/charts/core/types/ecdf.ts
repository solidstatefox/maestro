import type { DistributionAxisProps, DistributionChartLoadingProps, DistributionChartProps, DistributionSeriesProps, DistributionTooltipProps } from "./distribution";

/** Props of `EcdfChart`. */
export interface EcdfChartProps<Node, Style> extends DistributionChartProps<Node, Style> {
  /** The value axis range `[min, max]`. Defaults to the observations' extent, rounded to nice values. */
  readonly domain?: readonly [number, number];
  /** Shares to mark with a dashed guide across the plot and its label, as fractions: `[0.5, 0.9]` marks the median and the 90th percentile. */
  readonly percentiles?: readonly number[];
}

/** Props of `Ecdf`: one series of observations, drawn as its empirical cumulative distribution (a step up at every observation). */
export interface EcdfProps extends DistributionSeriesProps {
  /**
   * Width of the step line in pixels.
   * @default 2
   */
  readonly strokeWidth?: number;
  /**
   * Fill the area under the steps with a soft wash of the series colour.
   * @default false
   */
  readonly showArea?: boolean;
}

/** Props of `EcdfXAxis` (the values) and `EcdfYAxis` (the share, formatted as a percentage unless `formatValue` says otherwise). */
export interface EcdfAxisProps extends DistributionAxisProps {}

/** One series at the hovered value. */
export interface EcdfPointSeries {
  readonly label: string;
  readonly color: string;
  /** The share of the series' observations at or below the value, 0 to 1. */
  readonly share: number;
  /** How many of its observations are at or below the value, and how many it has. */
  readonly count: number;
  readonly total: number;
}

/** A hovered value: what `EcdfTooltip`'s `content` is called with. */
export interface EcdfPoint {
  readonly value: number;
  readonly series: readonly EcdfPointSeries[];
}

/** Props of `EcdfTooltip`. */
export interface EcdfTooltipProps<Node> extends DistributionTooltipProps<Node, EcdfPoint> {}

/** Props of `EcdfChartLoading`: a ready-made placeholder, `EcdfChart` with no data and `status="loading"`, drawing its skeleton staircase. */
export interface EcdfChartLoadingProps extends DistributionChartLoadingProps {}
