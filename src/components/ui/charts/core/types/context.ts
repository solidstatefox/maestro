import type { ScaleBand, ScaleLinear, ScaleTime } from "d3-scale";
import type { ChartSelection, SpringConfig } from "./cartesian";
import type { ChartPhase, ChartStatus } from "../motion/phase";

/** Space between the chart edge and the plot area, in px. */
export interface Margin {
  /** Top margin in px. */
  top: number;
  /** Right margin in px. */
  right: number;
  /** Bottom margin in px. */
  bottom: number;
  /** Left margin in px. */
  left: number;
}

/** A line series as registered with the chart. */
export interface LineConfig {
  /** Key of the series in the chart data. */
  dataKey: string;
  /** The series' `label`: its name in the default tooltip row. Absent when the series sets none (the row shows `dataKey`). */
  label?: string;
  /** Stroke color of the line. */
  stroke: string;
  /** Stroke width of the line in px. */
  strokeWidth: number;
  /**
   * Id of the y-scale group the line uses.
   * @default "left"
   */
  yAxisId?: string | number;
}

/** A `ReferenceArea` band as the axes see it. */
export interface ReferenceAreaConfig {
  /** Id of the y-scale group the band refers to. */
  yAxisId: string;
  /** Lower y data bound of the band. */
  y1?: number;
  /** Upper y data bound of the band. */
  y2?: number;
  /** Color for y-axis labels inside the band. */
  axisLabelColor?: string;
}

export interface TooltipData {
  /** The data point being hovered */
  point: Record<string, unknown>;
  /** Index in the data array */
  index: number;
  /** X position in pixels (relative to chart area) */
  x: number;
  /** Y positions for each line, keyed by dataKey */
  yPositions: Record<string, number>;
  /** X positions for each series (for grouped bars), keyed by dataKey */
  xPositions?: Record<string, number>;
}

/** Hover state from `useChartHover()`. It changes whenever the focused row changes. `SetTooltipData` is the framework's setter type. */
export interface ChartHoverContextValue<SetTooltipData> {
  /** The hovered or focused row, or `null` when nothing is hovered. */
  tooltipData: TooltipData | null;
  /** Moves the hover (crosshair and tooltip) to `data.index`. Pass `null` to clear it. */
  setTooltipData: SetTooltipData;
  /** Current drag selection, or `null`. Read by `SegmentBackground` and the `SegmentLine*` children. */
  selection?: ChartSelection | null;
  /** Clears the current drag selection. */
  clearSelection?: () => void;
  /** Index of the hovered bar in a `BarChart`, or `null`. */
  hoveredBarIndex?: number | null;
  /** Moves the hover to a bar in a vertical `BarChart`. Pass `null` to clear it. */
  setHoveredBarIndex?: (index: number | null) => void;
  /** Index of the hovered candle in a `CandlestickChart`, or `null`. */
  hoveredCandleIndex?: number | null;
  /** Moves the hover to a candle. Pass `null` to clear it. */
  setHoveredCandleIndex?: (index: number | null) => void;
}

