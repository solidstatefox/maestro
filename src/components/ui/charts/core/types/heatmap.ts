import type { HeatmapWeekStartDay, HeatmapYAxisLabelFormat, HeatmapYAxisTickFilter } from "../heatmap/day-labels";
import type { HeatmapSeparatorGradient, HeatmapSeparatorGroupBy, HeatmapSeparatorLayout, HeatmapSeparatorParsedConfig, HeatmapSeparatorStrokeStyle } from "../heatmap/separators";
import type { HeatmapLinearScale, HeatmapTimeScale } from "../heatmap/scales";
import type { ChartPhase } from "../motion/phase";
import type { HeatmapEnterTransition, HeatmapRevealMode } from "../heatmap/motion";
import type { HeatmapLevelColors, HeatmapLevelStyles } from "../heatmap/colors";
import type { HeatmapColumn } from "../heatmap/columns";
import type { SpringConfig } from "./cartesian";
import type { ChartMarkRenderer } from "../canvas/renderer";

/** Props of `HeatmapCells`. */
export interface HeatmapCellsProps {
  /**
   * Corner radius of each cell in pixels.
   * @default 2
   */
  readonly cornerRadius?: number;
  /** Overrides the chart color scale for the cells. Receives a count and returns a CSS color. */
  readonly colorScale?: (count: number | null | undefined) => string;
  /**
   * Opacity of the cells that are not highlighted while hovering a cell or a legend level.
   * @default 0.3
   */
  readonly inactiveOpacity?: number;
  /**
   * Scale of the cells that are not highlighted while hovering.
   * @default 1
   */
  readonly inactiveScale?: number;
  /**
   * Scale of the highlighted cell while hovering.
   * @default 1
   */
  readonly activeScale?: number;
  /**
   * Opacity per display row (row `0` is the top row after `weekStartDay` rotation). A single number applies to every row; an array gives one value per row. Pass the same value to `HeatmapYAxis` to keep labels aligned.
   * @default 1
   */
  readonly rowOpacity?: number | readonly number[];
  /**
   * Enables pointer hover, dimming, tooltip and keyboard focus on the cells.
   * @default true
   */
  readonly interactive?: boolean;
  /**
   * Hides the out-of-range cells at the start and end of the grid (GitHub style).
   * @default true
   */
  readonly hideGhostCells?: boolean;
  /** Accessible name of the chart. `HeatmapChart` `ariaLabel` takes precedence. */
  readonly ariaLabel?: string;
  /** Accessible description of the chart. `HeatmapChart` `ariaDescription` takes precedence. */
  readonly ariaDescription?: string;
  /**
   * Where the cells draw: `"svg"`, one element per cell, or `canvasRenderer`, one bitmap, for thousands of cells (the axes, labels,
   * separators, hovered cell and tooltip stay SVG). On a canvas the cells reveal as one left-to-right sweep instead of cell by cell,
   * dim together on hover (`inactiveScale` doesn't shrink them), skip the fade back to loading, and can't take pattern fills.
   * @default "svg"
   */
  readonly renderer?: ChartMarkRenderer;
}

/** Props of `HeatmapXAxis`. */
export interface HeatmapXAxisProps {
  /** Additional class name for the month labels, for example `"text-foreground"` (a color class sets the label color). */
  readonly className?: string;
}

/** Props of `HeatmapYAxis`. */
export interface HeatmapYAxisProps {
  /** Additional class name for the weekday labels, for example `"text-foreground"` (a color class sets the label color). */
  readonly className?: string;
  /**
   * Which rows get a weekday label: every row, odd rows (Mon, Wed, Fri with a Sunday start) or even rows.
   * @default "odd"
   */
  readonly tickFilter?: HeatmapYAxisTickFilter;
  /**
   * `"full"` shows the abbreviated weekday (Mon); `"initial"` shows its first letter (M).
   * @default "full"
   */
  readonly labelFormat?: HeatmapYAxisLabelFormat;
  /** Opacity per display row for the labels. Pass the same value as `HeatmapCells` so faded rows and their labels stay aligned. */
  readonly rowOpacity?: number | readonly number[];
}

