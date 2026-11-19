import type { CurveFactory } from "d3-shape";
import type { LineConfig as ChartLineConfig } from "./context";
import type { PatternPresetId, PatternPresetOptions } from "../pattern/pattern-preset-helpers";
import type { ChartPhase, ChartStatus, EnterTransition, LineLoadingPulseMode, LoadingStyle } from "../motion/phase";
import type { ChartMargin } from "../theme";
import type { Row } from "../cartesian/series";
import type { ChartLinkProps } from "./link";
import type { FadeEdges, StrokeGradient } from "../cartesian/stroke-paint";
import type { YDomainOverride } from "../cartesian/y-domain-utils";
import type { ChartMarkRenderer } from "../canvas/renderer";

export type ChartDatum = Record<string, unknown>;
export type { FadeEdges, StrokeGradient, StrokeGradientStop } from "../cartesian/stroke-paint";

/** A soft outer glow: a blurred copy of the stroke drawn behind it (`glow` on `Line`, `highlight.glow`). */
export interface LineGlow {
  /**
   * Blur radius in px (the Gaussian's standard deviation).
   * @default 6
   */
  readonly blur?: number;
  /**
   * Opacity of the glow, 0-1.
   * @default 0.7
   */
  readonly opacity?: number;
  /** Stroke width of the glow in px. Defaults to twice the stroke it glows behind. */
  readonly strokeWidth?: number;
}

/** Styling of a line's hover highlight segment (`highlight` on `Line`). */
export interface LineHighlight {
  /** Colour of the segment. Defaults to the line's paint: its `strokeGradient` (without the edge fade), else its `stroke`. */
  readonly stroke?: string;
  /** Colour ramp of the segment across the plot, left to right. Overrides `stroke`. */
  readonly strokeGradient?: StrokeGradient;
  /** Stroke width of the segment in px. Defaults to the line's `strokeWidth`. */
  readonly strokeWidth?: number;
  /**
   * Data points either side of the hovered one the segment covers.
   * @default 1
   */
  readonly span?: number;
  /**
   * Soft ends: the segment fades in and out over this percentage (0-50) of its width at each side. `0` draws hard edges.
   * @default 0
   */
  readonly fadeLength?: number;
  /** A glow behind the segment (`true` for the defaults), with the same options as the line's `glow`. */
  readonly glow?: boolean | Readonly<LineGlow>;
  /**
   * Opacity the rest of the line dims to while the chart is hovered.
   * @default 0.3
   */
  readonly dimOpacity?: number;
}

/** Spring parameters (stiffness and damping) used by the tooltip and highlight springs in `ChartConfigValue`. */
export interface SpringConfig {
  /** Spring stiffness. Higher values snap faster. */
  readonly stiffness: number;
  /** Spring damping. Higher values settle with less overshoot. */
  readonly damping: number;
}

/**
 * Appearance of the point markers drawn on a series (`showMarkers` and `markers` on `Line` and `Area`, `SeriesMarkers`, `SeriesPointMarker`).
 */
export interface SeriesPointMarkerStyle {
  /** Fill color of the inner circle. Defaults to the series stroke color. */
  readonly fill?: string;
  /** Color of the outer ring. Defaults to `fill`. */
  stroke?: string;
  /**
   * Outer ring stroke width in px. Set to `0` to remove the ring.
   * @default 2
   */
  strokeWidth?: number;
  /**
   * Gap between the inner circle and the outer ring, in px.
   * @default 2
   */
  readonly ringGap?: number;
  /**
   * Width in px of an optional outline drawn outside the ring. `0` draws none.
   * @default 0
   */
  readonly outlineWidth?: number;
  /** Color of the outer outline. Defaults to `stroke`. */
  readonly outlineColor?: string;
  /**
   * Radius of the inner circle in px.
   * @default 5
   */
  readonly radius?: number;
  /**
   * Dim the markers that are not hovered while the chart is hovered. The enlarged active marker (`showActiveHighlight`) is drawn only while this is on.
   * @default true
   */
  readonly fadeOnHover?: boolean;
  /**
   * Opacity of the dimmed markers when `fadeOnHover` is on.
   * @default 0.5
   */
  readonly inactiveOpacity?: number;
  /**
   * Blur in px of the dimmed markers when `fadeOnHover` is on.
   * @default 2
   */
  readonly inactiveBlur?: number;
  /**
   * Blur in px the markers start from while they fade in on entrance.
   * @default 2
   */
  readonly enterBlur?: number;
  /**
   * Draw the hovered marker 1.35 times larger.
   * @default true
   */
  readonly showActiveHighlight?: boolean;
}

export interface LineConfig {
  /** Key of the data field that holds this line's y values. */
  readonly dataKey: string;
  /** Name of the series in the default tooltip row and the chart context's \`lines\` (what a legend built from them reads). Defaults to \`dataKey\`. */
  readonly label?: string;
  /**
   * Stroke color of the line.
   * @default "var(--chart-line-primary)"
   */
  stroke?: string;
  /**
   * Stroke width of the line in px.
   * @default 2.5
   */
  strokeWidth?: number;
  /**
   * d3-shape curve factory used to interpolate between points.
   * @default curveNatural
   */
  readonly curve?: CurveFactory;
  /**
   * Id of the y scale this line is plotted against. Use it with a matching `YAxis` to give a series its own scale.
   * @default "left"
   */
  yAxisId?: string | number;
  /**
   * Fade the line toward transparent at the chart edges. `true` fades both ends, `"left"` or `"right"` fades one side, `false` turns the fade off,
   * and `{ left, right }` sets each side's fade zone as a percentage of the plot width (0-50).
   * @default true
   */
  readonly fadeEdges?: FadeEdges;
  /**
   * A colour ramp across the plot, left to right: plain colours are spaced evenly, `{ offset, color }` stops (offset 0-1) place them. It
   * composes with `fadeEdges` and replaces `stroke` for the line's paint (`stroke` still colours the markers and the tooltip dot).
   */
  readonly strokeGradient?: StrokeGradient;
  /**
   * A soft outer glow: a blurred copy of the stroke behind the line. `true` uses the defaults; `{ blur, opacity, strokeWidth }` tunes it.
   * @default false
   */
  readonly glow?: boolean | Readonly<LineGlow>;
  /**
   * Draw a highlighted segment of the line around the hovered point.
   * @default true
   */
  showHighlight?: boolean;
  /** The hover highlight's styling: colour or ramp, width, soft ends (`fadeLength`), `glow`, `span` and how far the rest of the line dims (`dimOpacity`). See `LineHighlight`. */
  readonly highlight?: Readonly<LineHighlight>;
  /**
   * Draw a circle marker at every data point.
   * @default false
   */
  readonly showMarkers?: boolean;
  /** Styling of the point markers drawn by `showMarkers`. See `SeriesPointMarkerStyle`. */
  readonly markers?: Readonly<SeriesPointMarkerStyle>;
  /**
   * Data index from which the line is drawn dashed (inclusive). Useful for marking an incomplete or projected period.
   */
  readonly dashFromIndex?: number;
  /**
   * Dash pattern of the dashed tail when `dashFromIndex` is set.
   * @default "6,4"
   */
  readonly dashArray?: string;
  /**
   * Stroke color of the loading pulse overlay.
   * @default "var(--chart-foreground)"
   */
  readonly loadingStroke?: string;
  /**
   * Stroke opacity of the loading pulse overlay.
   * @default 0.5
   */
  readonly loadingStrokeOpacity?: number;
  /**
   * Whether the point markers animate in. The line itself always enters with the chart's `animationDuration`.
   * @default true
   */
  readonly animate?: boolean;
  /**
   * Show the loading pulse overlay on this line. When unset, the pulse follows the chart's `status`. Set `false` to disable it even while the chart is loading.
   */
  readonly loading?: boolean;
  /**
   * Phase of the loading pulse: `"loop"` repeats, `"exit"` plays the loading to ready transition, `"enter"` plays ready to loading.
   * @default "loop"
   */
  readonly loadingPulseMode?: LineLoadingPulseMode;
  /**
   * Loading animation: a travelling `"pulse"` or a diagonal `"sweep"` shimmer across the skeleton line.
   * @default "pulse"
   */
  readonly loadingStyle?: LoadingStyle;
  /** Called each time a `"loop"` pulse cycle completes. */
  readonly onLoadingPulseCycleComplete?: () => void;
  /**
   * Where the line draws: `"svg"`, a path, or `canvasRenderer`, a bitmap the chart's canvas lines share, for tens of thousands of points (the
   * grid, axes, hover highlight, markers, glow, crosshair and tooltip stay SVG). On a canvas the line dims with the others on hover (a
   * legend can't dim it alone) and doesn't take a `fadeEdges` mask.
   * @default "svg"
   */
  readonly renderer?: ChartMarkRenderer;
}

