import type { CurveFactory } from "d3-shape";
import type { ChartStatFlowFormat } from "./stat-flow";

/** One series of a `RadialChart`, innermost (or first stacked) first. */
export interface RadialSeries {
  /** Datum key holding this series' value for a bin. */
  readonly dataKey: string;
  /** Legend and centre label. Defaults to `dataKey`. */
  readonly label?: string;
  /** Fill or stroke colour. Defaults to the palette slot for the series index, `var(--chart-N)` (see `radialSeriesColor`). */
  readonly color?: string;
  /**
   * Base opacity of the series' marks.
   * @default 1
   */
  readonly opacity?: number;
  /**
   * Radial opacity ramp: the opacity at the band base, rising to full opacity outward. Layers decide how to apply it.
   * @default 1 (no ramp)
   */
  readonly rampFrom?: number;
  /** Tint this series' legend total with its colour (an alert series, say). */
  readonly emphasize?: boolean;
}

/**
 * What the angle encodes.
 * - `clock`: bins of a day (00 at the start angle). Tracks "now" and future bins (ghost data) and labels the axis 00 / 06 / 12 / 18.
 * - `band`: categories; `RadialAxis` labels every bin with `datum[xDataKey]`.
 * - `time`: `datum[xDataKey]` is a Date, timestamp or ISO string per evenly spaced bin; `RadialAxis` draws time ticks (months, say).
 */
export type RadialAngleType = "clock" | "band" | "time";

/**
 * How bins and values map onto the disc.
 * - `radial`: bins around the angle, the value outward along the radius.
 * - `angular`: bins are concentric rings (the first innermost) and the value sweeps along the angle (progress rings). Draw it with `RadialRingBar`.
 */
export type RadialOrientation = "radial" | "angular";

/**
 * The chart's shared value scale for every layer without its own `maxValue`.
 * - a number: the value at the band top
 * - `"auto"`: the largest single value of any series or `valueKeys` key
 * - `"stacked"`: the largest per-bin sum of the series (and any `valueKeys`)
 */
export type RadialMaxValue = number | "auto" | "stacked";

/** Radii of one ring of an `angular` chart. */
export interface RadialRingBand {
  readonly inner: number;
  readonly outer: number;
  /** Mid radius of the ring. */
  readonly center: number;
}

/** Radii of the chart's rings as fractions of the chart radius, shared by every layer (`defaultRadialLayout`). */
export interface RadialLayout {
  /** Centre circle (hole) radius. */
  readonly center: number;
  /** Tick ring: inner end of every tick. */
  readonly tickInner: number;
  /** Tick ring: outer end of minor ticks. */
  readonly tickMinorOuter: number;
  /** Tick ring: outer end of major ticks. */
  readonly tickMajorOuter: number;
  /** Value band base: the minimum value maps here. */
  readonly bandInner: number;
  /** Value band top: the maximum value maps here. */
  readonly bandOuter: number;
  /** Where the scrubber line ends. */
  readonly scrubberOuter: number;
  /** Axis (hour) labels. */
  readonly axisLabel: number;
}

/** A spring: motion's `SpringOptions` subset the radial springs read. */
export interface RadialSpringOptions {
  readonly stiffness?: number;
  readonly damping?: number;
  readonly mass?: number;
}

/**
 * How a hover dot (a `RadialLine` marker, a `RadialArea` active dot) follows the pointer. It always rides the curve: its radius is the edge's
 * radius at the dot's current angle.
 * - `crosshair`: locked to the crosshair, the same animated angle as `RadialScrubber` (or the chart's matching spring without one)
 * - `spring`: its own spring toward the hovered bin
 * - `none`: snaps to the hovered bin
 */
export type RadialDotMotion = "crosshair" | "spring" | "none";

/** Edge radius along a ray at `angle`, or `null` where there is no edge (gaps). */
export type RadialEdgeLookup = (angle: number) => number | null;

