import type { ChartMargin } from "../theme";
import type { PlotChartLoadingProps, PlotLoadingProps } from "./plot-loading";

/** Props of `ErrorBarChart`. */
export interface ErrorBarChartProps<Node, Style> extends PlotLoadingProps {
  /** The rows, one estimate each, in the order given. */
  readonly data: readonly Record<string, unknown>[];
  /**
   * The key of each row's category label.
   * @default "name"
   */
  readonly xDataKey?: string;
  /**
   * `"vertical"` stands the intervals up; `"horizontal"` runs them left to right down a list of categories (a forest plot).
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
  /** A value to mark with a dashed rule across the plot (no effect, a target, a benchmark). */
  readonly reference?: number;
  /**
   * Animate the intervals in on mount: each grows from its low end to its high end, its estimate following.
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
   * @default "Error bar chart"
   */
  readonly ariaLabel?: string;
  /** Longer accessible description of the chart. */
  readonly ariaDescription?: string;
  /** Extra class name for the chart container. */
  readonly className?: string;
  /** Inline styles for the chart container. */
  readonly style?: Style;
  /** The chart's parts: `ErrorBar`, `Grid`, `BarXAxis`, `BarYAxis` and `ChartTooltip`. */
  readonly children?: Node;
}

/** Props of `ErrorBar`: each row's interval, its caps and its estimate. */
export interface ErrorBarProps {
  /** The key of each row's estimate. */
  readonly dataKey: string;
  /** The key of each row's low bound. */
  readonly lowKey: string;
  /** The key of each row's high bound. */
  readonly highKey: string;
  /** The estimate's name in the tooltip. Defaults to `dataKey`. */
  readonly label?: string;
  /**
   * The interval's name in the tooltip, for example `"95% CI"`.
   * @default "Range"
   */
  readonly intervalLabel?: string;
  /**
   * Colour of the intervals and estimates. A row's own `color` field wins.
   * @default "var(--chart-1)"
   */
  readonly color?: string;
  /**
   * Draw a cap across each end of the interval.
   * @default true
   */
  readonly showCaps?: boolean;
  /**
   * Width of a cap in px.
   * @default 14
   */
  readonly capWidth?: number;
  /**
   * Width of the interval's line in px.
   * @default 2
   */
  readonly strokeWidth?: number;
  /**
   * Radius of the estimate's dot in px.
   * @default 5
   */
  readonly radius?: number;
  /** Formats a value in the tooltip and on the value axis. Defaults to a grouped number. */
  readonly formatValue?: (value: number) => string;
  /**
   * Opacity of the other rows while one is hovered.
   * @default 0.3
   */
  readonly fadedOpacity?: number;
}

/** Props of `RibbonChart`. */
export interface RibbonChartProps<Node, Style> extends PlotLoadingProps {
  /** The rows, one per time, oldest first: each holds its date under `xDataKey` and the bounds the `Ribbon`s and `RibbonLine` read. */
  readonly data: readonly Record<string, unknown>[];
  /**
   * The key of each row's date (a `Date`, an ISO string or epoch milliseconds).
   * @default "date"
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
   * Animate the ribbons and the line in on mount.
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
   * @default "Ribbon chart"
   */
  readonly ariaLabel?: string;
  /** Longer accessible description of the chart. */
  readonly ariaDescription?: string;
  /** Extra class name for the chart container. */
  readonly className?: string;
  /** Inline styles for the chart container. */
  readonly style?: Style;
  /** The chart's parts: `Ribbon`s (widest first), `RibbonLine`s, `Grid`, `XAxis`, `YAxis` and `ChartTooltip`. */
  readonly children?: Node;
}

/** Props of `Ribbon`: one band between a low and a high bound over time (a quantile range, a forecast interval). */
export interface RibbonProps {
  /** The key of each row's low bound. */
  readonly lowKey: string;
  /** The key of each row's high bound. */
  readonly highKey: string;
  /** The band's name in the tooltip, for example `"10th–90th percentile"`. Defaults to `lowKey–highKey`. */
  readonly label?: string;
  /**
   * Colour of the band.
   * @default "var(--chart-1)"
   */
  readonly fill?: string;
  /**
   * Opacity of the band's fill. Nested bands read best widest-faintest.
   * @default 0.2
   */
  readonly fillOpacity?: number;
}

/** Props of `RibbonLine`: a line through the ribbons (the median, the forecast). */
export interface RibbonLineProps {
  /** The key of each row's value. */
  readonly dataKey: string;
  /** The line's name in the tooltip. Defaults to `dataKey`. */
  readonly label?: string;
  /**
   * Colour of the line.
   * @default "var(--chart-1)"
   */
  readonly stroke?: string;
  /**
   * Width of the line in px.
   * @default 2
   */
  readonly strokeWidth?: number;
  /** Dash pattern of the line, for example `"4 4"` for a forecast. */
  readonly strokeDasharray?: string;
  /** Formats a value in the tooltip and on the value axis. Defaults to a grouped number. */
  readonly formatValue?: (value: number) => string;
}

/** Props of `ErrorBarChartLoading`: `<ErrorBarChart status="loading" />` with no data and no parts. */
export type ErrorBarChartLoadingProps = PlotChartLoadingProps;

/** Props of `RibbonChartLoading`: `<RibbonChart status="loading" />` with no data and no parts. */
export type RibbonChartLoadingProps = PlotChartLoadingProps;