export interface AreaConfig {
  /** Key of the data field that holds this area's y values. */
  readonly dataKey: string;
  /** Name of the series in the default tooltip row and the chart context's \`lines\` (what a legend built from them reads). Defaults to \`dataKey\`. */
  readonly label?: string;
  /**
   * Color of the area's top line. Falls back to `fill`, then to the default line color.
   * @default "var(--chart-line-primary)"
   */
  stroke?: string;
  /**
   * Stroke width of the top line in px.
   * @default 2
   */
  strokeWidth?: number;
  /** Fill color of the area. Defaults to the resolved `stroke`. */
  readonly fill?: string;
  /**
   * Opacity of the fill at the top of the area, before the gradient fades it toward `gradientToOpacity`.
   * @default 0.4
   */
  readonly fillOpacity?: number;
  /**
   * d3-shape curve factory used to interpolate between points.
   * @default curveMonotoneX
   */
  readonly curve?: CurveFactory;
  /**
   * Id of the y scale this area is plotted against.
   * @default "left"
   */
  yAxisId?: string | number;
  /**
   * Draw the stroke line along the top of the area.
   * @default true
   */
  readonly showLine?: boolean;
  /**
   * Fill opacity at the bottom of the vertical gradient.
   * @default 0
   */
  readonly gradientToOpacity?: number;
  /**
   * Vertical extent of the fill gradient (0 to 1): `1` fades across the area's full height, lower values reach `gradientToOpacity` sooner, nearer the top.
   * @default 1
   */
  readonly gradientSpan?: number;
  /** Fade the fill out over the bottom N% of the area's height (0 to 100): `100` fades across the full height, `0` keeps the fill flat. Replaces `gradientToOpacity` and `gradientSpan` when set. */
  readonly fadeBottom?: number;
  /**
   * Show the value above sampled points, as text labels that share one count and one collision pass across every `Area` that shows them, stay inside the plot and skip what does not fit.
   * @default false
   */
  readonly showValue?: boolean;
  /**
   * Preferred minimum number of value labels per series; the room and collisions can lower it.
   * @default 2
   */
  readonly valueLabelMinCount?: number;
  /** Maximum number of value labels per series. `0` hides them all. Defaults to what the plot width allows. */
  readonly valueLabelMaxCount?: number;
  /** Formats a value label. Defaults to an English integer such as `12,400`. */
  readonly valueLabelFormatter?: (value: number) => string;
  /** Color of the value labels. Defaults to the series stroke. */
  readonly valueLabelColor?: string;
  /**
   * Fade the value labels with the series' `fadeEdges`.
   * @default false
   */
  readonly fadeValueLabels?: boolean;
  /**
   * Fade the area toward transparent at the chart edges. `true` fades both ends, `"left"` or `"right"` fades one side, and `{ left, right }`
   * sets each side's fade zone as a percentage of the plot width (0-50).
   * @default false
   */
  readonly fadeEdges?: FadeEdges;
  /**
   * Draw a circle marker at every data point.
   * @default false
   */
  readonly showMarkers?: boolean;
  /** Styling of the point markers drawn by `showMarkers`. See `SeriesPointMarkerStyle`. */
  readonly markers?: Readonly<SeriesPointMarkerStyle>;
  /**
   * Draw a highlighted segment of the top line around the hovered point.
   * @default true
   */
  showHighlight?: boolean;
  /** Data index from which the top line is drawn dashed (inclusive). */
  readonly dashFromIndex?: number;
  /**
   * Dash pattern of the dashed tail when `dashFromIndex` is set.
   * @default "6,4"
   */
  readonly dashArray?: string;
  /**
   * Whether the point markers animate in. The area itself always enters with the chart's `animationDuration`.
   * @default true
   */
  readonly animate?: boolean;
  /**
   * Show the loading pulse overlay on this area. When unset, the pulse follows the chart's `status`. Set `false` to disable it.
   */
  readonly loading?: boolean;
  /**
   * Stroke color of the loading pulse overlay.
   * @default "var(--chart-foreground)"
   */
  readonly loadingStroke?: string;
  /**
   * Stroke opacity of the loading pulse overlay.
   * @default 0.5
   */
  readonly loadingStrokeOpacity?: number;
  /**
   * Phase of the loading pulse: `"loop"` repeats, `"exit"` plays the loading to ready transition, `"enter"` plays ready to loading.
   * @default "loop"
   */
  readonly loadingPulseMode?: LineLoadingPulseMode;
  /**
   * Loading animation: a travelling `"pulse"` or a diagonal `"sweep"` shimmer.
   * @default "pulse"
   */
  readonly loadingStyle?: LoadingStyle;
  /**
   * Where the area's fill and line draw: `"svg"`, paths, or `canvasRenderer`, a bitmap the chart's canvas series share, for tens of thousands
   * of points (the grid, axes, hover highlight, markers, crosshair and tooltip stay SVG). On a canvas the area dims with the others on
   * hover (a legend can't dim it alone) and its fill draws to the plot's edges (`fadeEdges` is an SVG mask).
   * @default "svg"
   */
  readonly renderer?: ChartMarkRenderer;
}

export interface PatternAreaConfig {
  /** Key of the data field that holds the y values filled with the pattern. */
  readonly dataKey: string;
  /** Name of the series in the default tooltip row, when no \`Area\` or \`Line\` with the same \`dataKey\` names it. Defaults to \`dataKey\`. */
  readonly label?: string;
  /**
   * Pattern drawn inside the area (a `PatternPresetId`, for example `"diagonal"`, `"dots"` or `"cross"`).
   * @default "diagonal"
   */
  readonly patternPreset?: PatternPresetId;
  /** Color of the pattern strokes. Defaults to `fill`, then to the default line color. */
  readonly patternColor?: string;
  /** Fallback color for the pattern when `patternColor` is not set. */
  readonly fill?: string;
  /**
   * d3-shape curve factory used to interpolate between points.
   * @default curveMonotoneX
   */
  readonly curve?: CurveFactory;
  /**
   * Opacity of the pattern.
   * @default 1
   */
  readonly fillOpacity?: number;
  /** Fade the pattern out over the bottom N% of the area's height (0 to 100). */
  readonly fadeBottom?: number;
  /**
   * Fade the pattern toward transparent at the chart edges: `true` both, `"left"` or `"right"` one side. Pair it with the same `fadeEdges` on the stroke `Area`.
   * @default false
   */
  readonly fadeEdges?: FadeEdges;
  /** Deprecated. The pattern fill does not animate, so this has no effect. */
  readonly animate?: boolean;
}

/** How a `Scatter`'s dots that are not hovered step back while the chart is hovered: `"opacity"` fades them, `"blur"` fades and blurs them. */
export type ScatterInactiveMode = "opacity" | "blur";