/** An animated angle in radians (motion's `MotionValue` subset): read it, or follow its changes. */
export interface RadialAngleValue {
  /** The current angle. */
  get(): number;
  /** Calls `listener` with every new angle; returns the unsubscribe. */
  on(event: "change", listener: (angle: number) => void): () => void;
}

/** Props of `RadialChart`. */
export interface RadialChartProps<Node> {
  /** One datum per angular bin, clockwise from the start angle (96 × 15 minutes, say). */
  readonly data: readonly Record<string, unknown>[];
  /**
   * Datum key with the bin label, category or time.
   * @default "time"
   */
  readonly xDataKey?: string;
  /** Series, innermost (first stacked) first. */
  readonly series: readonly RadialSeries[];
  /** Override ring radii (fractions of the chart radius). */
  readonly layout?: Partial<RadialLayout>;
  /**
   * What the angle encodes.
   * @default "clock"
   */
  readonly angleType?: RadialAngleType;
  /**
   * Bins along the angle, or as concentric rings.
   * @default "radial"
   */
  readonly orientation?: RadialOrientation;
  /**
   * Arc start in degrees, 0 at 12 o'clock, clockwise.
   * @default 0
   */
  readonly startAngle?: number;
  /**
   * Arc end in degrees.
   * @default startAngle + 360 (the full circle)
   */
  readonly endAngle?: number;
  /**
   * Crop the stage to the arc's bounding box for partial arcs (a semicircle is about twice as wide as tall).
   * @default true
   */
  readonly fitArc?: boolean;
  /**
   * Track "now": bins after the last bin with data are future bins (ghost data; the scrubber rests at now).
   * @default true for clock charts
   */
  readonly trackNow?: boolean;
  /**
   * The bin the resting scrubber points at.
   * @default the last bin with data
   */
  readonly nowIndex?: number;
  /** Shared value scale for every layer without its own `maxValue` (it also drives `RadialAxis` value rings). Unset, each layer scales itself (`angular` charts default to `"stacked"`). */
  readonly maxValue?: RadialMaxValue;
  /**
   * Value mapped to the band base; `"auto"` is the smallest value.
   * @default 0
   */
  readonly minValue?: number | "auto";
  /** Extra datum keys (not series) in the automatic domain, `"yesterday"` say. */
  readonly valueKeys?: readonly string[];
  /**
   * Round an automatic domain to nice tick values.
   * @default true
   */
  readonly niceValues?: boolean;
  /**
   * `angular` orientation: the gap between rings as a fraction of a ring step.
   * @default 0.3
   */
  readonly ringGap?: number;
  /**
   * Enter animations; skipped under `prefers-reduced-motion`.
   * @default true
   */
  readonly animate?: boolean;
  /** Controlled hovered bin: `null` is "nothing hovered", absent leaves the hover to the chart. */
  readonly hoveredIndex?: number | null;
  /** Called with the hovered bin (pointer or keyboard), and `null` when the hover leaves. */
  readonly onHoverChange?: (index: number | null) => void;
  /**
   * Maximum chart width in px.
   * @default 640
   */
  readonly maxWidth?: number;
  /** Class names on the chart's outer element. */
  readonly className?: string;
  /**
   * Accessible name of the chart.
   * @default "Radial chart"
   */
  readonly ariaLabel?: string;
  /** Longer accessible description of the chart. */
  readonly ariaDescription?: string;
  /**
   * The chart's layers (`RadialAxis`, `RadialDotBar`, `RadialBar`, `RadialRingBar`, `RadialLine`, `RadialArea`, `RadialScrubber`), drawn in
   * a group centred on the chart in the order given; `RadialCenter` draws as HTML in the hole and `RadialLegend` below the chart.
   */
  readonly children?: Node;
}

/** How angle labels sit on the circle: upright and centred, along the radius (flipped on the left half), or along the circle (flipped on the bottom half). */
export type RadialLabelOrientation = "horizontal" | "radial" | "tangential";

