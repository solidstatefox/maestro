import type { CurveFactory } from "d3-shape";
import type { PatternPresetId, PatternPresetOptions } from "../pattern/pattern-preset-helpers";
import type { ChartStatFlowFormat } from "./stat-flow";

/** `Band`'s fill: a flat colour, a vertical gradient from the upper edge to the lower, or a pattern preset. */
export type BandFillType = "solid" | "gradient" | "pattern";

/**
 * The sides `fadeEdges` fades: `true` every side, `"left"` / `"right"` one horizontal side, or any combination. Horizontal fades span the band's
 * width, vertical fades its own pixel height.
 */
export type BandFadeEdges = boolean | "left" | "right" | { readonly top?: boolean; readonly right?: boolean; readonly bottom?: boolean; readonly left?: boolean };

/** One edge of a `Band`: every field falls back to the band's shared stroke props. */
export interface BandStrokeProps {
  /** Edge color. Defaults to the band's `stroke`, else its `fill`. */
  readonly stroke?: string;
  /** Edge width; `0` hides the edge. Defaults to the band's `strokeWidth`. */
  readonly strokeWidth?: number;
  /** Edge dash pattern. Defaults to the band's `strokeDasharray`. */
  readonly strokeDasharray?: string;
  /** Edge opacity. Defaults to the band's `strokeOpacity`. */
  readonly strokeOpacity?: number;
}

/** Props of `Band`: the shaded range between two data keys of every row. */
export interface BandProps {
  /** Data key of the band's upper edge. */
  readonly upperKey: string;
  /** Data key of the band's lower edge. */
  readonly lowerKey: string;
  /**
   * The y axis the band is drawn against.
   * @default "left"
   */
  readonly yAxisId?: string | number;
  /** The tooltip row's label. Defaults to `"lowerKey – upperKey"` (the key itself when both edges use one key). */
  readonly label?: string;
  /**
   * Add a `low – high` row and a dot on each edge to `ChartTooltip`.
   * @default true
   */
  readonly showInTooltip?: boolean;
  /**
   * The curve both edges are drawn with (match your `Line`).
   * @default curveNatural
   */
  readonly curve?: CurveFactory;
  /**
   * The band's color: the fill, the edges, the tooltip swatch and the edge dots.
   * @default "var(--chart-line-primary)"
   */
  readonly fill?: string;
  /**
   * `"solid"`, `"gradient"` (from `fillOpacity` at the upper edge to `gradientToOpacity` at the lower) or `"pattern"`.
   * @default "solid"
   */
  readonly fillType?: BandFillType;
  /**
   * The solid fill's opacity, or the gradient's at the upper edge.
   * @default 0.15
   */
  readonly fillOpacity?: number;
  /**
   * The gradient's opacity at the lower edge.
   * @default 0
   */
  readonly gradientToOpacity?: number;
  /**
   * The pattern preset when `fillType` is `"pattern"`.
   * @default "diagonal"
   */
  readonly pattern?: PatternPresetId;
  /** The pattern's color. Defaults to `fill`. */
  readonly patternColor?: string;
  /** The pattern tile's scale. */
  readonly patternScale?: number;
  /** Stroke width of a line-based pattern. */
  readonly patternStrokeWidth?: number;
  /**
   * Opacity of the pattern fill.
   * @default 1
   */
  readonly patternOpacity?: number;
  /** The edges' shared color. Defaults to `fill`. */
  readonly stroke?: string;
  /**
   * The edges' shared width; `0` hides both.
   * @default 1
   */
  readonly strokeWidth?: number;
  /** The edges' shared dash pattern. Solid by default. */
  readonly strokeDasharray?: string;
  /**
   * The edges' shared opacity.
   * @default 1
   */
  readonly strokeOpacity?: number;
  /** `false` hides the upper edge; an object overrides the shared stroke for it. */
  readonly upperStroke?: BandStrokeProps | false;
  /** `false` hides the lower edge; an object overrides the shared stroke for it. */
  readonly lowerStroke?: BandStrokeProps | false;
  /**
   * Fade the fill and edges to transparent at these sides.
   * @default false
   */
  readonly fadeEdges?: BandFadeEdges;
  /**
   * The fraction (0 to 0.5) of the width or height each fade covers.
   * @default 0.15
   */
  readonly fadeSize?: number;
  /** Accepted so bklit-ui code compiles: the band's marks are the chart's own (style them through `fill` and the stroke props). */
  readonly className?: string;
}

