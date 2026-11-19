import type { ChartMargin } from "../theme";
import type { EnterTransition } from "../motion/phase";

export interface CandlestickProps {
  /**
   * Animate the candles in on entrance.
   * @default true
   */
  readonly animate?: boolean;
  /**
   * Fill color of candles that closed at or above their open.
   * @default "var(--chart-positive)"
   */
  readonly positiveFill?: string;
  /**
   * Fill color of candles that closed below their open.
   * @default "var(--chart-negative)"
   */
  readonly negativeFill?: string;
  /**
   * A fill (`url(#pattern-id)` of a pattern child) laid over the body of the candles that closed at or above their open. Their body and wick then
   * take the solid `--chart-positive` color under it.
   */
  readonly bodyPatternPositive?: string;
  /** A fill (`url(#pattern-id)`) laid over the body of the candles that closed below their open, on the solid `--chart-negative` color. */
  readonly bodyPatternNegative?: string;
  /**
   * Width in px of a frame drawn just inside each body, in the body's color: it outlines a pattern overlay.
   * @default 0
   */
  readonly insideStrokeWidth?: number;
  /**
   * Opacity of the candles that are not hovered while another candle is hovered.
   * @default 0.3
   */
  readonly fadedOpacity?: number;
  /**
   * Dim the candles that are not hovered.
   * @default true
   */
  readonly showHoverFade?: boolean;
  /**
   * Inside a `ComposedChart`: the y scale the candles are drawn on. Its domain floats around the wicks instead of starting at zero, so volume
   * bars on another axis keep their zero baseline. `CandlestickChart` has one price axis.
   * @default "left"
   */
  readonly yAxisId?: string | number;
  /**
   * Inside a `ComposedChart`: body width as a fraction of the slot between two x values (0.05 to 1). `CandlestickChart` sizes candles with
   * `candleGap` / `candleWidth`.
   * @default 0.6
   */
  readonly widthRatio?: number;
}

export interface OHLCDataPoint {
  /** String-keyed so a row is assignable to the definition's `Candle` record without a cast. */
  readonly [key: string]: unknown;
  /** Time of the candle. Must be a `Date` (the x key is `xDataKey`, default `"date"`). */
  date: Date;
  /** Opening price. */
  open: number;
  /** Highest price of the period. */
  high: number;
  /** Lowest price of the period. */
  low: number;
  /** Closing price. A candle with `close >= open` is positive. */
  close: number;
}

export interface CandlestickChartProps<Node, Style> {
  /** The candles to plot, one row per period. */
  readonly data: OHLCDataPoint[];
  /**
   * Key of the time value in each row. The value must be a `Date` or something `new Date()` accepts.
   * @default "date"
   */
  readonly xDataKey?: string;
  /**
   * Space around the plot area in pixels. Missing sides use the default.
   * @default { top: 40, right: 40, bottom: 40, left: 40 }
   */
  readonly margin?: Partial<ChartMargin>;
  /**
   * Duration of the entrance in milliseconds.
   * @default 1100
   */
  readonly animationDuration?: number;
  /**
   * Customizes the entrance: a spring, or a cubic-bezier tween with a `duration` in seconds. See `EnterTransition`.
   */
  readonly enterTransition?: EnterTransition;
  /** Changing this string replays the entrance animation. */
  readonly revealSignature?: string;
  /**
   * CSS aspect ratio of the chart, as `"width / height"`.
   * @default "2 / 1"
   */
  readonly aspectRatio?: string;
  /** Extra CSS class name for the chart container. */
  readonly className?: string;
  /**
   * Inline styles for the chart container. `aspectRatio: "unset"` or an explicit `height` makes the chart fill the container height.
   */
  readonly style?: Style;
  /**
   * Gap between candle slots as a fraction of the slot width (0-1). Ignored when `candleWidth` is set. A gap below the default cannot widen candles past 80% of their spacing.
   * @default 0.2
   */
  readonly candleGap?: number;
  /** Fixed candle body width in px. When unset, candles size to the spacing between them. */
  readonly candleWidth?: number;
  /** Visible x range as `[start, end]`, used for brush zoom. The chart plots only this range of `data`. */
  readonly xDomain?: [Date, Date];
  /**
   * Length of the full dataset while `xDomain` zooms into part of it. It keeps candle spacing consistent with the unzoomed chart.
   */
  readonly xDomainSlotCount?: number;
  /** The layers to draw: `Candlestick`, `Grid`, `XAxis`, `YAxis`, `ChartTooltip` and the other chart children. */
  readonly children: Node;
  /**
   * Accessible name of the chart.
   * @default "Candlestick chart"
   */
  readonly ariaLabel?: string;
  /** Longer accessible description of the chart, exposed as `aria-description`. */
  readonly ariaDescription?: string;
}
