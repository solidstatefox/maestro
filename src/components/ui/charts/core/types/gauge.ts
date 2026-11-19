import type { GaugeEnterTransition } from "../gauge/transition";

/** Arc track drawing: discrete notches, one rounded stroke, or nothing. */
export type GaugeArcStyle = "notches" | "solid" | "none";

/** Where a ruler sits: inside the track (default) or ringing it. */
export type GaugeRulerPosition = "inside" | "outside";

/** Numeric labels beside a ruler's ticks. */
export interface GaugeRulerLabelOptions {
  /** `"majors"` labels every major tick; `"ends"` only the first and last. */
  show?: "majors" | "ends";
  /** Domain the labels count across. Default 0 → 100. */
  min?: number;
  max?: number;
  format?: (value: number) => string;
  /** Default `var(--foreground)` at 72% opacity. */
  color?: string;
}

/** A scale of ticks inside or outside the track (arc gauges only). */
export interface GaugeRulerOptions {
  /** `inside` (default) sits within the track; `outside` rings it. */
  position?: GaugeRulerPosition;
  /** Number of intervals along the sweep (ticks = intervals + 1). Default 50. */
  ticks?: number;
  /** Every Nth tick is a major tick. Default 5. */
  majorEvery?: number;
  /** Tick colour. Default `var(--foreground)`. */
  color?: string;
  /** Major tick length as a fraction of gauge size. Default 0.05. */
  majorLength?: number;
  /** Minor tick length as a fraction of gauge size. Default 0.028. */
  minorLength?: number;
  /** Gap between track and ruler as a fraction of gauge size. Default 0.028. */
  gap?: number;
  /** Brighten ticks up to the current value. Default true. */
  highlightActive?: boolean;
  /** Numeric labels beside the major ticks. */
  labels?: boolean | "majors" | "ends" | GaugeRulerLabelOptions;
}

/** `line`: a solid rounded stroke · `gradient`: a stroke that fades in toward the tip · `triangle`: a slim acute triangle · `polygon`: a slender diamond. */
export type GaugeNeedleVariant = "line" | "gradient" | "triangle" | "polygon";

/** A pointer that sweeps to the value (arc gauges only). */
export interface GaugeNeedleOptions {
  /** Default `gradient`. */
  variant?: GaugeNeedleVariant;
  /** Default `var(--foreground)`. */
  color?: string;
  /** Stroke width (line / gradient) or base width (triangle / polygon) in px. Default 2.5 / 4 / 10 / 8. */
  width?: number;
  /** Needle length as a fraction of its reach (centre → tip). `1` runs from the pivot; shorter values float the needle clear of the centre label. Default 0.55. */
  length?: number;
  /** Draw a pivot cap at the centre (best with `length` near 1). */
  pivot?: boolean;
  /** Where the tip lands: just inside the track (`inner`, default), the track's outer edge (`outer`), or past the outermost layer (`edge`). */
  tip?: "inner" | "outer" | "edge";
}

/** A coloured range on the 0–100 scale (arc gauges only). */
export interface GaugeZone {
  /** Start of the zone, 0–100. */
  from: number;
  /** End of the zone, 0–100. */
  to: number;
  color: string;
}

/** `band`: a thin arc ringing the track · `fill`: the fill takes the zone colour where it overlaps · `both`. */
export type GaugeZoneDisplay = "band" | "fill" | "both";

/** A filled wedge from the start angle to the value (arc gauges only). */
export interface GaugeSectorOptions {
  /** `conic`: brightens toward the leading edge · `radial`: brightens toward the rim · `none`: flat `color` (a `url(#pattern)` works). Default `conic`. */
  gradient?: "conic" | "radial" | "none";
  /** Default `var(--chart-1)`. */
  color?: string;
  /** Peak opacity. Default 0.85. */
  opacity?: number;
  /** Inner radius as a fraction of the sector's outer radius. Default 0. */
  innerRadius?: number;
}

/** A thin value ring around the track (arc gauges only). */
export interface GaugeProgressRingOptions {
  /** Default `var(--chart-1)`. */
  color?: string;
  /** Remainder colour. Default `var(--muted-foreground)`. */
  trackColor?: string;
  /** Remainder opacity. Default 0.35. */
  trackOpacity?: number;
  /** Stroke width as a fraction of size. Default 0.01. */
  width?: number;
  /** Gap from the track as a fraction of size. Default 0.022. */
  gap?: number;
}

/** Concentric rings of dots that light up to the value (arc gauges only). */
export interface GaugeDotsOptions {
  /** Concentric rings of dots. Default 5. */
  rings?: number;
  /** Distance between dots (and rings) as a fraction of size. Default 0.03. */
  spacing?: number;
  /** Dot radius in px. Default 1.6. */
  radius?: number;
  /** Default `var(--chart-1)`. */
  color?: string;
  /** Opacity of dots past the value. Default 0.12. */
  dimOpacity?: number;
  /** Opacity of dots up to the value. Default 0.9. */
  litOpacity?: number;
  /** Fade rings toward the centre. Default true. */
  fadeInward?: boolean;
}

