import type { CurveFactory } from "d3-shape";
import type { ChartMargin } from "../theme";

export interface MomentumColors {
  /** Color while the value is rising. */
  up: string;
  /** Color while the value is falling. */
  down: string;
  /** Color while the value is steady. */
  flat: string;
}

export interface LiveLineConfig {
  /** Key of the data field that holds the y values. */
  readonly dataKey: string;
  /** Series name in the default tooltip row, for example `"Price"`. Defaults to the `dataKey`, as in bklit-ui. */
  readonly label?: string;
  /**
   * Stroke color of the line.
   * @default "var(--chart-line-primary)"
   */
  readonly stroke?: string;
  /**
   * Stroke width of the line in px.
   * @default 2
   */
  readonly strokeWidth?: number;
  /**
   * Accepted for bklit-ui compatibility and ignored: the line is always bklit's default curveMonotoneX. Native rolling refuses a custom curve path (`custom-path`, `dist/motion-path.js:16`), so the curve is sampled into rows (`smoothRows` in definition.ts) and another factory cannot be swapped in.
   */
  readonly curve?: CurveFactory;
  /**
   * Show the gradient fill under the line.
   * @default true
   */
  readonly fill?: boolean;
  /**
   * Show the pulsing live dot at the right edge.
   * @default true
   */
  readonly pulse?: boolean;
  /**
   * Radius of the live dot in px.
   * @default 4
   */
  readonly dotSize?: number;
  /**
   * Show the value badge at the live tip.
   * @default true
   */
  readonly badge?: boolean;
  /** Formats a value for the badge, the tooltip and the y axis labels. Defaults to two decimals. */
  readonly formatValue?: (value: number) => string;
  /** Colors the line, fill and dot by momentum direction. Overrides `stroke` for the line. */
  readonly momentumColors?: MomentumColors;
}

export interface LiveXAxisConfig {
  /** Number of time labels. Defaults to the chart's `numXTicks`. */
  readonly numTicks?: number;
  /** Formats a time (in milliseconds since the epoch) into its label. Defaults to `HH:MM:SS`. */
  readonly formatTime?: (time: number) => string;
}

export interface LiveYAxisConfig {
  /**
   * Minimum gap in px between labels.
   * @default 36
   */
  readonly minGap?: number;
  /**
   * Side of the plot the labels sit on.
   * @default "left"
   */
  readonly position?: "left" | "right";
  /** Formats a tick value into its label. Defaults to the `LiveLine` `formatValue`. */
  readonly formatValue?: (value: number) => string;
  /**
   * Allow fractional tick values.
   * @default true
   */
  readonly allowDecimals?: boolean;
}

export interface LiveLinePoint {
  /** Time of the sample in Unix seconds. */
  readonly time: number;
  /** Value of the sample. */
  readonly value: number;
}

export interface LiveLineChartProps<Node, Style> {
  /** The streaming samples, oldest first. Append new points as they arrive. */
  readonly data: LiveLinePoint[];
  /** The latest value. The chart eases its display toward it. */
  readonly value: number;
  /**
   * Key used for the value field.
   * @default "value"
   */
  readonly dataKey?: string;
  /**
   * Visible time window in seconds.
   * @default 30
   */
  readonly window?: number;
  /**
   * Number of x axis labels; also sizes the leading offset.
   * @default 5
   */
  readonly numXTicks?: number;
  /**
   * Leading offset in x tick units. `0` puts "now" at the right edge.
   * @default 0
   */
  readonly nowOffsetUnits?: number;
  /**
   * Use a tight y range around the data instead of the default padded one.
   * @default false
   */
  readonly exaggerate?: boolean;
  /**
   * How fast the displayed value and y range ease toward their targets (0 to 1).
   * @default 0.08
   */
  readonly lerpSpeed?: number;
  /**
   * Space around the plot area in pixels. Missing sides use the default.
   * @default { top: 24, right: 16, bottom: 32, left: 16 }
   */
  readonly margin?: Partial<ChartMargin>;
  /**
   * Freeze the scrolling.
   * @default false
   */
  readonly paused?: boolean;
  /** The layers to draw: `LiveLine`, `Grid` (its horizontal rows; `vertical` columns are not drawn), `LiveXAxis`, `LiveYAxis`, `ChartTooltip`. */
  readonly children: Node;
  /** Extra CSS class name for the chart container. */
  readonly className?: string;
  /** Inline styles for the chart container. Set `height` to size the chart. */
  readonly style?: Style;
  /**
   * Accessible name of the chart.
   * @default "Live line chart"
   */
  readonly ariaLabel?: string;
  /** Longer accessible description of the chart, exposed as `aria-description`. */
  readonly ariaDescription?: string;
}