/**
 * `ScatterChart`'s `jitter`: spreads points that share an x value (a strip plot) by deterministic, seeded offsets, so they never jump.
 * `true` spreads them over 0.35 of the band step (the smallest gap between two x values), a number sets that fraction, and
 * `{ x, y, seed }` sets the fraction, a vertical spread in px (±) and the pattern's seed.
 */
export type ScatterJitter =
  | boolean
  | number
  | {
      /**
       * Horizontal spread as a fraction of the band step (0 to 1).
       * @default 0.35
       */
      readonly x?: number;
      /**
       * Largest vertical offset in px, up or down.
       * @default 0
       */
      readonly y?: number;
      /**
       * Seed of the offset pattern: another number gives another (still fixed) arrangement.
       * @default 0
       */
      readonly seed?: number;
    };

export interface ScatterConfig {
  /** Key of the data field that holds this series' y values. */
  readonly dataKey: string;
  /** Name of the series in the default tooltip row. Defaults to \`dataKey\`. */
  readonly label?: string;
  /**
   * Id of the y scale this series is plotted against.
   * @default "left"
   */
  yAxisId?: string | number;
  /**
   * Whether the dots animate in on entrance.
   * @default true
   */
  readonly animate?: boolean;
  /** Fill color of the dots. Defaults to `stroke`, then to a color from the chart palette. */
  readonly fill?: string;
  /** Color of the ring around each dot. Defaults to the resolved fill. */
  stroke?: string;
  /**
   * Width in px of an offset ring around each dot (`ringGap` away from it). Rings are opt-in: `0` draws plain dots.
   * @default 0
   */
  strokeWidth?: number;
  /**
   * Gap between the dot and its ring in px.
   * @default 2
   */
  readonly ringGap?: number;
  /**
   * Radius of the dot in px.
   * @default 5
   */
  readonly radius?: number;
  /**
   * Fills the dots with a color that ends at `to` (or a default accent color when `true`). Overrides `fill`; the ring follows unless `stroke` is set.
   */
  readonly yGradient?: boolean | Readonly<{ from?: string; to?: string }>;
  /**
   * Dim the dots that are not hovered while the chart is hovered.
   * @default true
   */
  readonly fadeOnHover?: boolean;
  /**
   * Opacity of the dimmed dots when `fadeOnHover` is on.
   * @default 0.3
   */
  readonly inactiveOpacity?: number;
  /**
   * How the dots that are not hovered step back while the chart is hovered: `"opacity"` fades them to `inactiveOpacity`, `"blur"` also
   * blurs them by `inactiveBlur`.
   * @default "opacity"
   */
  readonly inactiveMode?: ScatterInactiveMode;
  /**
   * Blur in px of the dimmed dots when `inactiveMode` is `"blur"`.
   * @default 2
   */
  readonly inactiveBlur?: number;
  /**
   * Blur in px the dots start from while they fade in on entrance.
   * @default 2
   */
  readonly enterBlur?: number;
  /**
   * Draw the hovered dot 1.35 times larger.
   * @default true
   */
  readonly showActiveHighlight?: boolean;
  /**
   * Width in px of an optional outline drawn outside the ring. `0` draws none.
   * @default 0
   */
  readonly outlineWidth?: number;
  /** Color of the outline. Defaults to the ring color. */
  readonly outlineColor?: string;
  /**
   * Where the dots draw: `"svg"`, one element per dot, or `canvasRenderer`, one bitmap for the series, for thousands of dots (the axes,
   * grid, hover indicator and tooltip stay SVG). On a canvas the dots appear with the chart's reveal as one sweep, not one by one.
   * @default "svg"
   */
  readonly renderer?: ChartMarkRenderer;
}

/** A label count per chart width: the widest of `xl` (1280 px), `lg` (1024), `md` (768), `sm` (640) and `base` (0) the chart reaches and that is set. */
export interface ResponsiveChartLabelCount {
  readonly base?: number;
  readonly sm?: number;
  readonly md?: number;
  readonly lg?: number;
  readonly xl?: number;
}

export interface XAxisConfig {
  /**
   * Target number of tick labels along the x axis, or one per chart width: `{ base, sm, md, lg, xl }` takes the count of the widest breakpoint the chart reaches (640, 768, 1024 and 1280 px).
   * @default 5
   */
  readonly numTicks?: number | ResponsiveChartLabelCount;
  /** The tick text of each data row, in row order: it replaces the date formatting (pair it with `ChartTooltip` `dateLabels`). */
  readonly labels?: readonly string[];
  /**
   * Half-width in px of the zone around the date pill inside which tick labels are hidden. Line, area and composed charts widen it to the pill's half-width plus the widest tick label's, so no label sits half under the pill.
   * @default 50
   */
  readonly tickerHalfWidth?: number;
  /**
   * Where ticks fall: `"data"` places them on evenly spaced data rows, `"domain"` places them at evenly spaced time values across the x domain.
   * @default "data"
   */
  readonly tickMode?: "domain" | "data";
  /** Formats a tick date into its label. Defaults to a short month and day such as "Jan 5". */
  readonly formatValue?: (value: Readonly<Date>) => string;
}

export interface YAxisConfig {
  /**
   * Id of the y scale this axis labels. Must match the `yAxisId` of the series that use it.
   * @default "left"
   */
  yAxisId?: string | number;
  /**
   * Side of the plot the axis sits on. The primary axis is on the left; additional axes default to the right.
   * @default "left"
   */
  readonly orientation?: "left" | "right";
  /**
   * Target number of tick labels. The primary axis also sets the number of horizontal grid lines.
   * @default 5
   */
  readonly numTicks?: number;
  /**
   * Abbreviate values of 1000 and above as thousands, with one decimal where needed, for example `2k` or `1.5k`.
   * @default true
   */
  readonly formatLargeNumbers?: boolean;
  /** Formats a tick value into its label. Overrides `formatLargeNumbers`. */
  readonly formatValue?: (value: number) => string;
}

export interface GridProps {
  /**
   * Show horizontal grid lines.
   * @default true
   */
  horizontal?: boolean;
  /**
   * Show vertical grid lines.
   * @default false
   */
  vertical?: boolean;
  /**
   * Number of horizontal grid lines. Ignored when `rowTickValues` is set.
   * @default 5
   */
  numTicksRows?: number;
  /**
   * Number of vertical grid lines.
   * @default 10
   */
  numTicksColumns?: number;
  /** Explicit y values for the horizontal grid lines. Overrides `numTicksRows`. */
  rowTickValues?: number[];
  /**
   * Color of the grid lines.
   * @default "var(--chart-grid)"
   */
  stroke?: string;
  /** Grid color while the chart is loading. Falls back to `stroke`. */
  loadingStroke?: string;
  /**
   * Opacity of the grid lines.
   * @default 1
   */
  strokeOpacity?: number;
  /**
   * Width of the grid lines in px.
   * @default 1
   */
  strokeWidth?: number;
  /**
   * Dash pattern of the grid lines.
   * @default "4,4"
   */
  strokeDasharray?: string;
  /** Y values of horizontal lines drawn with the highlight styling, for example a zero baseline. */
  highlightRowValues?: number[];
  /**
   * Color of the highlighted rows.
   * @default "var(--chart-foreground-muted)"
   */
  highlightRowStroke?: string;
  /**
   * Opacity of the highlighted rows.
   * @default 1
   */
  highlightRowStrokeOpacity?: number;
  /**
   * Width of the highlighted rows in px.
   * @default 1
   */
  highlightRowStrokeWidth?: number;
  /**
   * Dash pattern of the highlighted rows.
   * @default "0"
   */
  highlightRowStrokeDasharray?: string;
  /**
   * Fade the horizontal lines toward transparent at the left and right edges.
   * @default true
   */
  fadeHorizontal?: boolean;
  /**
   * Fade the vertical lines toward transparent at the top and bottom edges.
   * @default false
   */
  fadeVertical?: boolean;
  /**
   * Drop the first and last horizontal line (kept when two or fewer remain).
   * @default false
   */
  hideHorizontalEdgeLines?: boolean;
  /**
   * Drop the first and last vertical line (kept when two or fewer remain).
   * @default false
   */
  hideVerticalEdgeLines?: boolean;
  /**
   * Accepted for bklit-ui compatibility. It has no effect in bklit-tanstack-charts. The grid follows the primary (left) y scale.
   */
  yAxisId?: string | number;
  /**
   * While the chart is loading, sweep a bright band across the grid.
   * @default false
   */
  shimmer?: boolean;
  /**
   * Color of the shimmer band.
   * @default "color-mix(in oklch, var(--bkm-foreground) 68%, transparent)"
   */
  shimmerStroke?: string;
  /** Accepted for bklit-ui compatibility. It has no effect in bklit-tanstack-charts. */
  shimmerLength?: number;
  /**
   * Speed multiplier of the shimmer sweep. `2` is twice as fast.
   * @default 1
   */
  shimmerSpeed?: number;
  /** Accepted for bklit-ui compatibility. It has no effect in bklit-tanstack-charts. */
  shimmerSync?: boolean;
}

