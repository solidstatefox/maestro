import { getHeatmapContributionLevel } from "./contribution-level";
import type { PatternPresetId, PatternPresetOptions } from "../pattern/pattern-preset-helpers";

const HEATMAP_LEVEL_CSS_VARS = [
  "var(--chart-scale-01)",
  "var(--chart-scale-02)",
  "var(--chart-scale-03)",
  "var(--chart-scale-04)",
  "var(--chart-scale-05)",
] as const;

/** The five level colors of the scale, from empty (index 0) to the highest activity level (index 4). */
type HeatmapLevelColors = readonly [string, string, string, string, string];

/** Default level colors: the `--chart-scale-01` to `--chart-scale-05` CSS variables. */
const HEATMAP_DEFAULT_LEVEL_COLORS = HEATMAP_LEVEL_CSS_VARS;

/** How a level is filled: a flat `"solid"` color or a `"pattern"` preset. */
type HeatmapLevelFillMode = "solid" | "pattern";

/** Fill style of one level: a color and an optional pattern. */
interface HeatmapLevelStyle {
  /** Base color of the level. Used for the cell when `fillMode` is `"solid"` and as the tile background of a pattern. */
  readonly color: string;
  /**
   * `"solid"` fills with `color`; `"pattern"` fills with the preset named by `pattern`.
   * @default "solid"
   */
  readonly fillMode?: HeatmapLevelFillMode;
  /**
   * Pattern preset used when `fillMode` is `"pattern"`: `"none"`, `"diagonal"`, `"horizontal"`, `"vertical"`, `"cross"`, `"dots"`, `"circles"` or `"accent"`.
   * @default "diagonal" when `fillMode` is `"pattern"`
   */
  readonly pattern?: PatternPresetId;
  /** Color of the pattern strokes or dots. Derived from `color` when omitted. */
  readonly patternColor?: string;
  /**
   * Scale of the pattern tile.
   * @default 1 (1.33 for "cross")
   */
  readonly patternScale?: number;
  /** Stroke width of the pattern, in pixels. The preset decides when omitted. */
  readonly patternStrokeWidth?: number;
  /** Radius of the dots or circles of the pattern. The preset decides when omitted. */
  readonly patternRadius?: number;
  /** Adds the complementary stripes or shapes to the pattern. The preset decides when omitted. */
  readonly patternComplement?: boolean;
  /** Fill color of the pattern shapes. The preset decides when omitted. */
  readonly patternFill?: string;
  /**
   * Background color of the pattern tile.
   * @default the level `color`
   */
  readonly patternTileBackground?: string;
  /**
   * Opacity of the pattern fill (0 to 1).
   * @default 1
   */
  readonly patternOpacity?: number;
  /** Fills the dots of the pattern instead of outlining them. The preset decides when omitted. */
  readonly patternDotsFill?: boolean;
}

/** Styles for the five levels, from empty (index 0) to the highest activity level (index 4). */
type HeatmapLevelStyles = readonly [
  HeatmapLevelStyle,
  HeatmapLevelStyle,
  HeatmapLevelStyle,
  HeatmapLevelStyle,
  HeatmapLevelStyle,
];

/** Default level styles: solid fills using `HEATMAP_DEFAULT_LEVEL_COLORS`. */
const HEATMAP_DEFAULT_LEVEL_STYLES = /* @__PURE__ */ (() => [
  { color: HEATMAP_DEFAULT_LEVEL_COLORS[0], fillMode: "solid", pattern: "none" },
  { color: HEATMAP_DEFAULT_LEVEL_COLORS[1], fillMode: "solid", pattern: "none" },
  { color: HEATMAP_DEFAULT_LEVEL_COLORS[2], fillMode: "solid", pattern: "none" },
  { color: HEATMAP_DEFAULT_LEVEL_COLORS[3], fillMode: "solid", pattern: "none" },
  { color: HEATMAP_DEFAULT_LEVEL_COLORS[4], fillMode: "solid", pattern: "none" },
] as const satisfies HeatmapLevelStyles)();

/** @internal */
const heatmapLevelPatternId = (level: number): string => `heatmap-level-${level}`;

// Default pattern tile scale for the "cross" preset, whose two-axis weave reads too dense at scale 1.
const CROSS_PATTERN_DEFAULT_SCALE = 1.33;

/** @internal */
const isHeatmapLevelPattern = (style: Readonly<HeatmapLevelStyle>): boolean => style.fillMode === "pattern" && style.pattern !== undefined && style.pattern !== "none";

const heatmapPatternStrokeFallback = (color: string): string => `color-mix(in oklch, ${color} 45%, white)`;