/** Props of `HeatmapTooltip`. */
export interface HeatmapTooltipProps<Style> {
  /**
   * Custom text for the contribution line of the tooltip. Receives the count and the cell date.
   * @default `N contribution(s)`
   */
  readonly formatLabel?: (count: number, date: Readonly<Date>) => string;
  /** Additional class name for the tooltip panel. */
  readonly className?: string;
  /** Inline styles for the tooltip panel. */
  readonly panelStyle?: Readonly<Style>;
  /** Background of the tooltip panel (a CSS color or variable). */
  readonly backgroundColor?: string;
  /**
   * Shows and hides the tooltip without enter or exit motion; the hide is still held for `hideDelay`.
   * @default false
   */
  readonly instant?: boolean;
  /**
   * Delay in milliseconds before the tooltip first appears. Moving between cells updates it immediately.
   * @default 0
   */
  readonly showDelay?: number;
  /**
   * Hold in milliseconds after the pointer leaves a cell before the tooltip hides. Reduces flicker between adjacent cells. The hold lasts
   * at least as long as the follow spring takes to settle.
   * @default 120
   */
  readonly hideDelay?: number;
  /**
   * Damping of the spring the panel follows the hovered cell with, on the same scale as `ChartTooltip`'s. `0` snaps between cells.
   * @default 20
   */
  readonly damping?: number;
  /** An explicit follow spring (`stiffness`, `damping`) for the panel; takes precedence over `damping`. */
  readonly springConfig?: SpringConfig;
}

/** Props of `HeatmapSeparator`. */
export interface HeatmapSeparatorProps {
  /** Inserts a separator before every Nth column when `groupBy` is `"every"`. */
  readonly every?: number;
  /**
   * Groups columns by a fixed interval (`"every"`) or by calendar quarter (`"quarter"`).
   * @default "every"
   */
  readonly groupBy?: HeatmapSeparatorGroupBy;
  /** Additional class name for each separator line. */
  readonly className?: string;
  /**
   * Extra horizontal gap between column groups in pixels.
   * @default 0
   */
  readonly spacing?: number;
  /** Accepted for bklit compatibility; it has no effect. */
  readonly paddingX?: number;
  /**
   * Inset of the line from the bottom of the plot in pixels.
   * @default 0
   */
  readonly paddingY?: number;
  /**
   * Distance from the container top to the start of the line in pixels; the quarter labels then sit there too (plus `labelOffset`). A
   * negative value starts the lines and labels above the chart: leave room for them above it (for example `-20` with 20px of padding).
   * @default the top of the plot (the labels sit just above the grid)
   */
  readonly startOffset?: number;
  /**
   * Distance below the top of the line at which quarter labels sit; `0` aligns them with the line top.
   * @default 0
   */
  readonly labelOffset?: number;
  /**
   * Draws a label at the start of each quarter group.
   * @default false
   */
  readonly showLabels?: boolean;
  /**
   * Formats the quarter labels. Receives the quarter (1 to 4) and the start date of the group.
   * @default `Q{n}`
   */
  readonly labelFormat?: (quarter: number, startDate: Readonly<Date>) => string;
  /** Additional class name for the quarter labels, for example `"text-foreground"` (a color class sets the label color). */
  readonly labelClassName?: string;
  /**
   * Solid or dashed line.
   * @default "solid"
   */
  readonly strokeStyle?: HeatmapSeparatorStrokeStyle;
  /**
   * Dash pattern used when `strokeStyle` is `"dashed"`.
   * @default "4,4"
   */
  readonly strokeDasharray?: string;
  /**
   * Line color, used when `gradient` is omitted.
   * @default "var(--bkm-border)"
   */
  readonly stroke?: string;
  /** Vertical gradient along each line, for fading the ends. Omit for a flat stroke. */
  readonly gradient?: Readonly<HeatmapSeparatorGradient>;
  /**
   * Line width in pixels.
   * @default 1
   */
  readonly strokeWidth?: number;
  /**
   * Opacity multiplier for a solid stroke or for the gradient stops.
   * @default 1
   */
  readonly strokeOpacity?: number;
}

type ChartStatus = "loading" | "ready" | "error";