export interface BackgroundConfig extends PatternPresetOptions {
  /**
   * Pattern preset. `"none"` draws nothing.
   * @default "diagonal"
   */
  readonly pattern?: PatternPresetId;
  /**
   * Color of the pattern strokes.
   * @default "var(--chart-grid)"
   */
  readonly color?: string;
  /**
   * Draw the pattern over the plot area.
   * @default true
   */
  readonly showFill?: boolean;
  /**
   * Opacity of the pattern.
   * @default 1
   */
  readonly opacity?: number;
  /**
   * Fade the pattern out at the left and right edges.
   * @default true
   */
  readonly fadeHorizontal?: boolean;
  /**
   * Fade the pattern out at the top and bottom edges.
   * @default true
   */
  readonly fadeVertical?: boolean;
  /**
   * Width of the horizontal fade zone, as a percent of the plot width per edge (clamped to 0 to 45).
   * @default 10
   */
  readonly fadeHorizontalLength?: number;
  /**
   * Height of the vertical fade zone, as a percent of the plot height per edge (clamped to 0 to 45).
   * @default 10
   */
  readonly fadeVerticalLength?: number;
}

/** A point on a projection path. */
export interface ProjectionPoint {
  /** X position of the point. */
  readonly date: Readonly<Date>;
  /** Y value of the point. */
  readonly value: number;
}

/**
 * How a `ProjectionLine` is painted: `"solid"` uses one color, `"gradient"` blends from `gradientStart` to `gradientEnd` along the path.
 */
export type ProjectionStrokeStyle = "solid" | "gradient";

/**
 * Props of `ProjectionLine`: a forecast path drawn after the last data point, usually a dashed line from the last data row to a horizon point.
 */
export interface ProjectionLineProps {
  /**
   * Projection path points: the anchor (usually the last data row) followed by the horizon end. Needs at least two points to draw.
   */
  data: readonly ProjectionPoint[];
  /**
   * Id of the y-scale group the path is drawn against.
   * @default "left"
   */
  yAxisId?: string | number;
  /**
   * Stroke color of a solid path.
   * @default "var(--chart-3)"
   */
  stroke?: string;
  /**
   * `"solid"` paints one color, `"gradient"` blends `gradientStart` into `gradientEnd` along the path.
   * @default "solid"
   */
  readonly strokeStyle?: ProjectionStrokeStyle;
  /**
   * Gradient start color when `strokeStyle` is `"gradient"`.
   * @default `stroke`
   */
  readonly gradientStart?: string;
  /**
   * Gradient end color when `strokeStyle` is `"gradient"`.
   * @default "var(--chart-5)"
   */
  readonly gradientEnd?: string;
  /**
   * Stroke width in px.
   * @default 2
   */
  strokeWidth?: number;
  /**
   * `"linear"` draws straight segments, `"bezier"` draws a smooth S-curve with horizontal tangents.
   * @default "linear"
   */
  readonly curveKind?: "linear" | "bezier";
  /** Accepted so bklit-ui code compiles. Not read: use `curveKind` to choose the shape. */
  readonly curve?: CurveFactory;
  /**
   * SVG dash pattern of the path. Pass `"0"` for a solid path.
   * @default "6,4"
   */
  readonly strokeDasharray?: string;
  /**
   * Stroke opacity of the path.
   * @default 1
   */
  readonly strokeOpacity?: number;
  /**
   * Whether the horizon end reserves room for an end marker: the path stops short of the plot edge by the marker radius so it is not clipped. The marker dot itself is not drawn by this package.
   * @default true
   */
  readonly showEndMarker?: boolean;
  /**
   * Deprecated alias of `showEndMarker`.
   * @deprecated Use showEndMarker.
   */
  readonly showEndpoints?: boolean;
  /**
   * Radius in px of the end marker, used to keep the path inside the plot.
   * @default 5
   */
  readonly endpointRadius?: number;
  /** Accepted so bklit-ui code compiles. Not read. */
  readonly className?: string;
}

/** One `ProjectionLine` reduced to its y-scale group and points. */
export interface ProjectionLineConfig {
  /** Id of the y-scale group the projection is drawn against. */
  yAxisId: string;
  /** Points of the projection path. */
  data: ProjectionPoint[];
}

/** Props of `ProjectionLineEndMarker`, the dot at the end of a projection path. Accepted so bklit-ui code compiles; this package does not draw the dot. */
export interface ProjectionLineEndMarkerProps {
  /** Projection path points; the marker sits on the last one. */
  data: readonly ProjectionPoint[];
  /**
   * Id of the y-scale group the marker is drawn against.
   * @default "left"
   */
  yAxisId?: string | number;
  /**
   * Marker color.
   * @default "var(--chart-3)"
   */
  stroke?: string;
  /**
   * Marker opacity.
   * @default 1
   */
  readonly strokeOpacity?: number;
  /**
   * Marker radius in px.
   * @default 5
   */
  readonly radius?: number;
}

/**
 * Props of `LineSeriesTerminalMarker`, a ring on the last data point of a series; it is the usual anchor for a `ProjectionLine`.
 */
// bklit line-series-terminal-marker.tsx:8 LineSeriesTerminalMarkerProps.
export interface LineSeriesTerminalMarkerProps {
  /** Key of the series in the chart data. The ring sits on the last row's value. */
  readonly dataKey: string;
  /**
   * Id of the y-scale group the series uses.
   * @default "left"
   */
  yAxisId?: string | number;
  /**
   * Fill of the inner circle. No inner circle is drawn when omitted, `""` or `"transparent"`, which leaves a hollow ring.
   */
  readonly fill?: string;
  /**
   * Radius of the inner circle in px.
   * @default 5
   */
  readonly radius?: number;
  /**
   * Gap between the inner circle and the ring in px.
   * @default 0
   */
  readonly ringGap?: number;
  /**
   * Ring color.
   * @default "var(--chart-1)"
   */
  stroke?: string;
  /**
   * Ring stroke width in px.
   * @default 1.5
   */
  strokeWidth?: number;
}

/** Props of `ProfitLossLine`, a single line that is green above zero and red below it. */
export interface ProfitLossLineProps {
  /**
   * Key of the numeric series in the chart data. Values at or above zero use `positiveColor`, values below use `negativeColor`.
   */
  readonly dataKey: string;
  /** Accepted so bklit-ui code compiles. Not read: the line uses the chart's `xDataKey`. */
  readonly xDataKey?: string;
  /** Name of the series in the default tooltip row. Defaults to \`dataKey\`. */
  readonly label?: string;
  /**
   * Stroke width in px.
   * @default 2.5
   */
  strokeWidth?: number;
  /**
   * Color above zero.
   * @default "var(--chart-positive)"
   */
  readonly positiveColor?: string;
  /**
   * Color below zero.
   * @default "var(--chart-negative)"
   */
  readonly negativeColor?: string;
  /**
   * d3 curve factory used to draw the line.
   * @default `curveLinear`
   */
  readonly curve?: CurveFactory;
  /** Accepted so bklit-ui code compiles. Not read: a profit/loss line never fades its ends. */
  readonly fadeEdges?: FadeEdges;
}

