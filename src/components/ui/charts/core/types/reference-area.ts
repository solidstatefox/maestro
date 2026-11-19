import type { PatternPresetId } from "../pattern/pattern-preset-helpers";

/**
 * What to do with a band that extends past the plot: `"hidden"` clips it, `"visible"` draws it as is, `"discard"` drops it.
 */
export type ReferenceAreaIfOverflow = "hidden" | "visible" | "discard";

/** Edge line style of a `ReferenceArea`: `"solid"` or `"dashed"`. */
export type ReferenceAreaStrokeStyle = "solid" | "dashed";

/** Pixel rectangle of a reference area inside the plot. */
export interface ReferenceAreaRect {
  /** Left edge in plot pixels. */
  x: number;
  /** Top edge in plot pixels. */
  y: number;
  /** Width in px. */
  width: number;
  /** Height in px. */
  height: number;
}

/**
 * Props of `ReferenceArea`: a shaded band over a range of x and/or y data values. Omit a bound to extend the band to that edge of the plot.
 */
export interface ReferenceAreaProps {
  /** Lower y data bound. The band extends to the plot top when omitted. */
  readonly y1?: number;
  /** Upper y data bound. The band extends to the plot bottom when omitted. */
  readonly y2?: number;
  /** Starting x data coordinate. The band extends to the plot left when omitted. */
  readonly x1?: Readonly<Date> | number;
  /** Ending x data coordinate. The band extends to the plot right when omitted. */
  readonly x2?: Readonly<Date> | number;
  /**
   * Id of the y-scale group the y bounds refer to.
   * @default "left"
   */
  readonly yAxisId?: string | number;
  /**
   * Fill color of the band.
   * @default `color-mix(in oklch, var(--chart-foreground-muted) 12%, transparent)`
   */
  readonly fill?: string;
  /**
   * Opacity of the fill.
   * @default 1
   */
  readonly fillOpacity?: number;
  /**
   * Pattern that fills the band instead of the solid `fill`: `"diagonal"`, `"horizontal"`, `"vertical"`, `"cross"`, `"dots"`, `"circles"`, and the other presets.
   * @default "none"
   */
  readonly pattern?: PatternPresetId;
  /**
   * Color of the pattern lines or dots.
   * @default "var(--chart-foreground-muted)"
   */
  readonly patternColor?: string;
  /**
   * Scales the pattern tile. `2` doubles it.
   * @default 1
   */
  readonly patternScale?: number;
  /** Stroke width of the pattern lines, or of the ring around circles. */
  readonly patternStrokeWidth?: number;
  /** Radius of the pattern dots or circles in px. */
  readonly patternRadius?: number;
  /** Also draw circles at the tile corners so the pattern reads as a staggered grid. */
  readonly patternComplement?: boolean;
  /** Fill color of the pattern dots or circles. */
  readonly patternFill?: string;
  /** Fill the pattern dots (`false` draws rings). */
  readonly patternDotFill?: boolean;
  /** Background color painted under each pattern tile. */
  readonly patternTileBackground?: string;
  /**
   * Color of the band's top and bottom edge lines.
   * @default "var(--chart-foreground-muted)"
   */
  readonly stroke?: string;
  /**
   * Edge line width in px.
   * @default 1
   */
  readonly strokeWidth?: number;
  /**
   * `"dashed"` or `"solid"` edge lines.
   * @default "dashed"
   */
  readonly strokeStyle?: ReferenceAreaStrokeStyle;
  /**
   * Dash pattern of the edge lines when `strokeStyle` is `"dashed"`.
   * @default "4,4"
   */
  readonly strokeDasharray?: string;
  /**
   * Fade the fill and edge lines out over the outer 10% of the band at the left and right.
   * @default true
   */
  readonly fadeEdges?: boolean;
  /** Accepted so bklit-ui code compiles. Not applied by this package. The fade zone is fixed at 10%. */
  readonly fadeEdgesLength?: number;
  /** Accepted so bklit-ui code compiles. Not applied by this package. */
  readonly axisLabelColor?: string;
  /**
   * Draw inward triangle markers at the horizontal center of the band's top and bottom edges.
   * @default false
   */
  readonly showMarkers?: boolean;
  /**
   * Color of the center markers.
   * @default "var(--chart-1)"
   */
  readonly markerColor?: string;
  /**
   * Size of the center markers in px.
   * @default 6
   */
  readonly markerSize?: number;
  /** Accepted so bklit-ui code compiles. Not applied by this package. The band is always clipped to the plot. */
  readonly ifOverflow?: ReferenceAreaIfOverflow;
  /** Accepted so bklit-ui code compiles. Not applied by this package. */
  readonly className?: string;
}
