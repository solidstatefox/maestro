import type { ChartMargin } from "../theme";
import type { PlotChartLoadingProps, PlotLoadingProps } from "./plot-loading";

/** Props of `LollipopChart`. */
export interface LollipopChartProps<Node, Style> extends PlotLoadingProps {
  /** The rows, one lollipop each, in the order given (sort them when rank is the point). */
  readonly data: readonly Record<string, unknown>[];
  /**
   * The key of each row's category label.
   * @default "name"
   */
  readonly xDataKey?: string;
  /**
   * `"vertical"` stands the stems up from the bottom; `"horizontal"` runs them from the left, the categories down the side.
   * @default "vertical"
   */
  readonly orientation?: "vertical" | "horizontal";
  /**
   * Aspect ratio of the chart, as `"width / height"` or a number.
   * @default "2 / 1"
   */
  readonly aspectRatio?: string | number;
  /** Space around the plot in px. */
  readonly margin?: Partial<ChartMargin>;
  /**
   * Animate the lollipops in on mount: each stem grows from the baseline, one after another, its head following.
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
   * @default "Lollipop chart"
   */
  readonly ariaLabel?: string;
  /** Longer accessible description of the chart. */
  readonly ariaDescription?: string;
  /** Extra class name for the chart container. */
  readonly className?: string;
  /** Inline styles for the chart container. */
  readonly style?: Style;
  /** The chart's parts: `Lollipop`, `Grid`, `BarXAxis`, `BarYAxis` and `ChartTooltip`. */
  readonly children?: Node;
}

/** Props of `Lollipop`: the stems, their heads and their labels. */
export interface LollipopProps {
  /** The key of each row's value. */
  readonly dataKey: string;
  /** The series' name in the tooltip. Defaults to `dataKey`. */
  readonly label?: string;
  /**
   * Colour of the stems and heads.
   * @default "var(--chart-1)"
   */
  readonly color?: string;
  /**
   * Radius of the heads in px.
   * @default 6
   */
  readonly radius?: number;
  /**
   * Width of the stems in px.
   * @default 2
   */
  readonly strokeWidth?: number;
  /**
   * Opacity of the stems (the heads are full).
   * @default 0.45
   */
  readonly stemOpacity?: number;
  /** Label each head with its value. */
  readonly showValues?: boolean;
  /** Formats a value in the labels and the tooltip. Defaults to a grouped integer. */
  readonly formatValue?: (value: number) => string;
  /**
   * Opacity of the other lollipops while one is hovered.
   * @default 0.3
   */
  readonly fadedOpacity?: number;
}

/** Props of `LollipopChartLoading`: `<LollipopChart status="loading" />` with no data and no parts. */
export type LollipopChartLoadingProps = PlotChartLoadingProps;