/** One event marker for `ChartMarkers`: a circle with an icon at a date on the x-axis. */
export interface ChartMarker<Node = unknown> {
  /**
   * Date the marker is placed at on the x-axis. Markers that share a date are grouped into one cluster with a count badge.
   */
  readonly date: Date;
  /** Icon or glyph shown inside the marker circle. Only text (a string or number) is drawn. */
  readonly icon: Node;
  /** Title shown in the tooltip. */
  readonly title: string;
  /** Optional description shown under the title in the tooltip. */
  readonly description?: string;
  /** Optional custom tooltip content. Replaces the title and description. */
  readonly content?: Node;
  /** Background color of the marker circle. */
  readonly color?: string;
  /** Called when the marker is clicked. */
  readonly onClick?: () => void;
  /** URL to navigate to when the marker is clicked. */
  readonly href?: string;
  /** Where `href` opens: `"_blank"` for a new tab, `"_self"` for the same tab. */
  target?: "_blank" | "_self";
}

/** Props of `ChartMarkers`, a row of event markers along the top of the plot. */
export interface ChartMarkersProps<Marker = ChartMarker> {
  /** The markers to display. Markers on the same date are grouped. */
  readonly items: readonly Readonly<Marker>[];
  /**
   * Diameter of each marker circle in px.
   * @default 28
   */
  readonly size?: number;
  /**
   * Draw a dashed vertical guide line from each marker down the plot.
   * @default true
   */
  readonly showLines?: boolean;
  /** Accepted so bklit-ui code compiles. Not read: markers fade in with the chart entrance. */
  readonly animate?: boolean;
  /** Cap on how many markers of a cluster fan out on hover. The count badge still shows the full cluster size. */
  readonly maxFanned?: number;
}

/**
 * Props of `SeriesMarkers`: point markers for the series with this `dataKey` (same as `showMarkers` plus `markers` on its `Line` or `Area`).
 */
export interface SeriesMarkersProps extends SeriesPointMarkerStyle {
  /** Key of the series (a `Line` or `Area` `dataKey`) to draw markers on. */
  readonly dataKey: string;
  /**
   * Fade the markers in with the chart entrance.
   * @default true
   */
  readonly animate?: boolean;
}

/**
 * Props of `MarkerGroup`. As a chart child it draws one `ChartMarkers` group at the dates of its `markers`; the pixel-placement and portal props exist so bklit-ui code compiles and are not read.
 */
export interface MarkerGroupProps<Marker = ChartMarker> {
  /** Accepted so bklit-ui code compiles. Not read: the group is placed at the date of its markers. */
  readonly x?: number;
  /** Accepted so bklit-ui code compiles. Not read. */
  readonly y?: number;
  /** Markers in this group. Markers on the same date form one cluster. */
  readonly markers: readonly Readonly<Marker>[];
  /** Accepted so bklit-ui code compiles. Not read. */
  readonly isActive?: boolean;
  /**
   * Diameter of each marker circle in px.
   * @default 28
   */
  readonly size?: number;
  /** Accepted so bklit-ui code compiles. Not read. */
  readonly onHover?: (markers: Marker[] | null) => void;
  /** Accepted so bklit-ui code compiles. Not read. */
  readonly containerRef?: unknown;
  /** Horizontal offset from the chart container used to anchor the fan-out of a cluster. */
  readonly marginLeft?: number;
  /** Vertical offset from the chart container used to anchor the fan-out of a cluster. */
  readonly marginTop?: number;
  /** Accepted so bklit-ui code compiles. Not read. */
  readonly animationDelay?: number;
  /** Accepted so bklit-ui code compiles. Not read: markers fade in with the chart entrance. */
  readonly animate?: boolean;
  /** Accepted so bklit-ui code compiles. Not read: the guide line spans the plot. */
  readonly lineHeight?: number;
  /**
   * Draw a dashed vertical guide line from each marker down the plot.
   * @default true
   */
  readonly showLine?: boolean;
  /**
   * Keep clusters fanned out even when they are not hovered.
   * @default false
   */
  readonly forceOpen?: boolean;
  /** Accepted so bklit-ui code compiles. Not read. */
  readonly iconFill?: boolean;
  /** Stroke color of the marker circle. Defaults to the `--chart-marker-border` color. */
  readonly borderColor?: string;
  /**
   * Stroke width of the marker circle in px.
   * @default 1.5
   */
  readonly borderWidth?: number;
  /** Cap on how many markers of a cluster fan out on hover. The count badge still shows the full cluster size. */
  readonly maxFanned?: number;
  /**
   * Fade the markers to 40% opacity at rest, to spotlight another group.
   * @default false
   */
  readonly isMuted?: boolean;
}

/** Width of the tooltip crosshair: a pixel number, or `"line"` (1px), `"thin"` (2px), `"medium"` (4px) or `"thick"` (8px). */
export type IndicatorWidth = number | "line" | "thin" | "medium" | "thick";
/** Which ends of the tooltip crosshair fade out: `"both"`, `"top"`, `"bottom"` or `"none"`. */
export type IndicatorFadeEdges = "both" | "none" | "top" | "bottom";

