import type { YDomainOverride } from "../cartesian/y-domain-utils";
import type { ChartMargin } from "../theme";
import type { ChartDatum } from "./cartesian";
import type { ChartPhase, EnterTransition } from "../motion/phase";

export interface SeriesBarProps {
  /** Key of the data field that holds the bar heights. */
  readonly dataKey: string;
  /** Name of the series in the default tooltip row. Defaults to `dataKey`. */
  readonly label?: string;
  /**
   * Id of the y scale the bars stand on. An id without a `YAxis` is a hidden scale, handy for volume bars under a price. Stacked bars stack with the bars of their axis.
   * @default "left"
   */
  readonly yAxisId?: string | number;
  /**
   * Fill color of the bars.
   * @default "var(--chart-line-primary)"
   */
  readonly fill?: string;
  /** Color of the tooltip dot, for when `fill` is a gradient or pattern. Defaults to `fill`. */
  readonly stroke?: string;
  /**
   * Corner radius of the bars in px.
   * @default 0
   */
  readonly radius?: number;
  /**
   * Grow the bars from the baseline on entrance.
   * @default true
   */
  readonly animate?: boolean;
  /**
   * Opacity of the bars that are not hovered while another x position is focused.
   * @default 0.3
   */
  readonly fadedOpacity?: number;
}

export interface ComposedChartProps<Node> {
  /**
   * The rows to plot. Each row holds the x value under `xDataKey` and one number per series under that series' `dataKey`.
   */
  readonly data: ChartDatum[];
  /**
   * Key of the x value in each row. The value must be a `Date` (or something `new Date()` accepts).
   * @default "date"
   */
  readonly xDataKey?: string;
  /**
   * Duration of the entrance in milliseconds. `enterTransition.duration` overrides it.
   * @default 1100
   */
  readonly animationDuration?: number;
  /**
   * Space around the plot area in pixels. Missing sides use the default.
   * @default { top: 40, right: 40, bottom: 40, left: 40 }
   */
  readonly margin?: Partial<ChartMargin>;
  /**
   * CSS aspect ratio of the chart, as `"width / height"`.
   * @default "2 / 1"
   */
  readonly aspectRatio?: string;
  /** Extra CSS class name for the chart container. */
  readonly className?: string;
  /** Called with `"ready"` when the chart mounts. */
  readonly onPhaseChange?: (phase: ChartPhase) => void;
  /** Target `SeriesBar` width in px. When unset, bars size to the available space. */
  readonly barSize?: number;
  /** Maximum `SeriesBar` width in px. */
  readonly maxBarSize?: number;
  /**
   * Gap between the grouped `SeriesBar` columns in px.
   * @default 4
   */
  readonly barGap?: number;
  /**
   * Stack the `SeriesBar` segments in child order instead of grouping them.
   * @default false
   */
  readonly stacked?: boolean;
  /**
   * Per-axis y-domain overrides, keyed by `yAxisId` (`"left"` for the default axis): a fixed `[min, max]`, or a function of the auto domain
   * (before it is niced) that returns the one to use, e.g. `{ left: ([, max]) => [0, max * 3] }`. Define the object outside the component so it keeps its identity.
   */
  readonly yDomains?: Readonly<Record<string, YDomainOverride>>;
  /**
   * With a `SeriesBar` or a `Candlestick`, inset the x axis by half a slot on each side so the first and last bars clear the plot edges; lines and areas share the
   * inset scale. `false` draws edge to edge.
   * @default true
   */
  readonly barEdgeInset?: boolean;
  /**
   * Vertical gap between stacked segments in px.
   * @default 0
   */
  readonly stackGap?: number;
  /**
   * Accepted for bklit-ui compatibility. It has no effect in bklit-tanstack-charts. The entrance always uses the default tween ease.
   */
  readonly animationEasing?: string;
  /**
   * Overrides the entrance duration (`duration` is in seconds, as in bklit-ui). Springs are treated as the default tween.
   */
  readonly enterTransition?: EnterTransition;
  /** Changing this string replays the entrance animation. */
  readonly revealSignature?: string;
  /**
   * The layers to draw: `SeriesBar`, `Line`, `Area`, `Scatter`, `Candlestick`, `ProfitLossLine`, `Grid`, `XAxis`, `YAxis`, `ChartTooltip` and the other chart children.
   */
  readonly children: Node;
  /**
   * Accessible name of the chart.
   * @default "Composed chart"
   */
  readonly ariaLabel?: string;
  /** Longer accessible description of the chart, exposed as `aria-description`. */
  readonly ariaDescription?: string;
}