/** A `Band` as the chart reads it: what extends the y domain and what the tooltip lists (bklit-ui `BandConfig`). */
export interface BandConfig {
  readonly yAxisId: string;
  readonly upperKey: string;
  readonly lowerKey: string;
  /** The band's color (its `fill`). */
  readonly color: string;
  readonly label: string;
  readonly showInTooltip: boolean;
}

/** `Deadline`'s region fill; `"none"` draws only the line. */
export type DeadlineFillType = "pattern" | "solid" | "gradient" | "none";

/** A date as `Deadline` takes it: a `Date`, epoch milliseconds or a date string (`"2026-10-15"` is local midnight). */
export type DeadlineDate = Date | number | string;

/** Props of `Deadline`: a due-date line with a region to its right that fades out. */
export interface DeadlineProps {
  /** The marker line's date: the region's left edge. */
  readonly date: DeadlineDate;
  /** Where the region ends. Defaults to the plot's right edge. */
  readonly endDate?: DeadlineDate;
  /**
   * The line's and the region's color.
   * @default "var(--chart-negative, var(--color-red-500))"
   */
  readonly color?: string;
  /**
   * The region's fill: diagonal stripes, a gradient, a flat color, or `"none"` for the line alone.
   * @default "pattern"
   */
  readonly fillType?: DeadlineFillType;
  /** The region's opacity. Defaults to 0.6 for `pattern`, 0.25 for `gradient`, 0.12 for `solid`. */
  readonly fillOpacity?: number;
  /**
   * `gradient` only: the opacity at the region's right edge.
   * @default 0
   */
  readonly gradientToOpacity?: number;
  /**
   * The pattern preset when `fillType` is `"pattern"`.
   * @default "diagonal"
   */
  readonly pattern?: PatternPresetId;
  /**
   * The pattern tile's scale.
   * @default 1.5
   */
  readonly patternScale?: number;
  /**
   * The stripes' width.
   * @default 1
   */
  readonly patternStrokeWidth?: number;
  /**
   * Fade the region out towards its right edge.
   * @default true
   */
  readonly fade?: boolean;
  /**
   * The fraction (0 to 1) of the region, from its right edge, that fades.
   * @default 0.5
   */
  readonly fadeLength?: number;
  /**
   * Draw the vertical marker line.
   * @default true
   */
  readonly showLine?: boolean;
  /** The line's color. Defaults to `color`. */
  readonly stroke?: string;
  /**
   * The line's width.
   * @default 1
   */
  readonly strokeWidth?: number;
  /** The line's dash pattern. Solid by default. */
  readonly strokeDasharray?: string;
  /**
   * The line's opacity.
   * @default 1
   */
  readonly strokeOpacity?: number;
  /** Text beside the line (it flips to the line's left near the plot's right edge). */
  readonly label?: string;
  /**
   * Where the label sits.
   * @default "top"
   */
  readonly labelPosition?: "top" | "bottom";
  /** The label's color. Defaults to `color`. */
  readonly labelColor?: string;
  /** Category (bar) charts only: the data key holding each row's date. Defaults to the first field holding a `Date` or `"YYYY-MM-DD"` string. */
  readonly dateKey?: string;
  /** Class on the deadline's marks. */
  readonly className?: string;
}

/** `Weekends`' fill: diagonal stripes or a flat color. */
export type WeekendsFillType = "pattern" | "solid";

