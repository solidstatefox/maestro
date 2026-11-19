import type { DistributionAxisProps, DistributionChartLoadingProps, DistributionChartProps, DistributionSeriesProps, DistributionTooltipProps } from "./distribution";

/** Props of `RidgelineChart`. */
export interface RidgelineChartProps<Node, Style> extends DistributionChartProps<Node, Style> {
  /** Key of the column naming each row's category: one ridge per category, top to bottom in first-seen order. */
  readonly categoryKey: string;
  /** The value axis range `[min, max]`. Defaults to the observations' extent, rounded to nice values. */
  readonly domain?: readonly [number, number];
  /**
   * How many bins each ridge's profile is counted in across the value range (then smoothed and scaled to its peak).
   * @default 32
   */
  readonly bins?: number;
  /**
   * A ridge's peak height in rows: above 1, each ridge rises into the rows above it.
   * @default 1.6
   */
  readonly overlap?: number;
}

/** Props of `Ridgeline`: the observations (its `dataKey` column), one smoothed density ridge per category. */
export interface RidgelineProps extends DistributionSeriesProps {
  /**
   * Width of each ridge's outline in pixels.
   * @default 1.5
   */
  readonly strokeWidth?: number;
}

/** Props of `RidgelineXAxis` (the values) and `RidgelineYAxis` (the categories, each at its ridge's baseline). */
export interface RidgelineAxisProps extends DistributionAxisProps {}

/** A hovered ridge: what `RidgelineTooltip`'s `content` is called with. */
export interface RidgelinePoint {
  readonly category: string;
  readonly color: string;
  readonly count: number;
  readonly min: number;
  readonly q1: number;
  readonly median: number;
  readonly q3: number;
  readonly max: number;
}

/** Props of `RidgelineTooltip`. */
export interface RidgelineTooltipProps<Node> extends DistributionTooltipProps<Node, RidgelinePoint> {}

/** Props of `RidgelineChartLoading`: a ready-made placeholder, `RidgelineChart` with no data and `status="loading"`, drawing its skeleton ridges. */
export interface RidgelineChartLoadingProps extends DistributionChartLoadingProps {}