/** Props of `RadialAxis`. */
export interface RadialAxisProps {
  /**
   * Centre circle with a thin stroke.
   * @default true
   */
  readonly showCircle?: boolean;
  /**
   * Faint radial-gradient fill inside the centre circle.
   * @default false
   */
  readonly centerGradient?: boolean;
  /**
   * Tick marks just outside the centre circle.
   * @default 24 for clock charts, else 0
   */
  readonly tickCount?: number;
  /**
   * Every n-th tick is long.
   * @default 6 (00 / 06 / 12 / 18)
   */
  readonly majorTickEvery?: number;
  /** Labels spaced evenly along the arc from the start angle, or `false` to hide them. Defaults to 00 / 06 / 12 / 18 (clock), every category (band), time ticks (time) or value ticks (angular). */
  readonly labels?: readonly string[] | false;
  /**
   * Label colour.
   * @default "var(--muted-foreground)"
   */
  readonly labelColor?: string;
  /**
   * Circle, tick and grid colour.
   * @default "var(--foreground)"
   */
  readonly stroke?: string;
  /**
   * Label orientation.
   * @default "radial" for band charts, else "horizontal"
   */
  readonly labelOrientation?: RadialLabelOrientation;
  /** Label radius as a fraction of the chart radius. Defaults to `layout.axisLabel` (rotated band labels start just outside the band). */
  readonly labelRadius?: number;
  /**
   * Band charts: label every n-th category.
   * @default 1
   */
  readonly labelEvery?: number;
  /** Band charts: formats `datum[xDataKey]`. Defaults to `String(value)`. */
  readonly labelFormat?: (value: unknown, index: number) => string;
  /**
   * Time charts: a tick count hint, or explicit tick times.
   * @default 12
   */
  readonly timeTicks?: number | readonly (Date | number)[];
  /** Time charts: the tick label format. Defaults to the short month (UTC) for spans over 60 days. */
  readonly timeTickFormat?: (date: Date) => string;
  /**
   * Time charts: the label at the tick, or centred between ticks (month names in the middle of their month).
   * @default "between"
   */
  readonly timeLabelPosition?: "tick" | "between";
  /**
   * Spokes across the value band at every angle tick (time ticks, or value ticks on angular charts).
   * @default true for time and angular charts
   */
  readonly angleGrid?: boolean;
  /** Value grid: a tick count hint or explicit values. Radial charts draw a ring (an arc on partial charts) per value; angular charts use them as the angle ticks. Defaults to none on radial charts and 5 on angular charts. */
  readonly valueTicks?: number | readonly number[];
  /** Value tick label format. Defaults to an en-US number. */
  readonly valueTickFormat?: (value: number) => string;
  /**
   * Show value tick labels.
   * @default true
   */
  readonly showValueLabels?: boolean;
  /** Radial charts: the angle (degrees) the value labels sit at. Defaults to the start angle. */
  readonly valueLabelAngle?: number;
  /**
   * Angular charts: category labels at the start of each ring.
   * @default true
   */
  readonly showRingLabels?: boolean;
  /**
   * Grid ring and spoke opacity.
   * @default 0.12
   */
  readonly gridOpacity?: number;
}

