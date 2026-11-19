import type { ChartStatus } from "../motion/phase";
import type { ChartMargin } from "../theme";

/** The loading state's props on a plot chart. */
export interface PlotLoadingProps {
  /**
   * `"loading"` draws a shimmering skeleton shaped like the chart in place of its marks and ignores the pointer; switching to `"ready"`
   * plays the chart's entrance.
   * @default "ready"
   */
  readonly status?: ChartStatus;
  /** Centered label shown over the plot while `status` is `"loading"`. */
  readonly loadingLabel?: string;
}

/** Props of a plot chart's ready-made loading placeholder: the chart with `status="loading"`, no data and no parts. */
export interface PlotChartLoadingProps {
  /** Space around the plot in px. Missing sides use the chart's default. */
  readonly margin?: Partial<ChartMargin>;
  /**
   * Aspect ratio of the placeholder, as `"width / height"` or a number.
   * @default the chart's
   */
  readonly aspectRatio?: string | number;
  /** Text shown centered over the skeleton, with a shimmer. Nothing is shown when it is unset or empty. */
  readonly label?: string;
  /** @deprecated Use `label`, the name every chart's placeholder takes. */
  readonly loadingLabel?: string;
  /** Extra class name for the chart container. */
  readonly className?: string;
}

/** Props of `GanttChartLoading`: a Gantt's placeholder takes its height from its rows (six of them). */
export interface GanttChartLoadingProps {
  /** Space around the plot in px. Missing sides use the chart's default. */
  readonly margin?: Partial<ChartMargin>;
  /**
   * Height of each skeleton row in px.
   * @default 36
   */
  readonly rowHeight?: number;
  /** Text shown centered over the skeleton, with a shimmer. Nothing is shown when it is unset or empty. */
  readonly label?: string;
  /** @deprecated Use `label`, the name every chart's placeholder takes. */
  readonly loadingLabel?: string;
  /** Extra class name for the chart container. */
  readonly className?: string;
}
