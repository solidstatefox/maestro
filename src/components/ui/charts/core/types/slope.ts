import type { ChartMargin } from "../theme";
import type { PlotChartLoadingProps, PlotLoadingProps } from "./plot-loading";

/** Props of `SlopeChart`. */
export interface SlopeChartProps<Node, Style> extends PlotLoadingProps {
  /** The rows, one line each: a label under `labelKey` and the two values the `Slope` reads. */
  readonly data: readonly Record<string, unknown>[];
  /**
   * The key of each row's label.
   * @default "name"
   */
  readonly labelKey?: string;
  /**
   * Aspect ratio of the chart, as `"width / height"` or a number.
   * @default "4 / 3"
   */
  readonly aspectRatio?: string | number;
  /** Space around the plot in px. The sides make room for the labels. */
  readonly margin?: Partial<ChartMargin>;
  /**
   * Animate the lines in on mount, drawn from the first column to the second.
   * @default true
   */
  readonly animate?: boolean;
  /**
   * Length of the entrance in milliseconds.
   * @default 1100
   */
  readonly animationDuration?: number;
  /**
   * Accessible name of the chart.
   * @default "Slope chart"
   */
  readonly ariaLabel?: string;
  /** Longer accessible description of the chart. */
  readonly ariaDescription?: string;
  /** Extra class name for the chart container. */
  readonly className?: string;
  /** Inline styles for the chart container. */
  readonly style?: Style;
  /** The chart's parts: `Slope` and `ChartTooltip`. */
  readonly children?: Node;
}

/** Props of `Slope`: a line per row from its first value to its second, labelled at both ends. */
export interface SlopeProps {
  /** The key of each row's first value (the before). */
  readonly from: string;
  /** The key of each row's second value (the after). */
  readonly to: string;
  /** The first column's heading. Defaults to `from`. */
  readonly fromLabel?: string;
  /** The second column's heading. Defaults to `to`. */
  readonly toLabel?: string;
  /**
   * Colour of the rising lines.
   * @default "var(--chart-1)"
   */
  readonly increaseColor?: string;
  /**
   * Colour of the falling lines.
   * @default "var(--chart-negative)"
   */
  readonly decreaseColor?: string;
  /**
   * Width of the lines in px.
   * @default 2
   */
  readonly strokeWidth?: number;
  /**
   * Write each row's label and value beside its ends.
   * @default true
   */
  readonly showLabels?: boolean;
  /** Formats a value in the labels and the tooltip. Defaults to a grouped number. */
  readonly formatValue?: (value: number) => string;
  /**
   * Opacity of the other lines while one is hovered.
   * @default 0.18
   */
  readonly fadedOpacity?: number;
}

/** Props of `SlopeChartLoading`: `<SlopeChart status="loading" />` with no data and no parts. */
export type SlopeChartLoadingProps = PlotChartLoadingProps;
