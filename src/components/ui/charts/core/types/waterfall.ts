import type { ChartMargin } from "../theme";
import type { PlotChartLoadingProps, PlotLoadingProps } from "./plot-loading";

/** Props of `WaterfallChart`. */
export interface WaterfallChartProps<Node, Style> extends PlotLoadingProps {
  /** The steps, left to right: each row's `Waterfall` `dataKey` is its signed change; a row whose `totalKey` field is true is a total (see `Waterfall`). */
  readonly data: readonly Record<string, unknown>[];
  /**
   * The key of each row's category label.
   * @default "label"
   */
  readonly xDataKey?: string;
  /**
   * Aspect ratio of the chart, as `"width / height"` or a number.
   * @default "2 / 1"
   */
  readonly aspectRatio?: string | number;
  /** Space around the plot in px. */
  readonly margin?: Partial<ChartMargin>;
  /**
   * Gap between the bars, as a share of each band.
   * @default 0.24
   */
  readonly barGap?: number;
  /**
   * Animate the bars in on mount: each grows from where the one before it ended, left to right.
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
   * @default "Waterfall chart"
   */
  readonly ariaLabel?: string;
  /** Longer accessible description of the chart. */
  readonly ariaDescription?: string;
  /** Extra class name for the chart container. */
  readonly className?: string;
  /** Inline styles for the chart container. */
  readonly style?: Style;
  /** The chart's parts: `Waterfall`, `Grid`, `BarXAxis`, `BarYAxis` and `ChartTooltip`. */
  readonly children?: Node;
}

/** Props of `Waterfall`: the bars, their connectors and their labels. */
export interface WaterfallProps {
  /** The key of each row's signed change. */
  readonly dataKey: string;
  /**
   * The key of the field that marks a total row (`true`), drawn from zero: with a value of its own it sets the running total to it (a
   * starting balance), without one it shows the running total (a subtotal).
   * @default "total"
   */
  readonly totalKey?: string;
  /** Append a bar for the final total, labelled `totalLabel`. */
  readonly showTotal?: boolean;
  /**
   * The appended total's label.
   * @default "Total"
   */
  readonly totalLabel?: string;
  /** The series' name in the tooltip. */
  readonly label?: string;
  /**
   * Fill of the increases.
   * @default "var(--chart-positive)"
   */
  readonly positiveFill?: string;
  /**
   * Fill of the decreases.
   * @default "var(--chart-negative)"
   */
  readonly negativeFill?: string;
  /**
   * Fill of the subtotals and the total.
   * @default "var(--chart-1)"
   */
  readonly totalFill?: string;
  /**
   * Draw a dashed step from each bar's end to the next bar.
   * @default true
   */
  readonly showConnectors?: boolean;
  /**
   * Label each bar with its change (a subtotal with its total).
   * @default true
   */
  readonly showValues?: boolean;
  /** Formats a value in the labels and the tooltip. Defaults to a grouped integer, changes with their sign. */
  readonly formatValue?: (value: number) => string;
  /**
   * Corner radius of the bars in px.
   * @default 4
   */
  readonly radius?: number;
  /**
   * Opacity of the other bars while one is hovered.
   * @default 0.3
   */
  readonly fadedOpacity?: number;
}

/** Props of `WaterfallChartLoading`: `<WaterfallChart status="loading" />` with no data and no parts. */
export type WaterfallChartLoadingProps = PlotChartLoadingProps;
