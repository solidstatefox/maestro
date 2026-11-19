import type { ChartMargin } from "../theme";
import type { PlotChartLoadingProps, PlotLoadingProps } from "./plot-loading";

/** Props of `BumpChart`. */
export interface BumpChartProps<Node, Style> extends PlotLoadingProps {
  /** The periods, oldest first: each row holds its label under `xDataKey` and one value per series under that series' `Bump` `dataKey`. */
  readonly data: readonly Record<string, unknown>[];
  /**
   * The key of each row's period label.
   * @default "period"
   */
  readonly xDataKey?: string;
  /**
   * How a period's values become ranks: `"descending"` puts the largest first, `"ascending"` the smallest (a time, a price); `"none"`
   * reads the values as ranks already.
   * @default "descending"
   */
  readonly rankBy?: "descending" | "ascending" | "none";
  /**
   * Write each series' name at the end of its line.
   * @default true
   */
  readonly showLabels?: boolean;
  /**
   * Aspect ratio of the chart, as `"width / height"` or a number.
   * @default "2 / 1"
   */
  readonly aspectRatio?: string | number;
  /** Space around the plot in px. With `showLabels`, the right side makes room for the names. */
  readonly margin?: Partial<ChartMargin>;
  /**
   * Animate the lines in on mount, left to right, their dots following.
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
   * @default "Bump chart"
   */
  readonly ariaLabel?: string;
  /** Longer accessible description of the chart. */
  readonly ariaDescription?: string;
  /** Extra class name for the chart container. */
  readonly className?: string;
  /** Inline styles for the chart container. */
  readonly style?: Style;
  /** The chart's parts: one `Bump` per series, `Grid`, `BarXAxis`, `BarYAxis` and `ChartTooltip`. */
  readonly children?: Node;
}

/** Props of `Bump`: one series' line through its ranks. */
export interface BumpProps {
  /** The key of the series' value in each row. */
  readonly dataKey: string;
  /** The series' name at the end of its line and in the tooltip. Defaults to `dataKey`. */
  readonly label?: string;
  /** Colour of the line and its dots. Defaults to the palette's next colour. */
  readonly color?: string;
  /**
   * Width of the line in px.
   * @default 3
   */
  readonly strokeWidth?: number;
  /** Formats the series' values in the tooltip. Defaults to a grouped number. */
  readonly formatValue?: (value: number) => string;
}

/** Props of `BumpChartLoading`: `<BumpChart status="loading" />` with no data and no parts. */
export type BumpChartLoadingProps = PlotChartLoadingProps;