/** Props of `RadialBar`. */
export interface RadialBarProps {
  /** Datum key of a comparison value (yesterday's total, say), drawn as a dim "ghost" bar in bins where no series has a value. */
  readonly ghostDataKey?: string;
  /**
   * Ghost bar colour.
   * @default "var(--foreground)"
   */
  readonly ghostColor?: string;
  /**
   * Ghost bar opacity.
   * @default 0.12
   */
  readonly ghostOpacity?: number;
  /** Value mapped to the band top. Defaults to the chart's shared scale when `RadialChart` has `maxValue`, else the largest stack or ghost value. */
  readonly maxValue?: number;
  /** Angular gap between neighbouring bars in radians, held at a constant width from the band base outward. Defaults to 18% of one bin's angle. */
  readonly padAngle?: number;
  /**
   * Corner radius in px.
   * @default 0
   */
  readonly cornerRadius?: number;
  /**
   * Radial gap in px between stacked segments. 0 draws each bin as one solid column whose outline carries `cornerRadius`; above 0 every segment is rounded on its own.
   * @default 0
   */
  readonly stackGap?: number;
  /**
   * Fraction of the band over which `rampFrom` series reach full opacity.
   * @default 0.6
   */
  readonly rampExtent?: number;
  /**
   * Opacity of the other bins while a bin is hovered.
   * @default 0.35
   */
  readonly fadedOpacity?: number;
  /**
   * Opacity of the other series while a legend item is hovered.
   * @default 0.2
   */
  readonly seriesFadedOpacity?: number;
}

/** Props of `RadialRingBar`. */
export interface RadialRingBarProps {
  /** Value mapped to the arc end. Defaults to the chart's value domain (`RadialChart maxValue`, else the largest per-ring stack). */
  readonly maxValue?: number;
  /**
   * Corner radius in px, or `"round"` for fully rounded ends.
   * @default 0
   */
  readonly cornerRadius?: number | "round";
  /**
   * Gap between stacked segments in px, constant across the ring's thickness.
   * @default 0
   */
  readonly segmentGap?: number;
  /**
   * A faint full-arc track behind every ring.
   * @default true
   */
  readonly track?: boolean;
  /**
   * Track colour.
   * @default "var(--foreground)"
   */
  readonly trackColor?: string;
  /**
   * Track opacity.
   * @default 0.06
   */
  readonly trackOpacity?: number;
  /**
   * Opacity of the other rings while a ring is hovered.
   * @default 0.35
   */
  readonly fadedOpacity?: number;
  /**
   * Opacity of the other series while a legend item is hovered.
   * @default 0.2
   */
  readonly seriesFadedOpacity?: number;
}

/** Placement of a `RadialDotBar`'s dots: an even density (outer rows hold more dots), or one dot per bin on every row (strict radial columns). */
export type RadialDotLayout = "grid" | "columns";

/** A pattern id from bklit-ui's presets (`"diagonal-up"`, `"horizontal"`, `"grid"`, `"dots"`, `"checkerboard"`…), current or legacy. */
export type RadialPatternPresetId =
  | "none"
  | "vertical"
  | "vertical-dense"
  | "horizontal"
  | "horizontal-dense"
  | "diagonal-up"
  | "diagonal-up-sparse"
  | "diagonal-down"
  | "diagonal-down-sparse"
  | "grid"
  | "vertical-dashed"
  | "horizontal-dashed"
  | "horizontal-dashed-dense"
  | "grid-dashed"
  | "grid-dotted"
  | "dots"
  | "dots-sparse"
  | "diagonal-dots-up"
  | "diagonal-dots-up-sparse"
  | "diagonal-dots-down"
  | "diagonal-dots-down-sparse"
  | "circles-dense"
  | "circles"
  | "circles-sparse"
  | "blocks"
  | "checkerboard-xs"
  | "checkerboard-sm"
  | "checkerboard"
  | "checkerboard-lg"
  | "checkerboard-inset"
  | "diagonal"
  | "cross"
  | "accent";

