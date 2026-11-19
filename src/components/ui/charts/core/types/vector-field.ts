import type { SpatialAxisProps, SpatialChartBaseProps, SpatialChartLoadingProps, SpatialGridProps, SpatialHoverProps, SpatialLegendProps, SpatialRow, SpatialTooltipProps } from "./spatial";

/** Props of `VectorFieldChart`. */
export interface VectorFieldChartProps<Node> extends SpatialChartBaseProps<Node> {
  /** The samples: one row per arrow, at its x and y. */
  readonly data: readonly SpatialRow[];
  /** Key of each sample's horizontal position. */
  readonly xDataKey: string;
  /** Key of each sample's vertical position. */
  readonly yDataKey: string;
  /** The x range shown. Defaults to the data's, rounded out to nice values. */
  readonly xDomain?: readonly [number, number];
  /** The y range shown. Defaults to the data's, rounded out to nice values. */
  readonly yDomain?: readonly [number, number];
}

/** Props of `VectorFieldChartLoading`: the chart with `status="loading"` and no data, its skeleton shimmering in the plot. */
export interface VectorFieldChartLoadingProps extends SpatialChartLoadingProps {}

/** Props of `VectorFieldArrows`: an arrow per sample, pointing its direction, as long (and as dark) as its magnitude. */
export interface VectorFieldArrowsProps extends SpatialHoverProps {
  /**
   * Key of each sample's horizontal component (east, +x). With `vDataKey` it gives the direction and the magnitude.
   * @default "u"
   */
  readonly uDataKey?: string;
  /**
   * Key of each sample's vertical component (north, +y).
   * @default "v"
   */
  readonly vDataKey?: string;
  /** Key of each sample's direction in degrees, clockwise from up (north): used with `magnitudeDataKey` in place of `u` and `v`. */
  readonly angleDataKey?: string;
  /** Key of each sample's magnitude, with `angleDataKey`. */
  readonly magnitudeDataKey?: string;
  /**
   * Length of the strongest arrow, in pixels; the others by the square root of their magnitude.
   * @default 22
   */
  readonly maxLength?: number;
  /** One color for every arrow. Defaults to steps of the sequential scale by magnitude. */
  readonly color?: string;
  /**
   * The fills by magnitude, lowest first, without `color`.
   * @default the sequential scale `var(--chart-scale-02)` … `var(--chart-scale-05)`
   */
  readonly colors?: readonly string[];
  /**
   * Width of the arrows, in pixels.
   * @default 1.5
   */
  readonly strokeWidth?: number;
  /**
   * Opacity of the other marks while one is hovered or focused.
   * @default 0.3
   */
  readonly inactiveOpacity?: number;
}

/** A sample under the pointer, as `VectorFieldTooltip`'s `content` gets it. */
export interface VectorFieldVector {
  readonly row: SpatialRow;
  /** Its magnitude. */
  readonly magnitude: number;
  /** Its direction in degrees, clockwise from up (north). */
  readonly angle: number;
}

/** What `VectorFieldTooltip`'s `content` is called with. */
export interface VectorFieldTooltipArgs {
  readonly vector: VectorFieldVector;
  readonly index: number;
}

/** Props of `VectorFieldTooltip`: the tooltip on a hovered or focused arrow. */
export interface VectorFieldTooltipProps<Node, Style> extends SpatialTooltipProps<Node, Style, VectorFieldTooltipArgs> {}

/** Props of `VectorFieldXAxis` and `VectorFieldYAxis`. */
export interface VectorFieldAxisProps extends SpatialAxisProps {}

/** Props of `VectorFieldGrid`. */
export interface VectorFieldGridProps extends SpatialGridProps {}

/** Props of `VectorFieldLegend`: the magnitude steps and their colors. */
export interface VectorFieldLegendProps extends SpatialLegendProps {}
