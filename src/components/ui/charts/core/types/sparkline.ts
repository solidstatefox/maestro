export type SparklineCurve = "linear" | "monotone" | "natural" | "step";

/** The field of a row holding its value, or an accessor returning it (`(datum, index) => number`). */
export type SparklineDataKey<T> = keyof T | ((datum: T, index: number) => number);

/** Inner padding of a sparkline, in px. */
export interface SparklinePadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** The hover guide line: dashed, solid, a gradient that fades at both ends, or `false` for none. */
export type SparklineCrosshair = "dashed" | "solid" | "gradient" | false;

/** A spring's stiffness and damping (mass 1). */
export interface SparklineSpringConfig {
  stiffness: number;
  damping: number;
}

/** Props every sparkline takes. */
export interface SparklineBaseProps<T, Style = unknown> {
  /** Rows to plot. */
  readonly data: readonly T[];
  /** Field (or accessor) holding the numeric value. */
  readonly dataKey: SparklineDataKey<T>;
  /** Fixed width in px. Omit to fill the parent width. */
  readonly width?: number;
  /**
   * Height in px.
   * @default 32
   */
  readonly height?: number;
  /**
   * Series colour.
   * @default "var(--chart-line-primary)"
   */
  readonly color?: string;
  /** Inner padding so strokes and the hover dot are not clipped: one number for every side, or some sides. Defaults to 4 (2 for bars). */
  readonly padding?: number | Partial<SparklinePadding>;
  /** Override the value domain; `undefined` entries fall back to the data. */
  readonly yDomain?: readonly [number?, number?];
  /**
   * Play the enter animation on mount. Respects `prefers-reduced-motion`.
   * @default true
   */
  readonly animate?: boolean;
  /**
   * Enter duration in ms.
   * @default 900
   */
  readonly animationDuration?: number;
  /**
   * Any CSS easing string.
   * @default "cubic-bezier(0.85, 0, 0.15, 1)"
   */
  readonly animationEasing?: string;
  /**
   * Morph to new data instead of snapping, in ms. `0` snaps. Requires `animate`; snaps under `prefers-reduced-motion`.
   * @default 500
   */
  readonly dataTransitionDuration?: number;
  /**
   * Hover guide line. Set `false` to hide.
   * @default "dashed"
   */
  readonly crosshair?: SparklineCrosshair;
  /**
   * Show a dot on the hovered point.
   * @default true
   */
  readonly dot?: boolean;
  /**
   * Spring the crosshair and dot between points, like the main charts' tooltip. Snaps under `prefers-reduced-motion`.
   * @default true
   */
  readonly hoverTransition?: boolean;
  /**
   * Hover spring for the crosshair and dot. Defaults to the main charts' tooltip spring (300 / 30); pass only what you want to change,
   * e.g. `{ damping: 40 }`. Higher stiffness = snappier; lower damping = bouncier.
   */
  readonly springConfig?: Partial<SparklineSpringConfig>;
  /**
   * Track the pointer and the keyboard (←/→, Home/End, Esc) to show the hovered point. `false`: no hover state, no listeners, no tab stop.
   * @default true
   */
  readonly interactive?: boolean;
  /** Controlled hovered index. Pass `null` for "not hovering". */
  readonly hoverIndex?: number | null;
  /** Called when the hovered point changes (pointer or keyboard), with its index and row, or `null` and `null` on leave. */
  readonly onHoverChange?: (index: number | null, datum: T | null) => void;
  /** Accessible summary. Generated from the data when omitted. */
  readonly "aria-label"?: string;
  /** Accessible summary (the kit's other charts' name for `aria-label`). */
  readonly ariaLabel?: string;
  /** Extra class name for the sparkline's element. */
  readonly className?: string;
  /** Inline style for the sparkline's element. */
  readonly style?: Style;
}

/** Props for `LineSparkline`. */
export interface LineSparklineProps<T, Style = unknown> extends SparklineBaseProps<T, Style> {
  /**
   * How the points are joined.
   * @default "monotone"
   */
  readonly curve?: SparklineCurve;
  /**
   * Line width in px.
   * @default 1.5
   */
  readonly strokeWidth?: number;
  /**
   * Keep a dot on the last point when not hovering.
   * @default false
   */
  readonly endDot?: boolean;
  /**
   * On hover, fade the series and re-stroke the segment around the hovered point at full strength: the main charts' highlight.
   * @default true
   */
  readonly showHighlight?: boolean;
  /**
   * Series opacity while hovering (with `showHighlight`).
   * @default 0.5
   */
  readonly inactiveOpacity?: number;
}

/** Props for `AreaSparkline`. */
export interface AreaSparklineProps<T, Style = unknown> extends LineSparklineProps<T, Style> {
  /**
   * Fill style: a gradient fading to the baseline, or one flat colour.
   * @default "gradient"
   */
  readonly fill?: "gradient" | "solid";
  /**
   * Opacity of the fill at its strongest point.
   * @default 0.3
   */
  readonly fillOpacity?: number;
}

/** Props for `BarSparkline`. Bars always include zero and support negative values. */
export interface BarSparklineProps<T, Style = unknown> extends SparklineBaseProps<T, Style> {
  /**
   * Gap between bars in px.
   * @default 2
   */
  readonly barGap?: number;
  /**
   * Corner radius away from the baseline, in px.
   * @default 1
   */
  readonly barRadius?: number;
  /**
   * Opacity of the other bars while hovering.
   * @default 0.4
   */
  readonly inactiveOpacity?: number;
}

/** Every prop any sparkline takes: what an adapter hands the controller (`core/sparkline/controller.ts`). */
export type AnySparklineProps<T = unknown> = Omit<AreaSparklineProps<T>, "style" | "className"> &
  Omit<BarSparklineProps<T>, "style" | "className">;