/** Props of `Weekends`: weekend spans shaded behind the series of a date x axis. */
export interface WeekendsProps {
  /**
   * The days that count as weekend, as `Date#getDay()` numbers (0 = Sunday); `[5, 6]` for Friday–Saturday weekends.
   * @default [6, 0]
   */
  readonly weekendDays?: readonly number[];
  /**
   * Diagonal stripes or a flat color.
   * @default "pattern"
   */
  readonly fillType?: WeekendsFillType;
  /**
   * The stripes' or the fill's color.
   * @default "var(--chart-foreground-muted)"
   */
  readonly fill?: string;
  /** The fill's opacity. Defaults to 0.45 for `pattern`, 0.08 for `solid`. */
  readonly fillOpacity?: number;
  /**
   * The pattern preset when `fillType` is `"pattern"`.
   * @default "diagonal"
   */
  readonly pattern?: PatternPresetId;
  /**
   * The pattern tile's scale.
   * @default 1.5
   */
  readonly patternScale?: number;
  /**
   * The stripes' width.
   * @default 1
   */
  readonly patternStrokeWidth?: number;
  /**
   * `"calendar"` shades midnight to midnight; `"centered"` shifts the spans half a day so daily points sit mid-span; `"auto"` picks
   * `"centered"` on a `ComposedChart` whose `SeriesBar` columns sit at midnight.
   * @default "auto"
   */
  readonly align?: "auto" | "calendar" | "centered";
  /**
   * Use UTC day boundaries instead of local time.
   * @default false
   */
  readonly utc?: boolean;
  /**
   * Draw nothing while one day is narrower than this many pixels.
   * @default 2
   */
  readonly minDayWidth?: number;
  /** Category (bar) charts only: the data key holding each row's date. */
  readonly dateKey?: string;
  /** Class on the weekends' marks. */
  readonly className?: string;
}

/** Props of `ChartCrosshair`: a horizontal line at the pointer's y with the axis value in a pill, and a vertical line on the hovered column. */
export interface ChartCrosshairProps {
  /**
   * Draw the horizontal line (and the value pill) at the pointer's y.
   * @default true
   */
  readonly horizontal?: boolean;
  /**
   * Draw the vertical line.
   * @default true
   */
  readonly vertical?: boolean;
  /**
   * The vertical line snaps to the hovered column; `false` follows the pointer, so both lines cross under it.
   * @default true
   */
  readonly snap?: boolean;
  /**
   * The axis whose scale turns the pointer's y into the pill's value. The `YAxis` with this id fades the ticks under the pill.
   * @default "left"
   */
  readonly yAxisId?: string | number;
  /** The plot edge the pill sits on. Defaults to `"right"` for the `right` axis, else `"left"`. */
  readonly side?: "left" | "right";
  /**
   * Show the value pill on the axis.
   * @default true
   */
  readonly showValueLabel?: boolean;
  /**
   * Roll the pill's digits as the value changes (with `format`, `prefix` and `suffix`; `formatValue` is ignored).
   * @default false
   */
  readonly numberFlow?: boolean;
  /**
   * `Intl.NumberFormat` options for the pill.
   * @default { maximumFractionDigits: 2 }
   */
  readonly format?: ChartStatFlowFormat;
  /** Text before the value (`"$"`). */
  readonly prefix?: string;
  /** Text after the value (`"%"`). */
  readonly suffix?: string;
  /** Formats the pill's value (without `numberFlow`). */
  readonly formatValue?: (value: number) => string;
  /**
   * The lines' color.
   * @default "var(--chart-crosshair)"
   */
  readonly stroke?: string;
  /**
   * The lines' dash pattern.
   * @default "3,3"
   */
  readonly strokeDasharray?: string;
  /**
   * The lines' width.
   * @default 1
   */
  readonly strokeWidth?: number;
  /** The spring the lines and the pill follow. Defaults to the chart's tooltip spring; `{ stiffness: 0 }`-free charts land at once. */
  readonly springConfig?: { readonly stiffness: number; readonly damping: number };
}

/** Props of `BackgroundPatternLayer`: a pattern fill with edge fades at an explicit size, for any svg (the cartesian `Background` reads its size from the chart). */
export interface BackgroundPatternLayerProps extends PatternPresetOptions {
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
   * Draw the pattern.
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
   * The horizontal fade, as a percent of the width per edge (0 to 45).
   * @default 10
   */
  readonly fadeHorizontalLength?: number;
  /**
   * The vertical fade, as a percent of the height per edge (0 to 45).
   * @default 10
   */
  readonly fadeVerticalLength?: number;
  /** The layer's width in px. */
  readonly width: number;
  /** The layer's height in px. */
  readonly height: number;
  /**
   * Fade the layer in (420ms); `false` keeps it hidden.
   * @default true
   */
  readonly isLoaded?: boolean;
  /** Accepted so bklit-ui code compiles: the fade-in is the kit's. */
  readonly enterTransition?: unknown;
}

/** Props of `TooltipHeader`: the popover-style header row of a custom tooltip body. */
export interface TooltipHeaderProps<Node = unknown> {
  readonly children?: Node;
  readonly className?: string;
}