export interface ChartTooltipProps<Node, Style> {
  /**
   * Show the date pill that rides along the bottom of the plot.
   * @default true
   */
  readonly showDatePill?: boolean;
  /**
   * Show the vertical crosshair line. Bar charts leave it off unless this is `true` (the dots and the category pill mark the bar).
   * @default true
   */
  readonly showCrosshair?: boolean;
  /**
   * Show a dot on every series at the hovered position.
   * @default true
   */
  readonly showDots?: boolean;
  /**
   * Dot style: a filled `"dot"` or a transparent `"ring"` square. Read by `BarChart` only.
   * @default "dot"
   */
  readonly dotVariant?: "dot" | "ring";
  /**
   * Dot radius in px.
   * @default 5
   */
  readonly dotSize?: number;
  /**
   * Corner radius of the `"ring"` variant as a fraction of its side (0 is square, 0.5 is a circle). Read by `BarChart` only.
   * @default 0.25
   */
  readonly dotRadiusFraction?: number;
  /**
   * Multiplier applied to the dot or ring size. Read by `BarChart` and `LiveLineChart`.
   * @default 1
   */
  readonly dotScale?: number;
  /**
   * Stroke width of the dots in px.
   * @default 2
   */
  readonly dotStrokeWidth?: number;
  /**
   * Color of the crosshair. Only a string is applied; the function form that bklit-ui accepts is ignored and the default is used.
   * @default "var(--chart-crosshair)"
   */
  readonly indicatorColor?: string | ((point: Record<string, unknown>) => string);
  /**
   * Replaces the default tooltip panel body. Receives the hovered data row and its index; with `pinnable`, also whether the panel is
   * pinned and a `dismiss` that unpins it (for a close button in a pinned panel's detail).
   */
  readonly content?: (props: { point: Record<string, unknown>; index: number; pinned?: boolean; dismiss?: () => void }) => Node;
  /**
   * A click (or Enter, or Space) on the chart pins the tooltip where it is: the panel takes the pointer, so its content can grow into
   * detail and hold controls, until another click, Escape or `dismiss` lets it go.
   * @default false
   */
  readonly pinnable?: boolean;
  /** Replaces the default rows (one per series) with your own list of `{ color, label, value }`. */
  readonly rows?: (point: Record<string, unknown>) => { readonly color: string; readonly label: string; readonly value: string | number }[];
  /**
   * Fill of the tooltip dots. A function receives the hovered row and the series config, and is called again each time the hovered row changes. Defaults to each series' color; a `ProfitLossLine`'s dot takes the color of the hovered value's sign.
   */
  readonly dotColor?: string | ((point: Record<string, unknown>, line: ChartLineConfig) => string);
  /**
   * Extra content rendered below the rows in the default panel, for example marker details. Without it, a chart with `ChartMarkers` lists the markers on the hovered date there.
   */
  readonly children?: Node;
  /** Extra class name for the tooltip panel. */
  readonly className?: string;
  /** Spring for the floating panel when `matchCrosshair` is on. Defaults to the chart's tooltip spring. */
  readonly springConfig?: SpringConfig;
  /**
   * Make the floating panel follow the pointer with the same spring as the crosshair instead of `damping`.
   * @default false
   */
  readonly matchCrosshair?: boolean;
  /**
   * Spring damping for the floating panel when `matchCrosshair` is off, on bklit's 0 to 100 scale: lower is bouncier, higher slower, `0` moves the panel instantly.
   * The default, 20, is the snappy hover spring (stiffness 3600, damping 120); every other value is bklit's spring for it played six times faster.
   * @default 20
   */
  readonly damping?: number;
  /** Dash pattern of the crosshair. Omit for a solid line. */
  readonly indicatorDasharray?: string;
  /**
   * Vertical fade of the crosshair: both ends, the top, the bottom, or none (solid).
   * @default "both"
   */
  readonly indicatorFadeEdges?: IndicatorFadeEdges;
  /**
   * Size of the crosshair's fade, as a percentage of its height (2 to 40).
   * @default 10
   */
  readonly indicatorFadeLength?: number;
  /** Bottom colour of the crosshair: it ramps from `indicatorColor` at the top to this at the bottom (composes with the fade). */
  readonly indicatorEndColor?: string;
  /**
   * How far down the crosshair reaches: the whole plot, or down to the hovered point of the first series.
   * @default "plot"
   */
  readonly indicatorEnd?: "plot" | "point";
  /**
   * Blur in px on the dots' halo, for a soft glow.
   * @default 0
   */
  readonly dotHaloBlur?: number;
  /**
   * Extra gap in px between the top of the plot and the tooltip panel.
   * @default 0
   */
  readonly topOffset?: number;
  /** The date pill's text for each data row, in row order (pair it with `XAxis` `labels`). */
  readonly dateLabels?: readonly string[];
  /** Spring for the floating panel. Takes priority over `matchCrosshair` and `damping`. */
  readonly boxSpringConfig?: SpringConfig;
  /**
   * Accepted for bklit-ui compatibility. It has no effect in bklit-tanstack-charts. Style the panel with `className` or the `--chart-tooltip-*` CSS variables instead.
   */
  readonly panelStyle?: Style;
  /**
   * Accepted for bklit-ui compatibility. It has no effect in bklit-tanstack-charts. Set `--chart-tooltip-background` instead.
   */
  readonly backgroundColor?: string;
  /**
   * Thickness of the crosshair: a width in px, or `"line"` (1px), `"thin"` (2px), `"medium"` (4px) or `"thick"` (8px).
   * @default "line"
   */
  readonly indicatorWidth?: IndicatorWidth;
  /** Accepted for bklit-ui compatibility. It has no effect in bklit-tanstack-charts. */
  readonly columnWidth?: number;
}

/**
 * A drag selection over the chart, in x-axis data indices. `SegmentBackground` and the `SegmentLine*` children read it from `useChartHover()`.
 */
export interface ChartSelection {
  /** X position (px) where the drag started. */
  readonly startX: number;
  /** X position (px) where the drag currently ends. */
  readonly endX: number;
  /** Data index where the selection starts. */
  readonly startIndex: number;
  /** Data index where the selection ends. */
  readonly endIndex: number;
  /** Whether a drag is in progress. */
  readonly active: boolean;
}

/** Props of {@link LineChart}. */
export interface LineChartProps<Node, Style> extends ChartLinkProps {
  /** The rows to plot. Each row is an object holding the x value under `xDataKey` and one number per series under that series' `dataKey`. */
  readonly data: ChartDatum[];
  /**
   * Key of the x value in each row. The value must be a `Date` (or something `new Date()` accepts, such as a timestamp).
   * @default "date"
   */
  readonly xDataKey?: string;
  /**
   * `"loading"` shows the loading state (skeleton line, grid shimmer, optional label) and ignores the pointer; switching to `"ready"` reveals the real data on the same chart instance.
   * @default "ready"
   */
  readonly status?: ChartStatus;
  /**
   * Duration of the entrance reveal in milliseconds. `0` skips the animation.
   * @default 1100
   */
  readonly animationDuration?: number;
  /**
   * Space around the plot area in pixels, for axis labels and the tooltip. Missing sides use the default.
   * @default { top: 40, right: 40, bottom: 40, left: 40 }
   */
  readonly margin?: Partial<ChartMargin>;
  /**
   * CSS aspect ratio of the chart (`"width / height"` or a number), applied to the container width.
   * @default "2 / 1"
   */
  readonly aspectRatio?: string;
  /** Extra CSS class name for the chart container. */
  readonly className?: string;
  /** Called with `"loading"` or `"ready"` when `status` changes (and once on mount). */
  readonly onPhaseChange?: (phase: ChartPhase) => void;
  /** The layers to draw: `Grid`, `Line`, `XAxis`, `YAxis`, `ChartTooltip` and the other chart children. */
  readonly children: Node;
  /** Text shown centered over the chart, with a shimmer, while `status` is `"loading"`. Nothing is shown when it is unset or empty. */
  readonly loadingLabel?: string;
  /** Inline styles for the chart container, for example a fixed height for a brush strip. */
  readonly style?: Style;
  /**
   * CSS easing of the entrance reveal (a `cubic-bezier(…)`, `linear`, `ease-in-out`…). `enterTransition` takes priority.
   * @default "cubic-bezier(0.85, 0, 0.15, 1)"
   */
  readonly animationEasing?: string;
  /**
   * Animate the y domain when the data or `status` changes instead of jumping to the new scale.
   * @default true
   */
  readonly yDomainTween?: boolean;
  /**
   * Per-axis y-domain overrides, keyed by `yAxisId` (`"left"` for the default axis): a fixed `[min, max]`, or a function of the auto domain
   * (before it is niced) that returns the one to use, e.g. `{ left: ([, max]) => [0, max * 3] }`. Hoist the object out of render.
   */
  readonly yDomains?: Readonly<Record<string, YDomainOverride>>;
  /**
   * Duration in milliseconds of the y-domain tween (a data update, the loading to ready handoff, a brushed window).
   * @default 500
   */
  readonly yDomainTweenDuration?: number;
  /** Visible x range as `[start, end]`, used for brush zoom. The chart plots only this range of `data`. */
  readonly xDomain?: [Date, Date];
  /** Length of the full dataset while `xDomain` zooms into part of it. It keeps the x spacing consistent with the unzoomed chart. */
  readonly xDomainSlotCount?: number;
  /** Accepted for bklit-ui compatibility. It has no effect. */
  readonly tweenYDomainOnXDomainChange?: boolean;
  /** The entrance reveal as a motion transition: its `duration` (seconds) and `ease` (a cubic-bezier array or a CSS easing) override `animationDuration` and `animationEasing`. A reveal is always a tween. */
  readonly enterTransition?: EnterTransition;
  /**
   * Fixed top of the y domain on a single-axis chart: the domain becomes `[0, yScaleDomainMax × 1.1]` (niced) instead of following the data, leaving headroom above the series
   * or keeping several charts on one scale.
   */
  readonly yScaleDomainMax?: number;
  /** Changing this string replays the entrance animation. Do not change it when only the data changes. */
  readonly revealSignature?: string;
  /**
   * Accessible name of the chart.
   * @default "Line chart"
   */
  readonly ariaLabel?: string;
  /** Longer accessible description of the chart, exposed as `aria-description`. */
  readonly ariaDescription?: string;
}

