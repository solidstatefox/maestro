import type { ChartStatus } from "../motion/phase";
import type { MarkChartLoadingProps } from "./mark-chart-loading";

/** Props for `DivergingBarChart`: one horizontal bar per row, its ordered segments centred on a neutral point (a Likert scale). */
export interface DivergingBarChartProps {
  /** One row per bar: its `yDataKey` names it, each `DivergingSegment`'s `dataKey` is a count or value. */
  readonly data: readonly Record<string, unknown>[];
  /** The key of each row's name. */
  readonly yDataKey: string;
  /**
   * The `dataKey` of the neutral segment, split across the centre line. Without one the centre falls between the first and second halves
   * of the segments (an odd count splits its middle one).
   */
  readonly center?: string;
  /**
   * Show each bar as shares of its row (every bar the same length) rather than raw values.
   * @default true
   */
  readonly normalize?: boolean;
  /**
   * The bars' thickness as a share of their row.
   * @default 0.62
   */
  readonly barSize?: number;
  /**
   * Corner radius of the bars' ends, in px.
   * @default 4
   */
  readonly radius?: number;
  /** Formats a value in the tooltip (the raw value; shares are shown beside it). */
  readonly formatValue?: (value: number) => string;
  /** Called with the hovered segment's series index, and `null` when the pointer leaves (pair it with a `ChartLegend`). */
  readonly onHoverChange?: (index: number | null) => void;
  /**
   * Width over height: a number or a string such as `"16 / 9"`.
   * @default "16 / 9"
   */
  readonly aspectRatio?: string | number;
  /** A fixed height in px instead of an aspect ratio. */
  readonly height?: number;
  /**
   * Play the entrance: the segments grow out from the centre line, row by row.
   * @default true
   */
  readonly animate?: boolean;
  /**
   * `"loading"` draws a shimmering skeleton (muted bars split at the centre line) in place of the chart and ignores the pointer; switching to `"ready"` plays the
   * entrance. Switching back to `"loading"` fades the chart out first.
   * @default "ready"
   */
  readonly status?: ChartStatus;
  /** Text shown centered over the plot, with a shimmer, while `status` is `"loading"`. Nothing is shown when it is unset or empty. */
  readonly loadingLabel?: string;
  readonly ariaLabel?: string;
  readonly ariaDescription?: string;
}

/** One ordered segment of a diverging bar chart (a response on the scale, from the most negative to the most positive). */
export interface DivergingSegmentProps {
  /** The key of its value in each row. */
  readonly dataKey: string;
  /** Its name in the tooltip and legend. Defaults to the `dataKey`. */
  readonly label?: string;
  /**
   * Its colour. Defaults to a diverging scheme from the theme: `--chart-negative` tints before the centre, a muted neutral at it,
   * `--chart-positive` tints after it, strongest at the ends.
   */
  readonly fill?: string;
}

/** Props for `DivergingLabels`: each segment's share inside it, where it fits. */
export interface DivergingLabelsProps {
  /**
   * Hide a label in a segment narrower than this, in px.
   * @default 30
   */
  readonly minWidth?: number;
}

/** What a `ChartTooltip`'s `content({ point })` receives for a diverging segment. */
export interface DivergingPoint {
  readonly [key: string]: unknown;
  /** The bar's name, and its row. */
  readonly name: string;
  readonly row: Readonly<Record<string, unknown>>;
  /** The segment's label, key, value and share of its row. */
  readonly series: string;
  readonly dataKey: string;
  readonly value: number;
  readonly share: number;
  /** The row's positive share minus its negative share (the neutral left out), -1 to 1. */
  readonly net: number;
  readonly color: string;
}

/** Props of `DivergingBarChartLoading`: a ready-made placeholder, `<DivergingBarChart status="loading" />` with no data. */
export interface DivergingBarChartLoadingProps extends MarkChartLoadingProps {}
