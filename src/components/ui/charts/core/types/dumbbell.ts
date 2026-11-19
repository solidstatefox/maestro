import type { ChartMargin } from "../theme";
import type { PlotChartLoadingProps, PlotLoadingProps } from "./plot-loading";

/** Props of `DumbbellChart`. */
export interface DumbbellChartProps<Node, Style> extends PlotLoadingProps {
  /** The rows, one dumbbell each, in the order given. */
  readonly data: readonly Record<string, unknown>[];
  /**
   * The key of each row's category label.
   * @default "name"
   */
  readonly xDataKey?: string;
  /**
   * `"horizontal"` runs each dumbbell left to right, the categories down the side; `"vertical"` stands them up.
   * @default "horizontal"
   */
  readonly orientation?: "vertical" | "horizontal";
  /**
   * Aspect ratio of the chart, as `"width / height"` or a number.
   * @default "3 / 2"
   */
  readonly aspectRatio?: string | number;
  /** Space around the plot in px. */
  readonly margin?: Partial<ChartMargin>;
  /**
   * Animate the dumbbells in on mount: the first value appears, the bar stretches to the second, one row after another.
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
   * @default "Dumbbell chart"
   */
  readonly ariaLabel?: string;
  /** Longer accessible description of the chart. */
  readonly ariaDescription?: string;
  /** Extra class name for the chart container. */
  readonly className?: string;
  /** Inline styles for the chart container. */
  readonly style?: Style;
  /** The chart's parts: `Dumbbell`, `Grid`, `BarXAxis`, `BarYAxis` and `ChartTooltip`. */
  readonly children?: Node;
}

/** Props of `Dumbbell`: the two dots per row and the bar between them. */
export interface DumbbellProps {
  /** The key of each row's first value (the before). */
  readonly from: string;
  /** The key of each row's second value (the after). */
  readonly to: string;
  /** The first value's name in the tooltip and the legend. Defaults to `from`. */
  readonly fromLabel?: string;
  /** The second value's name in the tooltip and the legend. Defaults to `to`. */
  readonly toLabel?: string;
  /**
   * Colour of the first values' dots.
   * @default "var(--chart-foreground-muted)"
   */
  readonly fromColor?: string;
  /**
   * Colour of the second values' dots.
   * @default "var(--chart-1)"
   */
  readonly toColor?: string;
  /**
   * Colour of the bar between the dots. Defaults to the second value's colour, faded.
   */
  readonly barColor?: string;
  /**
   * Thickness of the bar between the dots in px.
   * @default 6
   */
  readonly barSize?: number;
  /**
   * Radius of the dots in px.
   * @default 6
   */
  readonly radius?: number;
  /** Label both ends with their values. */
  readonly showValues?: boolean;
  /**
   * Show the change from the first value to the second in the tooltip, as a difference and a percentage.
   * @default true
   */
  readonly showChange?: boolean;
  /** Formats a value in the labels and the tooltip. Defaults to a grouped integer. */
  readonly formatValue?: (value: number) => string;
  /**
   * Opacity of the other rows while one is hovered.
   * @default 0.3
   */
  readonly fadedOpacity?: number;
}

/** Props of `DumbbellChartLoading`: `<DumbbellChart status="loading" />` with no data and no parts. */
export type DumbbellChartLoadingProps = PlotChartLoadingProps;