/** Props of {@link AreaChart}. */
export interface AreaChartProps<Node, Style> extends ChartLinkProps {
  /** The rows to plot. Each row is an object holding the x value under `xDataKey` and one number per series under that series' `dataKey`. */
  readonly data: ChartDatum[];
  /**
   * Key of the x value in each row. The value must be a `Date` (or something `new Date()` accepts, such as a timestamp).
   * @default "date"
   */
  readonly xDataKey?: string;
  /**
   * `"loading"` shows the loading state (skeleton area, grid shimmer, optional label) and ignores the pointer; switching to `"ready"` reveals the real data on the same chart instance.
   * @default "ready"
   */
  readonly status?: ChartStatus;
  /**
   * Duration of the entrance reveal in milliseconds. `0` skips the animation.
   * @default 1100
   */
  readonly animationDuration?: number;
  /**
   * Space around the plot area in pixels, for axis labels and the tooltip. Missing sides use the default.
   * @default { top: 40, right: 40, bottom: 40, left: 40 }
   */
  readonly margin?: Partial<ChartMargin>;
  /**
   * CSS aspect ratio of the chart (`"width / height"` or a number), applied to the container width.
   * @default "2 / 1"
   */
  readonly aspectRatio?: string;
  /** Extra CSS class name for the chart container. */
  readonly className?: string;
  /** Called with `"loading"` or `"ready"` when `status` changes (and once on mount). */
  readonly onPhaseChange?: (phase: ChartPhase) => void;
  /** The layers to draw: `Grid`, `Area`, `XAxis`, `YAxis`, `ChartTooltip` and the other chart children. */
  readonly children: Node;
  /** Text shown centered over the chart, with a shimmer, while `status` is `"loading"`. Nothing is shown when it is unset or empty. */
  readonly loadingLabel?: string;
  /** Inline styles for the chart container, for example a fixed height for a brush strip. */
  readonly style?: Style;
  /**
   * CSS easing of the entrance reveal (a `cubic-bezier(…)`, `linear`, `ease-in-out`…). `enterTransition` takes priority.
   * @default "cubic-bezier(0.85, 0, 0.15, 1)"
   */
  readonly animationEasing?: string;
  /**
   * Animate the y domain when the data or `status` changes instead of jumping to the new scale.
   * @default true
   */
  readonly yDomainTween?: boolean;
  /**
   * Per-axis y-domain overrides, keyed by `yAxisId` (`"left"` for the default axis): a fixed `[min, max]`, or a function of the auto domain
   * (before it is niced) that returns the one to use, e.g. `{ left: ([, max]) => [0, max * 3] }`. Hoist the object out of render.
   */
  readonly yDomains?: Readonly<Record<string, YDomainOverride>>;
  /**
   * Duration in milliseconds of the y-domain tween (a data update, the loading to ready handoff, a brushed window).
   * @default 500
   */
  readonly yDomainTweenDuration?: number;
  /** Visible x range as `[start, end]`, used for brush zoom. The chart plots only this range of `data`. */
  readonly xDomain?: [Date, Date];
  /** Length of the full dataset while `xDomain` zooms into part of it. It keeps the x spacing consistent with the unzoomed chart. */
  readonly xDomainSlotCount?: number;
  /** Accepted for bklit-ui compatibility. It has no effect. */
  readonly tweenYDomainOnXDomainChange?: boolean;
  /** The entrance reveal as a motion transition: its `duration` (seconds) and `ease` (a cubic-bezier array or a CSS easing) override `animationDuration` and `animationEasing`. A reveal is always a tween. */
  readonly enterTransition?: EnterTransition;
  /**
   * Fixed top of the y domain on a single-axis chart: the domain becomes `[0, yScaleDomainMax × 1.1]` (niced) instead of following the data, leaving headroom above the series
   * or keeping several charts on one scale.
   */
  readonly yScaleDomainMax?: number;
  /** Changing this string replays the entrance animation. Do not change it when only the data changes. */
  readonly revealSignature?: string;
  /**
   * Accessible name of the chart.
   * @default "Area chart"
   */
  readonly ariaLabel?: string;
  /** Longer accessible description of the chart, exposed as `aria-description`. */
  readonly ariaDescription?: string;
}

/** Props of `LineChartLoading`. */
export interface LineChartLoadingProps<Style> extends CartesianLoadingProps {
  /**
   * Inline styles for the placeholder container. With `aspectRatio: "unset"` and a `height` the placeholder fills that height at any width,
   * for example to hold a `LiveLineChart`'s `style.height` while its stream connects.
   */
  readonly style?: Style;
}

export type AreaChartLoadingProps = CartesianLoadingProps;

/** Lifecycle phase reported by `ScatterChart`'s `onPhaseChange`: `"revealing"` while the points enter, `"ready"` once the chart is interactive. */
type ScatterChartPhase = "loading" | "revealing" | "ready";

/** Props of {@link ScatterChart}. */
export interface ScatterChartProps<Node, Style> {
  /** The rows to plot. Each row holds the x value under `xDataKey` and one number per `Scatter` series under that series' `dataKey`. */
  readonly data: readonly Row[];
  /**
   * Key of the x value in each row. The value must be a `Date` (or something `new Date()` accepts, such as a timestamp).
   * @default "date"
   */
  readonly xDataKey?: string;
  /**
   * Duration of the entrance reveal in milliseconds. `0` skips the animation. `enterTransition.duration` overrides it.
   * @default 1100
   */
  readonly animationDuration?: number;
  /**
   * Space around the plot area in pixels. Missing sides use the default.
   * @default { top: 40, right: 40, bottom: 40, left: 40 }
   */
  readonly margin?: Partial<ChartMargin>;
  /**
   * CSS aspect ratio of the chart (`"width / height"` or a number), applied to the container width.
   * @default "2 / 1"
   */
  readonly aspectRatio?: string;
  /** Extra CSS class name for the chart container. */
  readonly className?: string;
  /** Inline styles for the chart container. */
  readonly style?: Style;
  /** Called with `"revealing"` when the entrance starts and `"ready"` when the chart becomes interactive. */
  readonly onPhaseChange?: (phase: ScatterChartPhase) => void;
  /** CSS easing for the per-point entrance, for example `"cubic-bezier(0.85, 0, 0.15, 1)"`. When unset, `enterTransition.ease` or the default reveal easing is used. */
  readonly animationEasing?: string;
  /** Entrance timing: `duration` (in seconds) sets the length of the reveal and `ease` (a four-number cubic bezier) the easing. */
  readonly enterTransition?: { readonly duration?: number; readonly ease?: unknown };
  /** Changing this string replays the entrance animation. */
  readonly revealSignature?: string;
  /**
   * Spreads points that share an x value into a strip plot, by seeded offsets that never move between renders. Hover then snaps to the
   * nearest point, the tooltip shows its real values, and `ChartTooltip` hides its crosshair unless `showCrosshair` is set. `true`
   * spreads 0.35 of the band step; see `ScatterJitter` for the other forms.
   */
  readonly jitter?: ScatterJitter;
  /**
   * Formats the x-axis ticks and the date pill, for example short month names for monthly data (the tooltip keeps its weekday date).
   * `XAxis`'s `formatValue` still wins on the axis. Defaults to `"Jan 1"` style labels.
   */
  readonly formatXLabel?: (date: Date) => string;
  /** The layers to draw: `Grid`, one or more `Scatter`, `XAxis`, `YAxis`, `ChartTooltip` and the other chart children. */
  readonly children: Node;
  /**
   * Accessible name of the chart.
   * @default "Scatter chart"
   */
  readonly ariaLabel?: string;
  /** Longer accessible description of the chart, exposed as `aria-description`. */
  readonly ariaDescription?: string;
}

