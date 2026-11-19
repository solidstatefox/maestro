import type { ChartStatus } from "../motion/phase";
import type { MarkChartLoadingProps } from "./mark-chart-loading";

/** Props for `MarimekkoChart`: one column per data row, as wide as its total; its segments stack to 100%. */
export interface MarimekkoChartProps {
  /** One row per column: its `xDataKey` names it, each `MarimekkoSegment`'s `dataKey` is a value. */
  readonly data: readonly Record<string, unknown>[];
  /** The key of each row's column name. */
  readonly xDataKey: string;
  /**
   * Gap between columns and between segments, in px.
   * @default 2
   */
  readonly gap?: number;
  /**
   * Corner radius of the segments, in px.
   * @default 4
   */
  readonly radius?: number;
  /** Formats a value in the tooltip and labels. */
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
   * Play the entrance: each column's segments grow up from its base, column by column.
   * @default true
   */
  readonly animate?: boolean;
  /**
   * `"loading"` draws a shimmering skeleton (muted columns of stacked segments) in place of the chart and ignores the pointer; switching to `"ready"` plays the
   * entrance. Switching back to `"loading"` fades the chart out first.
   * @default "ready"
   */
  readonly status?: ChartStatus;
  /** Text shown centered over the plot, with a shimmer, while `status` is `"loading"`. Nothing is shown when it is unset or empty. */
  readonly loadingLabel?: string;
  readonly ariaLabel?: string;
  readonly ariaDescription?: string;
}

/** One series of a marimekko: a segment in every column. */
export interface MarimekkoSegmentProps {
  /** The key of its value in each row. */
  readonly dataKey: string;
  /** Its name in the tooltip and legend. Defaults to the `dataKey`. */
  readonly label?: string;
  /** Its colour. Defaults to the palette's, by position. */
  readonly fill?: string;
}

/** Props for `MarimekkoLabels`: each segment's share of its column, inside it where it fits. */
export interface MarimekkoLabelsProps {
  /**
   * Show the segment's value under its share.
   * @default false
   */
  readonly showValues?: boolean;
}

/** What a `ChartTooltip`'s `content({ point })` receives for a marimekko segment. */
export interface MarimekkoPoint {
  readonly [key: string]: unknown;
  /** The column's name, and its row. */
  readonly column: string;
  readonly row: Readonly<Record<string, unknown>>;
  /** The segment's series label, key and value. */
  readonly series: string;
  readonly dataKey: string;
  readonly value: number;
  /** Its share of its column, and the column's share of the whole, 0 to 1. */
  readonly share: number;
  readonly columnShare: number;
  readonly columnTotal: number;
  readonly color: string;
}

/** Props of `MarimekkoChartLoading`: a ready-made placeholder, `<MarimekkoChart status="loading" />` with no data. */
export interface MarimekkoChartLoadingProps extends MarkChartLoadingProps {}