export interface HeatmapMargin {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** Cell layout of the chart: `"fluid"` sizes square cells to the width, `"fill"` expands cells to the parent. */
export type HeatmapLayout = "fluid" | "fill";

/** Config published by a `<HeatmapTooltip>` child (read by scanning the chart's children). */
export interface HeatmapTooltipConfig<Style = unknown> {
  readonly formatLabel: (count: number, date: Readonly<Date>) => string;
  readonly className: string;
  readonly panelStyle?: Readonly<Style>;
  readonly backgroundColor?: string;
  /** Maps to native `tooltip.motion: false` (no entry/move/exit motion). */
  readonly instant: boolean;
  /** bklit useDelayedTooltipData showDelay (ms, default 0): first-hover delay, applied by fixed CSS off a host var. */
  readonly showDelay: number;
  /** bklit hideDelay (ms, default 120): hold after leaving a cell. */
  readonly hideDelay: number;
  /** bklit HeatmapTooltip damping: the follow spring's damping slider (`0` snaps), unless `springConfig` is set. */
  readonly damping?: number;
  /** bklit HeatmapTooltip springConfig: an explicit follow spring. */
  readonly springConfig?: SpringConfig;
}

/** Config published by a `<HeatmapSeparator>` child. */
export interface HeatmapSeparatorStyle {
  readonly strokeStyle?: HeatmapSeparatorStrokeStyle;
  readonly strokeDasharray?: string;
  readonly stroke?: string;
  readonly strokeWidth?: number;
  readonly strokeOpacity?: number;
  readonly gradient?: Readonly<HeatmapSeparatorGradient>;
  readonly paddingY?: number;
  readonly startOffset?: number;
  readonly showLabels?: boolean;
  readonly labelOffset?: number;
  readonly labelFormat?: (quarter: number, startDate: Readonly<Date>) => string;
  readonly labelClassName?: string;
  readonly className?: string;
}

export interface HeatmapYAxisConfig {
  readonly className?: string;
  readonly tickFilter: HeatmapYAxisTickFilter;
  readonly labelFormat: HeatmapYAxisLabelFormat;
  readonly rowOpacity: number | readonly number[] | undefined;
}

/** Values the chart shares with its sub-components, as returned by `useHeatmap`. */
export interface HeatmapContextValue<ContainerRef, Style> {
  /** The week columns being drawn, after `xDomain` filtering and `weekStartDay` rotation. */
  readonly data: HeatmapColumn[];
  /** Cell width in pixels. */
  readonly binWidth: number;
  /** Cell height in pixels (cells are square, so equal to `binWidth`). */
  readonly binHeight: number;
  /** Gap between cells in pixels. */
  readonly gap: number;
  /** Resolved chart margins in pixels. */
  readonly margin: HeatmapMargin;
  /** Total chart width in pixels. */
  readonly width: number;
  /** Total chart height in pixels. */
  readonly height: number;
  /** Always `undefined`; kept for bklit compatibility. */
  readonly fixedWidth?: number | undefined;
  /** Plot width in pixels (the grid, separator gutters included). */
  readonly innerWidth: number;
  /** Plot height in pixels. */
  readonly innerHeight: number;
  /** Number of week columns drawn. */
  readonly columnCount?: number;
  /** Number of rows per column (7 for a week). */
  readonly rowCount?: number;
  /** Where column separators sit, or `null` when none are configured. */
  readonly separatorLayout: HeatmapSeparatorLayout | null;
  /** Left edge of a column in plot pixels, separator gutters included. */
  readonly xScale: (columnIndex: number) => number;
  /** Top edge of a row in plot pixels. */
  readonly yScale: (rowIndex: number) => number;
  /** Data extent (first column start to last column end) mapped onto the plot width. */
  readonly timeXScale: HeatmapTimeScale;
  /** Unit domain mapped onto the plot height, for overlays that need a vertical scale. */
  readonly brushYScale: HeatmapLinearScale;
  /** Ref to the chart container element. */
  readonly containerRef: ContainerRef;
  /** Whether the chart is large enough to draw. */
  readonly isReady: boolean;
  /** The resolved five level styles. */
  readonly levelStyles: HeatmapLevelStyles;
  /** Maps a count to the cell color for its level. */
  readonly colorScale: (count: number | null | undefined) => string;
  /** Maps a count to the cell fill, which is a `url(#...)` pattern reference for pattern levels and the color otherwise. */
  readonly fillScale: (count: number | null | undefined) => string;
  /** Whether a custom `colorScale` was passed to the chart. */
  readonly hasCustomColorScale?: boolean;
  /** Resolved first row of the grid (`0` Sunday to `6` Saturday). */
  readonly weekStartDay: HeatmapWeekStartDay;
  /** Current data status (`"loading"`, `"ready"` or `"error"`). */
  readonly chartStatus: ChartStatus;
  /** Coarse phase of the chart: `"loading"` while loading, `"ready"` otherwise. */
  readonly chartPhase: ChartPhase;
  /** `true` once the status is no longer `"loading"`. */
  readonly isLoaded: boolean;
  /** Number derived from `revealSignature`; changes when the entrance is replayed. */
  readonly revealEpoch: number;
  /** Enter animation duration in milliseconds. */
  readonly animationDuration: number;
  /** Enter transition in use. */
  readonly enterTransition?: HeatmapEnterTransition;
  /** Scale applied to the wave stagger between cells. */
  readonly enterStaggerScale: number;
  /** Whether cells animate in (`animate` is on and `animationDuration` is above `0`). */
  readonly animateCells: boolean;
  /** Chart opacity while loading. */
  readonly loadingOpacity: number;
  /** Whether skeleton cells show while loading. */
  readonly showLoadingCells: boolean;
  /** Highest opacity of the loading cells. */
  readonly loadingCellMaxOpacity: number;
  /** Share of cells that take part in the loading shimmer. */
  readonly loadingCellRandomness: number;
  /** Always `null`; kept for bklit compatibility. */
  readonly revealMode: HeatmapRevealMode;
  /** Centered label shown while loading. */
  readonly loadingLabel?: string;
  /** Whether the loading label is visible. */
  readonly showLoadingLabel: boolean;
  /** Accessible description of the chart. */
  readonly ariaDescription?: string | undefined;
  /** Accessible name of the chart. */
  readonly ariaLabel?: string | undefined;
  /** Which rows get a weekday label (from `HeatmapYAxis`). */
  readonly yTickFilter?: HeatmapYAxisTickFilter;
  /** Weekday label format (from `HeatmapYAxis`). */
  readonly yLabelFormat?: HeatmapYAxisLabelFormat;
  /** Per-row label opacity (from `HeatmapYAxis`). */
  readonly yRowOpacity?: number | readonly number[] | undefined;
  /** Resolved `HeatmapTooltip` settings, or `null` when no tooltip child is present. */
  readonly tooltip?: HeatmapTooltipConfig<Style> | null;
  /** Resolved `HeatmapSeparator` style, or `null` when no separator child is present. */
  readonly separator?: HeatmapSeparatorStyle | null;
}

export interface HeatmapHoveredCell {
  readonly column: number;
  readonly row: number;
}

export interface HeatmapTooltipData {
  readonly column: number;
  readonly row: number;
  readonly count: number;
  readonly date: Readonly<Date>;
  readonly x: number;
  readonly y: number;
}

/* Shared, React-agnostic interaction store: bklit's hovered-cell / hovered-legend-level / tooltip-data state between the chart (cell focus via `onFocusChange`) and the legend (level).
 * No DOM or timer work; the chart reads the level through `useHeatmapLegendLevel` and paints it with ordinary mark props. */
export interface HeatmapHoverCoordinator {
  readonly getSnapshot: () => HeatmapInteractionState;
  readonly getHoveredCell: () => HeatmapHoveredCell | null;
  readonly getHoveredLegendLevel: () => number | null;
  readonly getTooltipData: () => HeatmapTooltipData | null;
  readonly setHoveredCell: (cell: HeatmapHoveredCell | null) => void;
  readonly setHoveredLegendLevel: (level: number | null) => void;
  readonly setTooltipData: (data: HeatmapTooltipData | null) => void;
  /** Clears all state in a single broadcast, e.g. on pointer-leaving the chart surface. */
  readonly clearInteraction: () => void;
  /** Subscribes a listener; returns the unsubscribe function. */
  readonly subscribe: (listener: () => void) => () => void;
}

export interface HeatmapHoverStyleParams {
  readonly inactiveOpacity: number;
  readonly inactiveScale: number;
  readonly activeScale: number;
}

export interface HeatmapInteractionState {
  readonly hoveredCell: HeatmapHoveredCell | null;
  readonly hoveredLegendLevel: number | null;
  readonly tooltipData: HeatmapTooltipData | null;
}

/** Props of `HeatmapChart`. */
export interface HeatmapChartProps<Node> {
  /** Column data: one entry per week (or category) with the row bins inside. */
  readonly data: HeatmapColumn[];
  /** Visible time range. Only week columns that overlap the domain are drawn. */
  readonly xDomain?: [Date, Date];
  /** Week columns to size the cells for while `xDomain` is set, so the cell size holds while scrubbing the domain (the filtered columns can vary by one at its edges). */
  readonly sizingColumnCount?: number;
  /**
   * `"fluid"`: the width drives square cells and the chart height hugs the grid (GitHub style). `"fill"`: the chart takes its parent's
   * height and the square cells grow to the largest size that fits both the width and that height.
   * @default "fluid"
   */
  readonly layout?: "fluid" | "fill";
  /**
   * Chart margins in pixels. Omitted sides keep their default.
   * @default { top: 28, right: 16, bottom: 0, left: 40 }
   */
  readonly margin?: Readonly<Partial<HeatmapMargin>>;
  /**
   * Fixed cell size in pixels. When `0`, cells are square and sized to fit the available width.
   * @default 0
   */
  readonly binSize?: number;
  /**
   * Gap between cells in pixels.
   * @default 2
   */
  readonly gap?: number;
  /** Replaces the default level color scale. Receives a count and returns a CSS color. */
  readonly colorScale?: (count: number | null | undefined) => string;
  /**
   * Colors for the five levels of the Less to More scale (empty plus four activity levels).
   * @default the `--chart-scale-01` to `--chart-scale-05` CSS variables
   */
  readonly levelColors?: HeatmapLevelColors;
  /** Per-level fill styles (color and optional pattern). Takes precedence over `levelColors`. */
  readonly levelStyles?: HeatmapLevelStyles;
  /** CSS aspect ratio of the outer container, for example `"2 / 1"`. Omit to fill the parent. */
  readonly aspectRatio?: string;
  /** Additional class name for the chart container. */
  readonly className?: string;
  /**
   * Data status. `"loading"` draws the shimmering skeleton cells.
   * @default "ready"
   */
  readonly status?: ChartStatus;
  /** Centered label shown while `status` is `"loading"`. */
  readonly loadingLabel?: string;
  /**
   * Enter animation duration in milliseconds: how long the column wave takes to cross the grid. `0` disables the cell entrance.
   * @default 1100
   */
  readonly animationDuration?: number;
  /**
   * Enter transition of the column wave, as the line chart's reveal reads it: `duration` (seconds) replaces `animationDuration`, and a
   * `"tween"`'s `ease` (a cubic-bezier tuple or `"linear"`) paces the wavefront. Each cell then settles in over 450 ms.
   * @default undefined (`animationDuration` on the reveal ease, cubic-bezier(0.85, 0, 0.15, 1))
   */
  readonly enterTransition?: HeatmapEnterTransition;
  /**
   * Changing this string replays the enter animation.
   * @default ""
   */
  readonly revealSignature?: string;
  /**
   * Scales the wave stagger between cells (`1` is the default pacing).
   * @default 1
   */
  readonly enterStaggerScale?: number;
  /**
   * Plays the enter fade-in and the loading shimmer. Set to `false` for no motion.
   * @default true
   */
  readonly animate?: boolean;
  /**
   * Chart opacity while `status` is `"loading"`.
   * @default 1
   */
  readonly loadingOpacity?: number;
  /**
   * Shows the shimmering skeleton cells while loading.
   * @default true
   */
  readonly showLoadingCells?: boolean;
  /**
   * Highest opacity (0 to 1) the loading cells animate toward.
   * @default 0.85
   */
  readonly loadingCellMaxOpacity?: number;
  /**
   * Share of cells (0 to 1) that take part in the loading shimmer.
   * @default 1
   */
  readonly loadingCellRandomness?: number;
  /** Inserts horizontal gaps between groups of columns. A `HeatmapSeparator` child overrides it. */
  readonly columnSeparators?: HeatmapSeparatorParsedConfig;
  /**
   * First row of the grid: `0` is Sunday (GitHub default), `1` Monday, and so on. Rotates the rows for display without reshaping your data.
   * @default 0
   */
  readonly weekStartDay?: HeatmapWeekStartDay;
  /** `HeatmapCells`, `HeatmapXAxis`, `HeatmapYAxis`, `HeatmapTooltip` and `HeatmapSeparator` configuration children. `HeatmapCells` is required for the grid to draw. */
  readonly children?: Node;
  /**
   * Accessible name of the chart.
   * @default "Heatmap chart"
   */
  readonly ariaLabel?: string;
  /** Accessible description of the chart. Falls back to the `ariaDescription` of `HeatmapCells`. */
  readonly ariaDescription?: string;
}

/** Props of `HeatmapChartLoading`. */
export interface HeatmapChartLoadingProps {
  /** Target column data. Only its shape is used to size the skeleton grid; counts are zeroed. */
  readonly data: HeatmapColumn[];
  /** Visible time range. Only week columns that overlap the domain are drawn. */
  readonly xDomain?: [Date, Date];
  /**
   * Chart margins in pixels. Omitted sides keep their default.
   * @default { top: 28, right: 16, bottom: 0, left: 40 }
   */
  readonly margin?: Readonly<Partial<HeatmapMargin>>;
  /**
   * Gap between cells in pixels.
   * @default 2
   */
  readonly gap?: number;
  /**
   * Corner radius of each cell in pixels.
   * @default 2
   */
  readonly cornerRadius?: number;
  /**
   * Centered shimmer label.
   * @default "Loading"
   */
  readonly label?: string;
  /**
   * Additional class name for the container.
   * @default ""
   */
  readonly className?: string;
}

/** Legend layout: discrete `"swatches"` or a continuous `"gradient"` bar. */
export type HeatmapLegendVariant = "swatches" | "gradient";

/** Props of `HeatmapLegend`. */
export interface HeatmapLegendProps {
  /**
   * Label before the swatches.
   * @default "Less"
   */
  readonly lessLabel?: string;
  /**
   * Label after the swatches.
   * @default "More"
   */
  readonly moreLabel?: string;
  /**
   * Swatch size in pixels.
   * @default 11
   */
  readonly cellSize?: number;
  /**
   * Gap between swatches in pixels.
   * @default 2
   */
  readonly gap?: number;
  /**
   * Corner radius of the swatches in pixels.
   * @default 2
   */
  readonly cornerRadius?: number;
  /**
   * Horizontal alignment of the legend.
   * @default "end"
   */
  readonly align?: "start" | "center" | "end";
  /**
   * Discrete swatches or a continuous gradient bar. The gradient uses solid colors only; patterns are ignored.
   * @default "swatches"
   */
  readonly variant?: HeatmapLegendVariant;
  /**
   * Width of the gradient bar in swatch units when `variant` is `"gradient"`.
   * @default 5
   */
  readonly gradientSpan?: number;
  /**
   * Font size in pixels of the Less and More labels.
   * @default 12
   */
  readonly fontSize?: number;
  /** Additional class name for the Less and More labels. */
  readonly labelClassName?: string;
  /** Level colors and patterns. Pass the same value as the chart so swatches match the cells. */
  readonly levelStyles?: HeatmapLevelStyles;
  /**
   * Color scale used when `levelStyles` is omitted.
   * @default the default level colors
   */
  readonly colorScale?: (count: number | null | undefined) => string;
  /**
   * Opacity of the swatches that are not highlighted while hovering.
   * @default 0.3
   */
  readonly inactiveOpacity?: number;
  /**
   * Scale of the swatches that are not highlighted while hovering.
   * @default 1
   */
  readonly inactiveScale?: number;
  /**
   * Scale of the highlighted swatch while hovering.
   * @default 1
   */
  readonly activeScale?: number;
  /**
   * Syncs the swatch dimming with the chart hover.
   * @default true inside a HeatmapInteractionProvider, false otherwise
   */
  readonly interactive?: boolean;
  /** Additional class name for the legend container. */
  readonly className?: string;
}
