import type { FeatureCollection, Geometry } from "geojson";
import type { ChartStatus } from "../motion/phase";

/** Space around the plot, in pixels. */
export interface SpatialMargin {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** The props every spatial chart takes beside its data. */
export interface SpatialChartBaseProps<Node> {
  /**
   * Aspect ratio of the chart as "width / height".
   * @default "16 / 9"
   */
  readonly aspectRatio?: string;
  /** Space around the plot in pixels. Any side you omit keeps its default. */
  readonly margin?: Partial<SpatialMargin>;
  /**
   * Play the entrance animation.
   * @default true
   */
  readonly animate?: boolean;
  /**
   * Length of the entrance sweep in milliseconds: the time from the first mark starting to the last one.
   * @default 900
   */
  readonly animationDuration?: number;
  /** Changing this value replays the entrance animation. */
  readonly revealSignature?: string;
  /**
   * `"loading"` draws a pulsing skeleton of the chart's shape in place of its marks (the axes, grid and land stay) and ignores the
   * pointer; switching to `"ready"` plays the entrance.
   * @default "ready"
   */
  readonly status?: ChartStatus;
  /** Text shown centered over the chart, with a shimmer, while `status` is `"loading"`. Nothing is shown when it is unset or empty. */
  readonly loadingLabel?: string;
  /** Additional class name for the chart container. */
  readonly className?: string;
  /** The chart's carriers: its layers, axes, grid, tooltip and legend. */
  readonly children?: Node;
  /** Accessible label of the chart. */
  readonly ariaLabel?: string;
  /** Longer accessible description of the chart. */
  readonly ariaDescription?: string;
}

/**
 * Props of a spatial chart's ready-made loading placeholder (`HexbinChartLoading`, `DensityChartLoading`, `VectorFieldChartLoading`): the
 * chart with `status="loading"` and no data, its skeleton shimmering in the plot.
 */
export interface SpatialChartLoadingProps {
  /**
   * Aspect ratio of the placeholder as "width / height".
   * @default "16 / 9"
   */
  readonly aspectRatio?: string;
  /** Space around the plot in pixels. Any side you omit keeps its default. */
  readonly margin?: Partial<SpatialMargin>;
  /** Text shown centered over the skeleton, with a shimmer. Nothing is shown when it is unset or empty. */
  readonly label?: string;
  /**
   * Additional class name for the placeholder's container.
   * @default ""
   */
  readonly className?: string;
}

/** Props of a map's ready-made loading placeholder (`BubbleMapChartLoading`, `RouteMapChartLoading`, `GlobeChartLoading`): the skeleton on
 * the map's graticule, and on its land when you pass a `geography`. */
export interface SpatialMapChartLoadingProps extends SpatialChartLoadingProps {
  /** The countries to draw the land from, such as the kit's `worldCountries`. Without it the skeleton sits on the graticule alone. */
  readonly geography?: FeatureCollection<Geometry, Readonly<Record<string, unknown>> | null>;
}

/** Props of a spatial chart's x or y axis (`HexbinXAxis`, `DensityYAxis`…). */
export interface SpatialAxisProps {
  /**
   * Target number of tick labels.
   * @default 5
   */
  readonly numTicks?: number;
  /** Formats a tick value into its label. Defaults to the number, thousands abbreviated (`2k`). */
  readonly formatValue?: (value: number) => string;
  /** A title for the axis, drawn beside its labels. */
  readonly label?: string;
}

/** Props of a spatial chart's grid (`HexbinGrid`, `DensityGrid`, `VectorFieldGrid`). */
export interface SpatialGridProps {
  /**
   * Show horizontal grid lines, at the y axis's ticks.
   * @default true
   */
  readonly horizontal?: boolean;
  /**
   * Show vertical grid lines, at the x axis's ticks.
   * @default false
   */
  readonly vertical?: boolean;
  /**
   * Color of the grid lines.
   * @default "var(--chart-grid)"
   */
  readonly stroke?: string;
  /**
   * Dash pattern of the grid lines.
   * @default "4 4"
   */
  readonly strokeDasharray?: string;
}

/** Props every spatial tooltip carrier takes (`HexbinTooltip`, `BubbleMapTooltip`…); `Args` is what its `content` is called with. */
export interface SpatialTooltipProps<Node, Style, Args> {
  /** Custom tooltip content. Replaces the default title and rows, inside the same panel. */
  readonly content?: (args: Args) => Node;
  /**
   * Formats the value row of the default content.
   * @default the number with thousands separators
   */
  readonly formatValue?: (value: number) => string;
  /** The label of the value row of the default content. */
  readonly valueLabel?: string;
  /** Additional class name for the tooltip panel. */
  readonly className?: string;
  /** Inline styles merged onto the tooltip panel. */
  readonly panelStyle?: Style;
  /** Background color of the tooltip panel. Overrides the theme's popover color. */
  readonly backgroundColor?: string;
}

/** Props of a spatial chart's legend (`HexbinLegend`, `BubbleMapLegend`…): drawn under the plot. */
export interface SpatialLegendProps {
  /** A title before the legend's items. */
  readonly title?: string;
  /**
   * Formats the values the legend shows.
   * @default the number, thousands abbreviated (`2k`)
   */
  readonly formatValue?: (value: number) => string;
  /**
   * Where the legend sits in the row under the plot.
   * @default "center"
   */
  readonly align?: "start" | "center" | "end";
  /** Additional class name for the legend. */
  readonly className?: string;
}

/** What hovering a layer does to the rest of the chart. */
export interface SpatialHoverProps {
  /**
   * Dim the layer's other marks while one is hovered or focused.
   * @default true
   */
  readonly fadeOnHover?: boolean;
  /**
   * Opacity of the other marks while one is hovered or focused.
   * @default 0.35
   */
  readonly inactiveOpacity?: number;
}

/** A row of a spatial chart's data. */
export type SpatialRow = Readonly<Record<string, unknown>>;
