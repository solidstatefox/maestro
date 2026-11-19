import type { ChartStatus } from "../motion/phase";
import type { ChartMargin } from "../theme";

/** One observation row: the chart reads its series' `dataKey` columns (and a category chart its `categoryKey`). */
export type DistributionRow = Readonly<Record<string, unknown>>;

/** Props every distribution chart takes, beside its own. */
export interface DistributionChartProps<Node, Style> {
  /** The observations, one object per row. Each series reads its `dataKey` column; rows without a finite number there are skipped. */
  readonly data: readonly DistributionRow[];
  /**
   * Width to height ratio of the chart, for example `"2 / 1"` or `"16 / 9"`.
   * @default "2 / 1"
   */
  readonly aspectRatio?: string;
  /** Space around the plot in pixels, per side. Each side defaults to fit the chart's axes. */
  readonly margin?: Partial<ChartMargin>;
  /**
   * Duration of the entrance in milliseconds.
   * @default 1100
   */
  readonly animationDuration?: number;
  /** Accessible name of the chart. Defaults to its kind, for example `"Histogram"` or `"Box plot"`. */
  readonly ariaLabel?: string;
  /** Accessible description of the chart. */
  readonly ariaDescription?: string;
  /**
   * `"loading"` draws a shimmering skeleton shaped like the chart in place of its marks and ignores the pointer; switching to `"ready"`
   * plays the entrance. Switching back to `"loading"` fades the marks out first.
   * @default "ready"
   */
  readonly status?: ChartStatus;
  /** Text shown centered over the plot, with a shimmer, while `status` is `"loading"`. Nothing is shown when it is unset or empty. */
  readonly loadingLabel?: string;
  /** Class names added to the chart's container. */
  readonly className?: string;
  /** Inline styles for the chart's container. */
  readonly style?: Style;
  /** The chart's parts: its series, `Grid`, axes and tooltip. */
  readonly children?: Node;
}

/** Props of a distribution chart's ready-made loading placeholder (`HistogramChartLoading`, `BoxPlotChartLoading`, …). */
export interface DistributionChartLoadingProps {
  /**
   * Width to height ratio of the placeholder, for example `"2 / 1"`.
   * @default "2 / 1"
   */
  readonly aspectRatio?: string;
  /** Space around the plot in pixels, per side. */
  readonly margin?: Partial<ChartMargin>;
  /** Text shown centered over the skeleton, with a shimmer. Nothing is shown when it is unset or empty. */
  readonly label?: string;
  /**
   * Class names added to the placeholder's container.
   * @default ""
   */
  readonly className?: string;
}

/** Props of the loading placeholder of a chart over categories that can lie either way (`BoxPlotChartLoading`, `ViolinChartLoading`, `BeeswarmChartLoading`). */
export interface DistributionOrientedChartLoadingProps extends DistributionChartLoadingProps {
  /** `"vertical"`: the skeleton's categories along the bottom. `"horizontal"`: down the side. Defaults to the chart's own default. */
  readonly orientation?: "vertical" | "horizontal";
}

/** Props of a distribution chart's axes (`HistogramXAxis`, `BoxPlotYAxis`, …). On a category axis only the labels' own text shows. */
export interface DistributionAxisProps {
  /**
   * Target number of tick labels on a value axis.
   * @default 5
   */
  readonly numTicks?: number;
  /**
   * Abbreviate values of 1000 and above as thousands, for example `2k` or `1.5k`. Ignored when `formatValue` is set.
   * @default true
   */
  readonly formatLargeNumbers?: boolean;
  /** Formats a value tick into its label, for example `(value) => \`${value} ms\``. */
  readonly formatValue?: (value: number) => string;
}

/** What a distribution tooltip's `content` is called with: the hovered item and its position. */
export interface DistributionTooltipContext<Point> {
  /** The hovered item: a histogram bin, a box plot's summary, a beeswarm observation… (each family's `…Point` type). */
  readonly point: Point;
  /** Its position among the chart's items, in order. */
  readonly index: number;
}

/** Props of a distribution chart's tooltip (`HistogramTooltip`, `BoxPlotTooltip`, …). */
export interface DistributionTooltipProps<Node, Point> {
  /** Replaces the default panel body (a title over one row per value) with your own content for the hovered item. */
  readonly content?: (context: DistributionTooltipContext<Point>) => Node;
  /** Formats the values the default body shows. Defaults to the chart's value axis `formatValue`, else en-US numbers. */
  readonly formatValue?: (value: number) => string;
}

/** Style props every distribution series takes. */
export interface DistributionSeriesProps {
  /** Key of the numeric column this series reads from each row. */
  readonly dataKey: string;
  /** The series' name in the tooltip and legend. Defaults to `dataKey`. */
  readonly label?: string;
  /** Fill colour. Defaults to the series' palette colour, `var(--chart-1)` for the first. */
  readonly fill?: string;
  /** Outline colour. Defaults to the fill. */
  readonly stroke?: string;
  /**
   * Opacity of the other items while one is hovered (and of the other series while a legend row is).
   * @default 0.3
   */
  readonly fadedOpacity?: number;
  /**
   * Play the entrance.
   * @default true
   */
  readonly animate?: boolean;
}