/** A pattern fill for a series' (or the ghost layer's) dots. */
export interface RadialDotPattern {
  /**
   * The pattern preset.
   * @default "diagonal-up"
   */
  readonly preset?: RadialPatternPresetId;
  /** A custom fill instead of a preset (`url(#my-pattern)`); ignores `preset`, `color`, `scale` and `units`. */
  readonly fill?: string;
  /** Stripe or dot colour. Defaults to the series colour. */
  readonly color?: string;
  /**
   * Pattern tile scale (1 is the preset's size).
   * @default 1
   */
  readonly scale?: number;
  /** Stripe stroke width in px. Defaults to the preset's width × `scale`. */
  readonly strokeWidth?: number;
  /** Tile background behind the stripes. Defaults to none (transparent). */
  readonly background?: string;
  /** A ring around each dot so patterned dots read as circles. Defaults to `color`; `"none"` hides it. */
  readonly stroke?: string;
  /**
   * Ring width in px.
   * @default 1
   */
  readonly ringWidth?: number;
  /**
   * `dot` fits the tile to each dot so every dot shows the same, centred stripes; `chart` is one continuous texture seen through the dots.
   * @default "dot"
   */
  readonly units?: "dot" | "chart";
}

/** A callout label outside a `RadialDotBar` bin's tip. */
export interface RadialDotBarAnnotation {
  /** The bin the label points at. */
  readonly index: number;
  readonly label: string;
  /** Text colour. Defaults to the first `emphasize` series' colour, else the colour of the series at the bin's tip. */
  readonly color?: string;
}

/** Props of `RadialDotBar`. */
export interface RadialDotBarProps {
  /** Datum key of a comparison value (yesterday's total, say), drawn as dim "ghost" dots in bins where no series has a value. */
  readonly ghostDataKey?: string;
  /**
   * Ghost dot colour.
   * @default "var(--foreground)"
   */
  readonly ghostColor?: string;
  /**
   * Ghost dot opacity.
   * @default 0.22
   */
  readonly ghostOpacity?: number;
  /** Value mapped to the outermost row. Defaults to the largest stack or ghost value. */
  readonly maxValue?: number;
  /**
   * Concentric rows across the value band.
   * @default 14
   */
  readonly rows?: number;
  /**
   * Dot placement on each row.
   * @default "grid"
   */
  readonly layout?: RadialDotLayout;
  /**
   * Dot diameter as a fraction of the row spacing.
   * @default 0.44
   */
  readonly dotSize?: number;
  /**
   * Ghost dot diameter as a fraction of the row spacing.
   * @default 0.26
   */
  readonly ghostDotSize?: number;
  /**
   * Fraction of the rows over which `rampFrom` series reach full opacity.
   * @default 0.5
   */
  readonly rampExtent?: number;
  /** Callout labels outside a bin's tip. */
  readonly annotations?: readonly RadialDotBarAnnotation[];
  /**
   * Opacity of the other series while a legend item is hovered.
   * @default 0.2
   */
  readonly fadedOpacity?: number;
  /** Pattern fills keyed by series `dataKey` (`"ghost"` for the ghost layer): a preset id or a `RadialDotPattern`. Series without one stay solid. */
  readonly patterns?: Readonly<Record<string, RadialPatternPresetId | RadialDotPattern>>;
}