/** A soft bloom on the fill: lit notches, the solid arc and the progress ring (arc gauges only). */
export interface GaugeGlowOptions {
  /** Blur radius in px. Default 6. */
  blur?: number;
  /** Glow strength 0–1. Default 0.8. */
  intensity?: number;
}

/** A ringed disc behind the centre label (arc gauges only). */
export interface GaugeCenterDiscOptions {
  /** Radius as a fraction of size. Default 0.19. */
  radius?: number;
  /** Default `var(--background)`. */
  fill?: string;
  /** Default `var(--foreground)`. */
  stroke?: string;
  /** Default 0.75. */
  strokeOpacity?: number;
  /** Ring width in px. Default 3. */
  strokeWidth?: number;
}

/** Side of a linear gauge's track where the label sits. */
export type GaugeLabelPlacement = "top" | "bottom" | "left" | "right";

/** Alignment of a linear gauge's label across the track. */
export type GaugeLabelAlign = "start" | "center" | "end";

/** Number formatting options for a gauge's centre value, a subset of `Intl.NumberFormat` options. */
export interface GaugeStatFormat {
  /** `"standard"` or `"compact"` (1.2K). */
  notation?: "standard" | "compact";
  /** `"short"` or `"long"` compact form; used with `notation: "compact"`. */
  compactDisplay?: "short" | "long";
  /** Minimum number of fraction digits. */
  minimumFractionDigits?: number;
  /** Maximum number of fraction digits. */
  maximumFractionDigits?: number;
  /** Minimum number of integer digits. */
  minimumIntegerDigits?: number;
  /** Minimum number of significant digits. */
  minimumSignificantDigits?: number;
  /** Maximum number of significant digits. */
  maximumSignificantDigits?: number;
  /** `"decimal"`, `"percent"` or `"currency"`. */
  style?: "decimal" | "percent" | "currency";
  /** ISO 4217 currency code, for example `"USD"`; used with `style: "currency"`. */
  currency?: string;
  /** How the currency is shown: symbol, code, name and so on. */
  currencyDisplay?: Intl.NumberFormatOptions["currencyDisplay"];
  /** Unit identifier, for example `"kilometer"`. */
  unit?: string;
  /** `"short"`, `"long"` or `"narrow"` unit form. */
  unitDisplay?: "short" | "long" | "narrow";
}

/** Gauge layout: `"arc"` around an arc, `"linear"` along a horizontal track. */
export type GaugeOrientation = "arc" | "linear";

