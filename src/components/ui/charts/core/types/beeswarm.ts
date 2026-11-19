import type { DistributionAxisProps, DistributionChartProps, DistributionOrientedChartLoadingProps, DistributionSeriesProps, DistributionTooltipProps } from "./distribution";

/** Props of `BeeswarmChart`. */
export interface BeeswarmChartProps<Node, Style> extends DistributionChartProps<Node, Style> {
  /** Key of the column naming each row's category: one swarm per category, in first-seen order. Without it, one swarm across the plot. */
  readonly categoryKey?: string;
  /**
   * `"horizontal"`: values along the bottom, each category's swarm a row. `"vertical"`: values up the side, each swarm a column.
   * @default "horizontal"
   */
  readonly orientation?: "vertical" | "horizontal";
  /** The value axis range `[min, max]`. Defaults to the observations' extent, rounded to nice values. */
  readonly domain?: readonly [number, number];
}

/** Props of `Beeswarm`: one series of observations, one dot each, dodged apart so none overlap. */
export interface BeeswarmProps extends DistributionSeriesProps {
  /**
   * Radius of each dot in pixels.
   * @default 4
   */
  readonly radius?: number;
}

/** Props of `BeeswarmXAxis` and `BeeswarmYAxis`: on the value axis, its ticks; on the category axis, the categories. */
export interface BeeswarmAxisProps extends DistributionAxisProps {}

/** A hovered observation: what `BeeswarmTooltip`'s `content` is called with. */
export interface BeeswarmPoint {
  /** The observation's value (its series' `dataKey` column). */
  readonly value: number;
  /** Its category, when the chart has a `categoryKey`. */
  readonly category: string | undefined;
  /** Its series' label and colour. */
  readonly label: string;
  readonly color: string;
  /** The data row it came from (its other columns, for a custom tooltip). */
  readonly row: Readonly<Record<string, unknown>>;
}

/** Props of `BeeswarmTooltip`. */
export interface BeeswarmTooltipProps<Node> extends DistributionTooltipProps<Node, BeeswarmPoint> {}

/** Props of `BeeswarmChartLoading`: a ready-made placeholder, `BeeswarmChart` with no data and `status="loading"`, drawing its skeleton swarm. */
export interface BeeswarmChartLoadingProps extends DistributionOrientedChartLoadingProps {}