/** Props of `RadialLine`. */
export interface RadialLineProps {
  /** Datum key plotted by this line. A key matching a `RadialChart` series inherits its colour and opacity and dims with the legend; any other key (`"yesterday"`) draws a comparison line. */
  readonly dataKey: string;
  /** Stroke colour. Defaults to the series colour (else its palette slot), else `var(--foreground)`. */
  readonly stroke?: string;
  /**
   * Stroke width in px.
   * @default 2
   */
  readonly strokeWidth?: number;
  /** Stroke opacity. Defaults to the series opacity, else 1. */
  readonly strokeOpacity?: number;
  /** Dash pattern: `true` for `strokeWidth` dashes with 3× gaps, or any SVG `stroke-dasharray`. Defaults to solid. */
  readonly dash?: boolean | string;
  /** d3 curve. Defaults to `curveCatmullRomClosed` for a closed loop, else `curveCatmullRom`. */
  readonly curve?: CurveFactory;
  /** Join the last bin back to the first. Defaults to true when every bin has a value on a full circle. */
  readonly closed?: boolean;
  /** Value mapped to the band top. Defaults to the chart's shared scale when `RadialChart` has `maxValue`, else the largest value across every series and this line. */
  readonly maxValue?: number;
  /**
   * A point marker on the hovered bin, riding the line.
   * @default true
   */
  readonly showMarkers?: boolean;
  /**
   * How the hover marker follows the pointer: locked to the crosshair, its own spring (`markerSpring`) or snapping to the bin. Reduced motion always snaps.
   * @default "crosshair"
   */
  readonly markerMotion?: RadialDotMotion;
  /**
   * `markerMotion="spring"`: the marker's spring.
   * @default { stiffness: 240, damping: 24 }
   */
  readonly markerSpring?: RadialSpringOptions;
  /** A marker at the line's last value ("now"). Defaults to true for open lines. */
  readonly showNowMarker?: boolean;
  /**
   * A soft pulse around the "now" marker (off under reduced motion).
   * @default true
   */
  readonly pulse?: boolean;
  /** Marker radius in px. Defaults to a size that scales with the chart. */
  readonly markerRadius?: number;
  /**
   * Opacity while another series is hovered in the legend.
   * @default 0.2
   */
  readonly fadedOpacity?: number;
  /**
   * Delay before the clockwise draw starts, in seconds.
   * @default 0
   */
  readonly enterDelay?: number;
}

/** A `RadialArea`'s curve through the bin centres (closed when every bin has a value). */
export type RadialAreaCurve = "catmullRom" | "basis" | "linear";

/** Which edges of a `RadialArea` get a stroke. */
export type RadialAreaStroke = "outer" | "both" | "none";

/** Props of `RadialArea`. */
export interface RadialAreaProps {
  /** Draw a single area for this datum key (a matching series supplies colour, opacity and legend dimming). Omit to draw every chart series. */
  readonly dataKey?: string;
  /** Inner edge of a single area (a min/max band, say). Defaults to the band base (0). */
  readonly baseDataKey?: string;
  /**
   * Series mode: stack the series outward, or overlay them from the base.
   * @default true
   */
  readonly stacked?: boolean;
  /** Fill and stroke colour of a single area. Defaults to the series colour (else its palette slot), else `var(--foreground)`. */
  readonly color?: string;
  /**
   * Draw the fill (`false` gives an outline-only line).
   * @default true
   */
  readonly fill?: boolean;
  /**
   * Fill opacity at the outer edge.
   * @default 0.32
   */
  readonly fillOpacity?: number;
  /** Radial gradient: the fraction of `fillOpacity` at the band base, rising to the full value at the outer radius. Defaults to the series' `rampFrom`, else 0.25. */
  readonly rampFrom?: number;
  /**
   * Which edges get a stroke.
   * @default "outer"
   */
  readonly stroke?: RadialAreaStroke;
  /**
   * Stroke width in px.
   * @default 1.5
   */
  readonly strokeWidth?: number;
  /**
   * Stroke opacity.
   * @default 1
   */
  readonly strokeOpacity?: number;
  /** A dashed edge: `"4 4"`, say. */
  readonly strokeDasharray?: string;
  /**
   * The curve through the bin centres.
   * @default "catmullRom"
   */
  readonly curve?: RadialAreaCurve;
  /** Datum key of a comparison value (yesterday's total, say), drawn as a dim "ghost" area with a dashed edge in bins where no series has a value. */
  readonly ghostDataKey?: string;
  /**
   * Ghost colour.
   * @default "var(--foreground)"
   */
  readonly ghostColor?: string;
  /**
   * Ghost fill opacity (its stroke is 2.5× this).
   * @default 0.1
   */
  readonly ghostOpacity?: number;
  /** Value mapped to the outer radius. Defaults to the chart's shared scale when `RadialChart` has `maxValue`, else the largest drawn value. */
  readonly maxValue?: number;
  /**
   * A dot on the outer edge of the hovered bin, riding the edge.
   * @default true
   */
  readonly activeDot?: boolean;
  /**
   * How the active dot follows the pointer: locked to the crosshair, its own spring (`activeDotSpring`) or snapping to the bin. Reduced motion always snaps.
   * @default "crosshair"
   */
  readonly activeDotMotion?: RadialDotMotion;
  /**
   * `activeDotMotion="spring"`: the dot's spring.
   * @default { stiffness: 240, damping: 24 }
   */
  readonly activeDotSpring?: RadialSpringOptions;
  /**
   * Opacity of the other series while a legend item is hovered.
   * @default 0.2
   */
  readonly fadedOpacity?: number;
}