/** Props for `Gauge`. */
export interface GaugeProps<Node> {
  /**
   * `"arc"` draws the notches around an arc; `"linear"` lays them out along a horizontal track.
   * @default "arc"
   */
  orientation?: GaugeOrientation;
  /** Fill level from 0 to 100: the share of notches drawn in the active colour. */
  value: number;
  /**
   * Number of notches.
   * @default 40
   */
  totalNotches?: number;
  /**
   * Share of the track, in percent, reserved for the gaps between notches.
   * @default 25
   */
  spacing?: number;
  /**
   * Radius in pixels used to round the corners of each notch. `0` keeps them sharp; large values are limited by the notch size and approach a capsule shape.
   * @default 0
   */
  notchCornerRadius?: number;
  /**
   * `true` draws notches with parallel sides; `false` tapers them toward the centre (arc) or midline (linear). Defaults to `false` for arc gauges and `true` for linear gauges.
   */
  uniformWidth?: boolean;
  /**
   * Angle where the arc starts, in degrees. Arc gauges only.
   * @default 135
   */
  startAngle?: number;
  /**
   * Angle where the arc ends, in degrees. Arc gauges only.
   * @default 405
   */
  endAngle?: number;
  /**
   * Colour the notches along a gradient instead of one solid colour.
   * @default false
   */
  useGradient?: boolean;
  /**
   * `[from, to]` colours for the active notches, interpolated along the notch index. Used when `useGradient` is on; defaults to `--chart-1` to `--chart-5`.
   */
  activeGradient?: readonly [string, string];
  /** `[from, to]` colours for the inactive notches. Used when `useGradient` is on; defaults to `activeGradient`. */
  inactiveGradient?: readonly [string, string];
  /**
   * Number shown in the label, which is drawn only when this is set. It is independent of `value`, so it can show a related figure such as revenue.
   */
  centerValue?: number;
  /**
   * Caption shown under (arc) or next to (linear) the `centerValue`.
   * @default "Total"
   */
  defaultLabel?: string;
  /** Text shown before the `centerValue`, for example `"$"`. */
  prefix?: string;
  /** Text shown after the `centerValue`, for example `"%"`. */
  suffix?: string;
  /**
   * Number format for the `centerValue`, in `Intl.NumberFormat` terms (notation, currency, fraction digits and so on).
   * @default { maximumFractionDigits: 0, notation: "standard" }
   */
  formatOptions?: GaugeStatFormat;
  /**
   * Where the label sits relative to a linear track. Arc gauges always draw the label in the centre.
   * @default "top"
   */
  labelPlacement?: GaugeLabelPlacement;
  /**
   * Alignment of the label across the linear track: `"start"`, `"center"` or `"end"`.
   * @default "start"
   */
  labelAlign?: GaugeLabelAlign;
  /** Colour of the inactive notches. Defaults to the `--border` colour. */
  inactiveFill?: string;
  /** Colour of the active notches. Takes precedence over the gradient options. Defaults to `--chart-1`. */
  activeFill?: string;
  /**
   * Fill opacity of the inactive notches, from 0 to 1.
   * @default 0.8
   */
  inactiveFillOpacity?: number;
  /**
   * Fill opacity of the active notches, from 0 to 1.
   * @default 1
   */
  activeFillOpacity?: number;
  /**
   * SVG definitions (a pattern tile such as `PatternLines`) the gauge renders in a hidden `<defs>`, so `activeFill`, `inactiveFill` or a sector's
   * `color` can paint with `url(#id)`. Their `id`s are the page's: give each gauge its own.
   */
  children?: Node;
  /** Extra class name for the root element. */
  className?: string;
  /**
   * Fixed width in pixels. Omit to fill the parent. An arc gauge is fixed-size only when both `width` and `height` are set.
   */
  width?: number;
  /**
   * Fixed height in pixels. For a linear gauge this is the track thickness; when omitted the thickness is `linearHeight`.
   */
  height?: number;
  /**
   * Minimum width in pixels when the gauge fills its parent.
   * @default 300 for arc gauges, 200 for linear gauges
   */
  minWidth?: number;
  /**
   * Length of the notches as a percentage of their full length, clamped to 5 to 100.
   * @default 100
   */
  notchLengthPercent?: number;
  /**
   * Width of each notch as a percentage of its slot, along the track. Linear gauges only.
   * @default 80
   */
  notchWidthPercent?: number;
  /**
   * Track thickness in pixels when `height` is not set. Linear gauges only.
   * @default 24
   */
  linearHeight?: number;
  /**
   * Arc only: the scale ticks inside (or outside) the notches, brightening up to the value. `true` for the defaults, or options.
   */
  ruler?: boolean | GaugeRulerOptions;
  /**
   * Arc only: a pointer that sweeps to the value. `true` (the gradient needle), a variant name, or options.
   */
  needle?: boolean | GaugeNeedleVariant | GaugeNeedleOptions;
  /**
   * Arc only: `notches`, one rounded `solid` stroke, or `none` (a sector, ring or dots carry the value).
   * @default "notches"
   */
  arcStyle?: GaugeArcStyle;
  /**
   * Arc only: the solid stroke's thickness as a fraction of the gauge size.
   * @default 0.035
   */
  arcThickness?: number;
  /** Arc only: coloured ranges on the 0–100 scale, such as a red zone; later zones win where they overlap. */
  zones?: readonly GaugeZone[];
  /**
   * How `zones` render: a thin `band` ringing the track, the `fill` taking the zone colour, or `both`.
   * @default "band"
   */
  zoneDisplay?: GaugeZoneDisplay;
  /** Arc only: a filled wedge from the start to the value (conic, radial, flat or pattern). */
  sector?: boolean | GaugeSectorOptions;
  /** Arc only: a thin value ring around the track. */
  progressRing?: boolean | GaugeProgressRingOptions;
  /** Arc only: concentric rings of dots that light up to the value. */
  dots?: boolean | GaugeDotsOptions;
  /** Arc only: a soft glow on the fill (lit notches, the solid arc, the progress ring). */
  glow?: boolean | GaugeGlowOptions;
  /** Arc only: a ringed disc behind the centre label. */
  centerDisc?: boolean | GaugeCenterDiscOptions;
  /**
   * Transition of the fill's sweep (and of the needle, sector, ring and dots riding it), in the shape used by the `motion` library (`type`,
   * `duration` or `visualDuration` in seconds, `bounce`, `ease`, spring values). Notches light up in order as the sweep passes them; a new
   * `value` sweeps on from wherever the fill is, keeping its speed.
   * @default { type: "spring", visualDuration: 0.9, bounce: 0 }
   */
  enterTransition?: GaugeEnterTransition;
  /**
   * Scales the delay between the track fading in and the fill starting to sweep (limited to 0.25 to 2.5).
   * @default 1
   */
  enterStaggerScale?: number;
  /** Draw at the value at once, with no fade or sweep (bklit's Studio sets it while a geometry control is scrubbed). */
  geometryScrubbing?: boolean;
  /**
   * Accessible name of the gauge.
   * @default "Gauge: <value>%"
   */
  ariaLabel?: string;
  /** Longer accessible description of the gauge, written as the svg's `<desc>`. Defaults to the reading (`"72%"`) when `ariaLabel` is set, so a named gauge still announces its value. */
  ariaDescription?: string;
}
