import type { SpatialAxisProps, SpatialChartBaseProps, SpatialChartLoadingProps, SpatialGridProps, SpatialHoverProps, SpatialLegendProps, SpatialRow, SpatialTooltipProps } from "./spatial";

/** Props of `HexbinChart`. */
export interface HexbinChartProps<Node> extends SpatialChartBaseProps<Node> {
  /** The observations to bin: one row per point. Rows without a finite x or y are left out. */
  readonly data: readonly SpatialRow[];
  /** Key of the horizontal value in each row. */
  readonly xDataKey: string;
  /** Key of the vertical value in each row. */
  readonly yDataKey: string;
  /** The x range shown. Defaults to the data's, rounded out to nice values. */
  readonly xDomain?: readonly [number, number];
  /** The y range shown. Defaults to the data's, rounded out to nice values. */
  readonly yDomain?: readonly [number, number];
}

/** Props of `HexbinChartLoading`: the chart with `status="loading"` and no data, its skeleton shimmering in the plot. */
export interface HexbinChartLoadingProps extends SpatialChartLoadingProps {}

/** How a bin's observations combine into the value its color shows. */
export type HexbinReduce = "count" | "sum" | "mean";

/** Props of `HexbinCells`: the hexagons, one per bin that holds an observation. */
export interface HexbinCellsProps extends SpatialHoverProps {
  /**
   * Horizontal distance between neighbouring bin centers, in pixels. Bins are laid out at the chart's size, so a narrower chart groups
   * more observations per bin.
   * @default 22
   */
  readonly binWidth?: number;
  /** Key of a value to combine per bin (with `reduce`) instead of counting observations. */
  readonly valueDataKey?: string;
  /**
   * How a bin's observations combine into its value: their number, or the sum or mean of `valueDataKey`.
   * @default "count", or "sum" when `valueDataKey` is set
   */
  readonly reduce?: HexbinReduce;
  /**
   * The fills from the lowest values to the highest.
   * @default the sequential scale `var(--chart-scale-02)` … `var(--chart-scale-05)`
   */
  readonly colors?: readonly string[];
  /** The values at which each fill after the first starts (one fewer than `colors`). Defaults to equal steps up to the largest bin. */
  readonly thresholds?: readonly number[];
  /**
   * Gap between neighbouring hexagons, in pixels.
   * @default 1.5
   */
  readonly gap?: number;
  /** Border color of the hexagons. */
  readonly stroke?: string;
}

/** A bin under the pointer, as `HexbinTooltip`'s `content` gets it. */
export interface HexbinBin {
  /** The bin center's x value. */
  readonly x: number;
  /** The bin center's y value. */
  readonly y: number;
  /** How many observations fall in the bin. */
  readonly count: number;
  /** The value its color shows: `count`, or the sum or mean of `HexbinCells`' `valueDataKey`. */
  readonly value: number;
  /** The bin's observations, in data order. */
  readonly rows: readonly SpatialRow[];
}

/** What `HexbinTooltip`'s `content` is called with. */
export interface HexbinTooltipArgs {
  readonly bin: HexbinBin;
  readonly index: number;
}

/** Props of `HexbinTooltip`: the tooltip on a hovered or focused bin. */
export interface HexbinTooltipProps<Node, Style> extends SpatialTooltipProps<Node, Style, HexbinTooltipArgs> {
  /** Formats the bin's x and y values for the default title. */
  readonly formatPosition?: (x: number, y: number) => string;
}

/** Props of `HexbinXAxis` and `HexbinYAxis`. */
export interface HexbinAxisProps extends SpatialAxisProps {}

/** Props of `HexbinGrid`. */
export interface HexbinGridProps extends SpatialGridProps {}

/** Props of `HexbinLegend`: the fills' steps and the values where each starts. */
export interface HexbinLegendProps extends SpatialLegendProps {}
