import type { SpatialAxisProps, SpatialChartBaseProps, SpatialChartLoadingProps, SpatialGridProps, SpatialHoverProps, SpatialLegendProps, SpatialRow, SpatialTooltipProps } from "./spatial";

/** Props of `DensityChart`. */
export interface DensityChartProps<Node> extends SpatialChartBaseProps<Node> {
  /** The observations: one row per point. Rows without a finite x or y are left out. */
  readonly data: readonly SpatialRow[];
  /** Key of the horizontal value in each row. */
  readonly xDataKey: string;
  /** Key of the vertical value in each row. */
  readonly yDataKey: string;
  /** Key of each row's group: each group gets its own density estimate and color (`--chart-1`, `--chart-2`… in order of appearance). */
  readonly groupDataKey?: string;
  /** Colors of the groups by name, over the palette. */
  readonly groupColors?: Readonly<Record<string, string>>;
  /** The x range shown. Defaults to the data's, rounded out to nice values. */
  readonly xDomain?: readonly [number, number];
  /** The y range shown. Defaults to the data's, rounded out to nice values. */
  readonly yDomain?: readonly [number, number];
}

/** Props of `DensityChartLoading`: the chart with `status="loading"` and no data, its skeleton shimmering in the plot. */
export interface DensityChartLoadingProps extends SpatialChartLoadingProps {}

/** Props of `DensityContours`: the estimated density as nested, filled level bands. */
export interface DensityContoursProps extends SpatialHoverProps {
  /**
   * Smoothing of the estimate: the Gaussian kernel's bandwidth, in pixels. Larger is smoother.
   * @default 20
   */
  readonly bandwidth?: number;
  /**
   * The number of levels, or the exact density levels (observations per square pixel).
   * @default 8
   */
  readonly thresholds?: number | readonly number[];
  /**
   * Opacity of each band's fill; nested bands add up, so the densest areas read darkest.
   * @default 0.14
   */
  readonly fillOpacity?: number;
  /**
   * Width of each level's outline, in pixels (0: none).
   * @default 1
   */
  readonly strokeWidth?: number;
  /**
   * Opacity of each level's outline.
   * @default 0.55
   */
  readonly strokeOpacity?: number;
  /** A single color for every band; defaults to each group's color (`--chart-1` without groups). */
  readonly color?: string;
  /**
   * Opacity of the bands while a point is hovered or focused.
   * @default 0.5
   */
  readonly inactiveOpacity?: number;
}

/** Props of `DensityPoints`: the observations as dots over the bands, which the tooltip and keyboard focus land on. */
export interface DensityPointsProps extends SpatialHoverProps {
  /**
   * Radius of each dot, in pixels.
   * @default 2.5
   */
  readonly radius?: number;
  /**
   * Opacity of the dots at rest.
   * @default 0.7
   */
  readonly opacity?: number;
}

/** What `DensityTooltip`'s `content` is called with: the observation under the pointer and its index in `data`. */
export interface DensityTooltipArgs {
  readonly point: SpatialRow;
  readonly index: number;
}

/** Props of `DensityTooltip`: the tooltip on a hovered or focused observation (it needs `DensityPoints`). */
export interface DensityTooltipProps<Node, Style> extends SpatialTooltipProps<Node, Style, DensityTooltipArgs> {
  /** The x row's label. Defaults to `DensityXAxis`' `label`, else `xDataKey`. */
  readonly xLabel?: string;
  /** The y row's label. Defaults to `DensityYAxis`' `label`, else `yDataKey`. */
  readonly yLabel?: string;
}

/** Props of `DensityXAxis` and `DensityYAxis`. */
export interface DensityAxisProps extends SpatialAxisProps {}

/** Props of `DensityGrid`. */
export interface DensityGridProps extends SpatialGridProps {}

/** Props of `DensityLegend`: the groups and their colors. */
export interface DensityLegendProps extends SpatialLegendProps {}