const heatmapLevelPatternRenderOptions = (style: Readonly<HeatmapLevelStyle>): PatternPresetOptions => {
  const preset = style.pattern ?? "diagonal";
  let defaultScale = 1;
  if (preset === "cross") {
    defaultScale = CROSS_PATTERN_DEFAULT_SCALE;
  }
  const patternColorTrimmed = style.patternColor?.trim() ?? "";
  const patternFillTrimmed = style.patternFill?.trim() ?? "";
  const patternTileBackgroundTrimmed = style.patternTileBackground?.trim() ?? "";
  const fallbackColor = preset === "accent" ? "var(--chart-1)" : heatmapPatternStrokeFallback(style.color);

  return {
    color: patternColorTrimmed === "" ? fallbackColor : patternColorTrimmed,
    complement: style.patternComplement,
    dotFill: style.patternDotsFill,
    fill: patternFillTrimmed === "" ? undefined : patternFillTrimmed,
    radius: style.patternRadius,
    scale: style.patternScale ?? defaultScale,
    strokeWidth: style.patternStrokeWidth,
    tileBackground: patternTileBackgroundTrimmed === "" ? style.color : patternTileBackgroundTrimmed,
  };
}

const heatmapLevelCellFillOpacity = (style: Readonly<HeatmapLevelStyle>): number => {
  if (!isHeatmapLevelPattern(style)) {
    return 1;
  }
  return style.patternOpacity ?? 1;
}

/** @internal */
const levelStylesFromColors = (levelColors: HeatmapLevelColors): HeatmapLevelStyles => [
    { color: levelColors[0], fillMode: "solid", pattern: "none" },
    { color: levelColors[1], fillMode: "solid", pattern: "none" },
    { color: levelColors[2], fillMode: "solid", pattern: "none" },
    { color: levelColors[3], fillMode: "solid", pattern: "none" },
    { color: levelColors[4], fillMode: "solid", pattern: "none" },
  ];

/** @internal */
const resolveHeatmapLevelStyles = (levelColors: HeatmapLevelColors | undefined, levelStyles: HeatmapLevelStyles | undefined): HeatmapLevelStyles => {
  if (levelStyles) {return levelStyles;}
  if (levelColors) {return levelStylesFromColors(levelColors);}
  return HEATMAP_DEFAULT_LEVEL_STYLES;
}

/** @internal */
const buildHeatmapColorScaleFromStyles = (levelStyles: HeatmapLevelStyles): (count: number | null | undefined) => string => (count: number | null | undefined) => {
    const level = getHeatmapContributionLevel(count ?? 0);
    return levelStyles[level]?.color ?? levelStyles[0].color;
  };

/** @internal */
const buildHeatmapColorScale = (levelColors: HeatmapLevelColors): (count: number | null | undefined) => string => buildHeatmapColorScaleFromStyles(levelStylesFromColors(levelColors));

/** @internal */
const buildHeatmapFillScale = (levelStyles: HeatmapLevelStyles): (count: number | null | undefined) => string =>
  // The matching <pattern> defs are rendered by HeatmapPatternDefs, so this url() reference is always backed.
  (count: number | null | undefined) => {
    const level = getHeatmapContributionLevel(count ?? 0);
    const style = levelStyles[level] ?? levelStyles[0];
    if (isHeatmapLevelPattern(style)) {
      return `url(#${heatmapLevelPatternId(level)})`;
    }
    return style.color;
  };

/** @internal */
const defaultHeatmapColorScale = /* @__PURE__ */ buildHeatmapColorScaleFromStyles(HEATMAP_DEFAULT_LEVEL_STYLES);
/** @internal */
const defaultHeatmapFillScale = /* @__PURE__ */ buildHeatmapFillScale(HEATMAP_DEFAULT_LEVEL_STYLES);

export type {
  HeatmapLevelColors,
  HeatmapLevelFillMode,
  HeatmapLevelStyle,
  HeatmapLevelStyles,
};
export {
  buildHeatmapColorScale,
  buildHeatmapColorScaleFromStyles,
  buildHeatmapFillScale,
  defaultHeatmapColorScale,
  defaultHeatmapFillScale,
  HEATMAP_DEFAULT_LEVEL_COLORS,
  HEATMAP_DEFAULT_LEVEL_STYLES,
  heatmapLevelCellFillOpacity,
  heatmapLevelPatternId,
  heatmapLevelPatternRenderOptions,
  isHeatmapLevelPattern,
  levelStylesFromColors,
  resolveHeatmapLevelStyles,
};