/**
 * Props of `SeriesPointMarker`. It inherits the marker appearance props of `SeriesPointMarkerStyle`; only `fill`, `stroke`, `strokeWidth`, `ringGap`, `outlineWidth`, `outlineColor`, `radius` and `enterBlur` change how it looks.
 */
export interface SeriesPointMarkerProps extends SeriesPointMarkerStyle {
  /** Key of the series this marker belongs to. Part of the identity that replays the entrance. */
  dataKey: string;
  /** Index of the data row this marker belongs to. Part of the identity that replays the entrance. */
  index: number;
  /** Horizontal center in plot pixels. */
  cx: number;
  /** Vertical center in plot pixels. */
  cy: number;
  /** Seconds to wait before the fade-in starts. */
  revealDelay: number;
  /** Changes whenever the chart replays its entrance; a new value restarts the fade-in. */
  revealEpoch: number;
  /** Duration of the fade-in in seconds. */
  enterDuration: number;
}

/** Props of `SegmentBackground`, the highlight drawn behind a dragged selection. */
export interface SegmentBackgroundProps {
  /**
   * Fill color of the selected area.
   * @default "var(--chart-segment-background)"
   */
  readonly fill?: string;
}

/** Line style of a `SegmentLineFrom` or `SegmentLineTo`: `"dashed"`, `"solid"` or `"gradient"` (fades out). */
export type SegmentLineVariant = "dashed" | "solid" | "gradient";

/** Props of `SegmentLineFrom` and `SegmentLineTo`, the vertical lines at the start and end of a dragged selection. */
export interface SegmentLineProps {
  /**
   * Line color.
   * @default "var(--chart-segment-line)"
   */
  stroke?: string;
  /**
   * Line width in px.
   * @default 1
   */
  strokeWidth?: number;
  /**
   * Line style: dashed, solid, or a gradient that fades out.
   * @default "dashed"
   */
  readonly variant?: SegmentLineVariant;
}

/** Props of `LineChartLoading` and `AreaChartLoading`. */
interface CartesianLoadingProps {
  /**
   * Space around the plot area in pixels. Missing sides use the default.
   * @default { top: 40, right: 40, bottom: 40, left: 40 }
   */
  readonly margin?: Partial<ChartMargin>;
  /**
   * Color of the traveling loading segment.
   * @default "var(--bkm-foreground)"
   */
  readonly stroke?: string;
  /**
   * Opacity of the traveling loading segment.
   * @default 0.5
   */
  readonly strokeOpacity?: number;
  /**
   * Color of the grid lines while loading. Use `color-mix` or an oklch alpha to set the opacity.
   * @default "color-mix(in oklch, var(--chart-grid) 50%, transparent)"
   */
  readonly gridStroke?: string;
  /**
   * Color of the shimmer band that travels across the grid. Use `color-mix` or an oklch alpha to set the opacity.
   * @default "color-mix(in oklch, var(--bkm-foreground) 68%, transparent)"
   */
  readonly gridShimmerStroke?: string;
  /**
   * Animate a shimmer band across the grid lines. Always off when `loadingStyle` is `"sweep"`.
   * @default true
   */
  readonly gridShimmer?: boolean;
  /** Accepted for bklit-ui compatibility. It has no effect: the shimmer band has a fixed width. */
  readonly gridShimmerLength?: number;
  /**
   * Shimmer speed multiplier; higher is faster.
   * @default 1
   */
  readonly gridShimmerSpeed?: number;
  /** Accepted for bklit-ui compatibility. It has no effect: the shimmer always loops on the same period as the line pulse. */
  readonly gridShimmerSync?: boolean;
  /**
   * Loading animation: `"pulse"` sends a bright segment along the line, `"sweep"` sweeps a soft diagonal shimmer across it.
   * @default "pulse"
   */
  readonly loadingStyle?: LoadingStyle;
  /**
   * Text shown centered over the placeholder, with a shimmer. An empty string hides it.
   * @default "Loading"
   */
  readonly label?: string;
  /**
   * CSS aspect ratio of the placeholder, as `"width / height"`.
   * @default "2 / 1"
   */
  readonly aspectRatio?: string;
  /**
   * Extra CSS class name for the placeholder container.
   * @default ""
   */
  readonly className?: string;
}

/** A colour stop on a `LineBackdrop`'s radial gradient: `offset` 0-1 from the centre to the rim. */
export interface LineBackdropStop {
  readonly offset: number;
  readonly color: string;
  /**
   * Opacity of the stop, 0-1.
   * @default 1
   */
  readonly opacity?: number;
}

export interface LineBackdropProps {
  /** The series it follows: the `dataKey` of the `Line` it sits behind. */
  readonly dataKey: string;
  /**
   * Id of the y scale the series is plotted against.
   * @default "left"
   */
  readonly yAxisId?: string | number;
  /**
   * The region it fills: between the line and the top of the plot (`"above"`) or between the line and the bottom (`"below"`).
   * @default "above"
   */
  readonly side?: "above" | "below";
  /**
   * d3-shape curve factory: keep it the line's.
   * @default curveNatural
   */
  readonly curve?: CurveFactory;
  /**
   * Fade in after the line's reveal and follow its data and y-domain tweens. `false` shows it at once.
   * @default true
   */
  readonly animate?: boolean;
  /** Radial gradient stops, centre to rim. Defaults to `var(--chart-line-primary)` at 35% opacity fading to transparent. */
  readonly stops?: readonly LineBackdropStop[];
  /**
   * Centre of the gradient as fractions of the plot's width and height.
   * @default { x: 0.5, y: 1 }
   */
  readonly center?: { readonly x: number; readonly y: number };
  /**
   * Radii of the gradient as fractions of the plot's width and height.
   * @default { x: 0.75, y: 1 }
   */
  readonly radius?: { readonly x: number; readonly y: number };
  /**
   * Overall opacity of the backdrop, 0-1.
   * @default 1
   */
  readonly opacity?: number;
}

/** How a `TrendLine` is stroked. */
export type TrendLineStrokeStyle = "solid" | "gradient" | "dashed";

export interface TrendLineProps {
  /** Key of the series the least-squares line is fitted to. */
  readonly dataKey: string;
  /**
   * Stroke colour.
   * @default "var(--chart-line-primary)"
   */
  readonly stroke?: string;
  /**
   * Stroke width in px.
   * @default 2
   */
  readonly strokeWidth?: number;
  /**
   * A solid, dashed or gradient stroke (the gradient runs along the line from `gradientStart` to `gradientEnd`).
   * @default "dashed"
   */
  readonly strokeStyle?: TrendLineStrokeStyle;
  /**
   * Dash pattern when `strokeStyle` is `"dashed"`.
   * @default "6,4"
   */
  readonly strokeDasharray?: string;
  /** Gradient start colour when `strokeStyle` is `"gradient"`. Defaults to `stroke`. */
  readonly gradientStart?: string;
  /**
   * Gradient end colour when `strokeStyle` is `"gradient"`.
   * @default "var(--chart-5)"
   */
  readonly gradientEnd?: string;
  /**
   * Fade the line's ends to transparent along its own direction: `true` both, `"left"` / `"right"` one.
   * @default false
   */
  readonly fadeEdges?: boolean | "left" | "right";
  /**
   * The fade zone per faded end, as a percentage of the line's length (0-50).
   * @default 15
   */
  readonly fadeEdgesLength?: number;
  /**
   * Opacity of the line, 0-1.
   * @default 1
   */
  readonly opacity?: number;
  /**
   * Id of the y scale the series is plotted against.
   * @default "left"
   */
  readonly yAxisId?: string | number;
  /**
   * Fade in after the series reveal and glide to the new fit when the data changes. `false` shows it at once.
   * @default true
   */
  readonly animate?: boolean;
  /**
   * Class of the trend line's group.
   * @default "chart-trend-line"
   */
  readonly className?: string;
}