/** The scrubber line: plain, dashed, or fading in along its length (transparent at the centre circle, full strength at the outer end). */
export type RadialScrubberVariant = "solid" | "dashed" | "gradient";

/** Props of `RadialScrubber`. */
export interface RadialScrubberProps {
  /**
   * Line style.
   * @default "solid"
   */
  readonly variant?: RadialScrubberVariant;
  /**
   * `dashed` variant: the SVG stroke-dasharray.
   * @default "4 4"
   */
  readonly dashArray?: string;
  /** End dot. Defaults to true for solid and dashed lines, false for the gradient. */
  readonly showDot?: boolean;
  /**
   * Line and dot colour.
   * @default "var(--foreground)"
   */
  readonly color?: string;
  /**
   * Line opacity.
   * @default 0.7
   */
  readonly lineOpacity?: number;
  /**
   * Line width.
   * @default 1.5
   */
  readonly strokeWidth?: number;
  /** End dot radius in px. Defaults to a size that scales with the chart. */
  readonly dotRadius?: number;
  /** Where the scrubber rests when nothing is hovered: at "now" (the trailing edge of `nowIndex`) or hidden. Defaults to "now" on charts that track now (clock charts), else "hidden". */
  readonly rest?: "now" | "hidden";
  /**
   * The spring toward the hovered bin; hover dots locked to the crosshair follow it too.
   * @default { stiffness: 420, damping: 42 }
   */
  readonly spring?: RadialSpringOptions;
}

/** What `RadialCenter`'s render function is called with. */
export interface RadialCenterState {
  /** The hovered bin, or `null` at rest. */
  readonly index: number | null;
  /** The hovered datum, or `null` at rest. */
  readonly datum: Record<string, unknown> | null;
  /** The hovered bin's x label ("09:15"), or `null` at rest. */
  readonly label: string | null;
  /** True when the hovered bin has no series values (a future or ghost bin). */
  readonly isFuture: boolean;
  /** Per-series totals over every non-future bin. */
  readonly totals: Readonly<Record<string, number>>;
  /** Per-series values of the hovered bin (0 when missing, and at rest). */
  readonly values: Readonly<Record<string, number>>;
}

/** Props of `RadialCenter`. */
export interface RadialCenterProps<Node> {
  /**
   * The label under the value at rest.
   * @default "Total"
   */
  readonly defaultLabel?: string;
  /** Number format of the value. */
  readonly formatOptions?: ChartStatFlowFormat;
  readonly prefix?: string;
  readonly suffix?: string;
  /** Class names on the centre's content box. */
  readonly className?: string;
  /** Class names of the value. */
  readonly valueClassName?: string;
  /** Class names of the label. */
  readonly labelClassName?: string;
  /** Full control over the centre content (at rest and while hovering): a function of the `RadialCenterState`. */
  readonly children?: Node;
}

/** Props of `RadialLegend`. */
export interface RadialLegendProps {
  /** Class names on the legend row. */
  readonly className?: string;
  /** Formats the per-series totals. Defaults to an en-US integer. */
  readonly formatValue?: (value: number) => string;
  /**
   * Show each series' total after its label; turn it off where totals are meaningless (temperatures, say).
   * @default true
   */
  readonly showValues?: boolean;
}