/** Chart state from `useChartStable()` that does not change on hover: data, scales, sizes and series. `ContainerRef` is the framework's ref type. */
export interface ChartStableContextValue<ContainerRef> {
  /** The chart's data rows. */
  data: Record<string, unknown>[];
  /** The rows that are drawn. Currently the same rows as `data`. */
  renderData: Record<string, unknown>[];
  /** Maps a date to an x pixel inside the plot area. */
  xScale: ScaleTime<number, number>;
  /** Scale of the primary (`"left"`) y axis. */
  yScale: ScaleLinear<number, number>;
  /** Y scale of every axis, keyed by `yAxisId`. */
  yScales: Record<string, ScaleLinear<number, number>>;
  /** Chart width in px. */
  width: number;
  /** Chart height in px. */
  height: number;
  /** Plot area width in px (chart width minus the left and right margins). */
  innerWidth: number;
  /** Plot area height in px (chart height minus the top and bottom margins). */
  innerHeight: number;
  /** Space around the plot area in px. */
  margin: Margin;
  /** Ref to the chart's container element. Use it to portal custom overlays into the chart. */
  containerRef: ContainerRef;
  /** The registered line series. */
  lines: LineConfig[];
  /** Entrance animation duration in ms. */
  animationDuration: number;
  /** `true` once the entrance has finished and the chart accepts input. */
  isLoaded: boolean;
  /** `"revealing"` until the entrance finishes, then `"ready"`. */
  chartPhase: ChartPhase;
  /** The chart's `status`: `"loading"` or `"ready"`. */
  chartStatus: ChartStatus;
  /** Resolved y domain `[min, max]` per `yAxisId`. */
  yDomainTargetByAxis: Record<string, [number, number]>;
  /** The `ReferenceArea` bands, in the order they appear in the chart. */
  referenceAreas: ReferenceAreaConfig[];
  /** Reads the x date from a data row. */
  xAccessor: (d: Record<string, unknown>) => Date;
  /** Formatted x labels, one per data row. */
  dateLabels: string[];
  /** Visible x range when the chart is zoomed, for example by a brush. */
  xDomain?: [Date, Date];
  /** Number of rows in the full dataset while the chart is zoomed. */
  xDomainSlotCount?: number;
  /** Width in px of the slot for one data row (bar and candlestick charts). */
  columnWidth?: number;
  /** Width in px of a candle body (`CandlestickChart`) or a bar band. */
  bandWidth?: number;
  /** Band scale for the categories of a `BarChart`. */
  barScale?: ScaleBand<string>;
  /** Reads the category from a data row (`BarChart`). */
  barXAccessor?: (d: Record<string, unknown>) => string;
  /** Bar direction: `"vertical"` or `"horizontal"` (`BarChart`). */
  orientation?: "vertical" | "horizontal";
  /** Whether bars are stacked (`BarChart`). */
  stacked?: boolean;
  /** Cumulative offsets for stacked bars: data index, then `dataKey`. */
  stackOffsets?: Map<number, Map<string, number>>;
  /** `dataKey`s of the `SeriesBar` series, in order (`ComposedChart`). */
  composedBarDataKeys?: string[];
  /** Bar width in px (`ComposedChart`). */
  composedBarSize?: number;
  /** Maximum bar width in px (`ComposedChart`). */
  composedMaxBarSize?: number;
  /** Gap between bars of the same row in px (`ComposedChart`). */
  composedBarGap?: number;
  /** Whether the `SeriesBar` series are stacked (`ComposedChart`). */
  composedStacked?: boolean;
  /** Gap between stacked bar segments in px (`ComposedChart`). */
  composedStackGap?: number;
}

/** Props of `ChartConfigProvider`. */
export interface ChartConfigProviderProps<Node> {
  /** Springs to override. Anything omitted keeps its default. */
  value?: Partial<ChartConfigValue>;
  /** The charts that use these settings. */
  children: Node;
}

/**
 * Spring settings shared through `ChartConfigProvider` and read with `useChartConfig()`. Charts in this package animate with fixed tweens and do not read them; they are for your own custom children.
 */
export interface ChartConfigValue {
  /**
   * Spring for the crosshair, tooltip dots and date pill.
   * @default { stiffness: 3600, damping: 120 } (the snappy variant's hover spring; bklit's is 300/30)
   */
  tooltipSpring: SpringConfig;
  /**
   * Spring for the floating tooltip panel.
   * @default { stiffness: 3600, damping: 120 } (the snappy variant's hover spring; bklit's is 100/20)
   */
  tooltipBoxSpring: SpringConfig;
  /**
   * Spring for the hover highlight band on line and area charts.
   * @default { stiffness: 3600, damping: 120 } (the snappy variant's hover spring; bklit's is 180/28)
   */
  highlightSpring: SpringConfig;
}
