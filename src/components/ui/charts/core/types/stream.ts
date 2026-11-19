import type { ChartStatus } from "../motion/phase";
import type { MarkChartLoadingProps } from "./mark-chart-loading";

/** Props for `StreamChart`: stacked layers around a moving baseline (a streamgraph), or a plain or normalised stack. */
export interface StreamChartProps {
  /** One row per x position: `xDataKey` holds a `Date` or a number, each `Stream`'s `dataKey` a value. */
  readonly data: readonly Record<string, unknown>[];
  /** The key of each row's x value. */
  readonly xDataKey: string;
  /**
   * Where the stack sits: `"wiggle"` (a streamgraph: the baseline moves to calm the layers), `"silhouette"` (centred on zero),
   * `"expand"` (every x normalised to 100%) or `"none"` (a stacked area from zero).
   * @default "wiggle"
   */
  readonly offset?: "wiggle" | "silhouette" | "expand" | "none";
  /**
   * Layer order: `"inside-out"` (the largest in the middle, as a streamgraph wants), `"ascending"`, `"descending"` or `"none"` (the
   * `Stream` order).
   * @default "inside-out"
   */
  readonly order?: "inside-out" | "ascending" | "descending" | "none";
  /**
   * The layers' curve.
   * @default "basis"
   */
  readonly curve?: "basis" | "natural" | "monotone" | "linear";
  /** Formats a value in the tooltip and the y axis. */
  readonly formatValue?: (value: number) => string;
  /** Formats an x value in the tooltip and the x axis (defaults: a date as "Jan 5", a number as is). */
  readonly formatX?: (value: unknown) => string;
  /** Called with the hovered layer's index (its `Stream`'s position), and `null` when the pointer leaves. */
  readonly onHoverChange?: (index: number | null) => void;
  /**
   * Width over height: a number or a string such as `"2 / 1"`.
   * @default "2 / 1"
   */
  readonly aspectRatio?: string | number;
  /** A fixed height in px instead of an aspect ratio. */
  readonly height?: number;
  /**
   * Play the entrance: the layers sweep in from the left.
   * @default true
   */
  readonly animate?: boolean;
  /**
   * `"loading"` draws a shimmering skeleton (muted wavy bands) in place of the chart and ignores the pointer; switching to `"ready"` plays the
   * entrance. Switching back to `"loading"` fades the chart out first.
   * @default "ready"
   */
  readonly status?: ChartStatus;
  /** Text shown centered over the plot, with a shimmer, while `status` is `"loading"`. Nothing is shown when it is unset or empty. */
  readonly loadingLabel?: string;
  readonly ariaLabel?: string;
  readonly ariaDescription?: string;
}

/** One layer of a stream chart. */
export interface StreamProps {
  /** The key of its value in each row. */
  readonly dataKey: string;
  /** Its name in the tooltip, its label and the legend. Defaults to the `dataKey`. */
  readonly label?: string;
  /** Its colour. Defaults to the palette's, by position. */
  readonly fill?: string;
}

/** Props for `StreamLabels`: each layer's name inside it, where it is thickest. */
export interface StreamLabelsProps {
  /**
   * Hide a label where its layer is thinner than this, in px.
   * @default 18
   */
  readonly minThickness?: number;
}

/** What a `ChartTooltip`'s `content({ point })` receives for a stream chart: the hovered x's row and layer. */
export interface StreamPoint {
  readonly [key: string]: unknown;
  /** The hovered row (every layer's value at this x). */
  readonly row: Readonly<Record<string, unknown>>;
  readonly x: unknown;
  /** The hovered layer's label, key, value and share of the x's total. */
  readonly series: string;
  readonly dataKey: string;
  readonly value: number;
  readonly share: number;
  readonly total: number;
  readonly color: string;
}

/** Props of `StreamChartLoading`: a ready-made placeholder, `<StreamChart status="loading" />` with no data. */
export interface StreamChartLoadingProps extends MarkChartLoadingProps {}
