import { patternPresetTree } from "../markup/patterns";
import type { MarkupNode } from "../markup/node";
import { px } from "../style";
import type { StyleObject } from "../style";
import type { HeatmapHoverCoordinator, HeatmapHoverStyleParams } from "../types/heatmap";
import { heatmapLevelPatternId, heatmapLevelPatternRenderOptions, isHeatmapLevelPattern } from "./colors";
import type { HeatmapLevelStyle, HeatmapLevelStyles } from "./colors";
import { HEATMAP_INACTIVE_TRANSITION_CSS } from "./context";
import { getHeatmapContributionLevel } from "./contribution-level";
import { isHeatmapHoverEffectEnabled, resolveHeatmapHoverStyle } from "./hover-style";
import { buildHeatmapLegendGradient } from "./legend-gradient";

const HEATMAP_LEGEND_HIGH_LEVEL = 3;
const HEATMAP_LEGEND_MAX_LEVEL = 4;
/** The five level indexes shown in the legend (0 to 4). */
export const HEATMAP_LEGEND_LEVELS = [0, 1, 2, HEATMAP_LEGEND_HIGH_LEVEL, HEATMAP_LEGEND_MAX_LEVEL] as const;

type LegendAlign = "start" | "center" | "end";
type ColorScale = (count: number | null | undefined) => string;

const resolveLegendJustifyContent = (align: LegendAlign): string => {
  if (align === "start") {
    return "flex-start";
  }
  if (align === "center") {
    return "center";
  }
  return "flex-end";
};

/** The legend's level styles: `levelStyles`, else five solid levels off the color scale. */
export const heatmapLegendLevelStyles = (levelStylesProp: HeatmapLevelStyles | undefined, colorScale: ColorScale): HeatmapLevelStyles =>
  levelStylesProp ?? [
    { color: colorScale(0), fillMode: "solid", pattern: "none" },
    { color: colorScale(1), fillMode: "solid", pattern: "none" },
    { color: colorScale(2), fillMode: "solid", pattern: "none" },
    { color: colorScale(HEATMAP_LEGEND_HIGH_LEVEL), fillMode: "solid", pattern: "none" },
    { color: colorScale(HEATMAP_LEGEND_MAX_LEVEL), fillMode: "solid", pattern: "none" },
  ];

/** The legend level hovered on the coordinator (null without one). */
export const heatmapLegendHoveredLevel = (coordinator: Readonly<HeatmapHoverCoordinator> | null): number | null => coordinator?.getHoveredLegendLevel() ?? null;

/** The hovered cell's level (the level, not the count, so a reader re-renders only when the level changes); null without one. */
export const heatmapLegendTooltipLevel = (coordinator: Readonly<HeatmapHoverCoordinator> | null): number | null => {
  const count = coordinator?.getTooltipData()?.count;
  return count === undefined ? null : getHeatmapContributionLevel(count);
};

interface LegendHighlightArgs {
  readonly hoveredLegendLevel: number | null;
  readonly tooltipLevel: number | null;
  readonly hoverParams: Readonly<HeatmapHoverStyleParams>;
  readonly isInteractive: boolean;
}

export interface HeatmapLegendHighlight {
  readonly highlightedLevel: number | null;
  readonly isDimming: boolean;
}

/** The level the legend highlights (a hovered legend level, else the hovered cell's), and whether the other levels dim. */
export const heatmapLegendHighlight = ({ hoveredLegendLevel, tooltipLevel, hoverParams, isInteractive }: Readonly<LegendHighlightArgs>): HeatmapLegendHighlight => {
  const highlightedLevel = hoveredLegendLevel ?? tooltipLevel;
  const inactiveEnabled = isHeatmapHoverEffectEnabled(hoverParams);
  const isDimming = isInteractive && highlightedLevel !== null && inactiveEnabled;
  return { highlightedLevel, isDimming };
};

export interface HeatmapLegendHandlers {
  readonly onEnter: (level: number) => void;
  readonly onLeave: () => void;
}

// Legend hover publishes its level; the chart dims via host-attribute CSS and clears the renderer's focus (grid-focus.ts), as bklit's legend enter clears cell and tooltip.
// Legacy has no click toggle, so no aria-pressed here.
export const heatmapLegendHandlers = (coordinator: Readonly<HeatmapHoverCoordinator> | null, isInteractive: boolean): HeatmapLegendHandlers => {
  const handleLegendEnter = (level: number): void => {
    if (!isInteractive || !coordinator) {return;}
    coordinator.setHoveredLegendLevel(level);
  };
  const handleLegendLeave = (): void => {
    if (!isInteractive || !coordinator) {return;}
    coordinator.setHoveredLegendLevel(null);
  };
  return { onEnter: handleLegendEnter, onLeave: handleLegendLeave };
};

interface LegendChromeArgs {
  readonly fontSize: number | undefined;
  readonly align: LegendAlign;
  readonly labelClassName: string | undefined;
  readonly className: string | undefined;
}

export interface HeatmapLegendChrome {
  readonly rootClass: string;
  readonly rootStyle: StyleObject;
  readonly labelClass: string;
  /** bklit's legend labels are 12px (the shared class would give 11px); undefined once `fontSize` sets the root's. */
  readonly labelStyle: StyleObject | undefined;
}

const LEGEND_LABEL_STYLE: StyleObject = { "font-size": "12px" };

/** The root's class and style, the labels' class and style. */
export const heatmapLegendChrome = ({ fontSize, align, labelClassName, className }: Readonly<LegendChromeArgs>): HeatmapLegendChrome => ({
  labelClass: labelClassName !== undefined && labelClassName !== "" ? `ts-bkm-heatmap-legend-label ${labelClassName}` : "ts-bkm-heatmap-legend-label",
  labelStyle: fontSize === undefined ? LEGEND_LABEL_STYLE : undefined,
  rootClass: className !== undefined && className !== "" ? `ts-bkm-heatmap-legend ${className}` : "ts-bkm-heatmap-legend",
  rootStyle: { gap: "0.375rem", "justify-content": resolveLegendJustifyContent(align), ...(fontSize === undefined ? {} : { "font-size": px(fontSize) }) },
});

/** The swatch row's style. */
export const heatmapLegendSwatchesStyle = (gap: number): StyleObject => ({ gap: px(gap) });

const transitionOf = (properties: readonly string[]): string => properties.map((property) => `${property} ${HEATMAP_INACTIVE_TRANSITION_CSS}`).join(", ");

interface GradientLayoutArgs {
  readonly levels: readonly number[];
  readonly levelStyles: HeatmapLevelStyles;
  readonly cellSize: number;
  readonly gap: number;
  readonly cornerRadius: number;
  readonly gradientSpan: number;
  readonly highlightedLevel: number | null;
  readonly isDimming: boolean;
  readonly inactiveOpacity: number;
}

export interface HeatmapLegendGradientLayout {
  readonly barWidth: number;
  readonly barHeight: number;
  readonly segmentWidth: number;
  /** The bar's style: the levels' gradient, a pill radius, dimmed while a cell hover dims every level. */
  readonly barStyle: StyleObject;
}

/** The gradient variant's bar: as wide as `gradientSpan` cells and their gaps, one hover segment per level. */
export const heatmapLegendGradientLayout = ({ levels, levelStyles, cellSize, gap, cornerRadius, gradientSpan, highlightedLevel, isDimming, inactiveOpacity }: Readonly<GradientLayoutArgs>): HeatmapLegendGradientLayout => {
  const barWidth = gradientSpan * cellSize + (gradientSpan - 1) * gap;
  const barHeight = cellSize;
  const pillRadius = Math.min(cornerRadius, barHeight / 2);
  const barOpacity = isDimming && highlightedLevel === null ? inactiveOpacity : 1;
  return {
    barHeight,
    barStyle: { background: buildHeatmapLegendGradient(levelStyles), "border-radius": px(pillRadius), opacity: barOpacity, transition: transitionOf(["opacity"]) },
    barWidth,
    segmentWidth: barWidth / levels.length,
  };
};

/** The gradient variant's box. */
export const heatmapLegendGradientBoxStyle = (barWidth: number, barHeight: number): StyleObject => ({ height: px(barHeight), width: px(barWidth) });

interface SegmentStyleArgs {
  readonly barHeight: number;
  readonly index: number;
  readonly segmentWidth: number;
  readonly isHighlighted: boolean;
  readonly isDimming: boolean;
  readonly activeScale: number;
  readonly inactiveOpacity: number;
  readonly inactiveScale: number;
  readonly isInteractive: boolean;
}

/** One level's hover segment over the gradient bar. */
export const heatmapLegendSegmentStyle = (segment: Readonly<SegmentStyleArgs>): StyleObject => {
  const isDimmed = segment.isDimming && !segment.isHighlighted;
  const hoverStyle = resolveHeatmapHoverStyle(segment.isHighlighted, isDimmed, { activeScale: segment.activeScale, inactiveOpacity: segment.inactiveOpacity, inactiveScale: segment.inactiveScale });
  return {
    height: px(segment.barHeight),
    left: px(segment.index * segment.segmentWidth),
    opacity: hoverStyle.opacity,
    transform: `scale(${hoverStyle.scale})`,
    transition: transitionOf(["opacity", "transform"]),
    width: px(segment.segmentWidth),
    ...(segment.isInteractive ? { cursor: "pointer" } : {}),
  };
};

interface SwatchWrapArgs {
  readonly level: number;
  readonly highlightedLevel: number | null;
  readonly isDimming: boolean;
  readonly hoverParams: Readonly<HeatmapHoverStyleParams>;
  readonly isInteractive: boolean;
}

/** A swatch's hover wrapper. */
export const heatmapLegendSwatchWrapStyle = (swatch: Readonly<SwatchWrapArgs>): StyleObject => {
  const isHighlighted = swatch.highlightedLevel === swatch.level;
  const isDimmed = swatch.isDimming && !isHighlighted;
  const hoverStyle = resolveHeatmapHoverStyle(isHighlighted, isDimmed, swatch.hoverParams);
  return {
    opacity: hoverStyle.opacity,
    transform: `scale(${hoverStyle.scale})`,
    transition: transitionOf(["opacity", "transform"]),
    ...(swatch.isInteractive ? { cursor: "pointer" } : {}),
  };
};

// Fallback level when the swatch level has no dedicated style entry.
const FIRST_LEVEL_INDEX = 0;

/** A level's style, the first level's when it has none. */
export const heatmapLegendLevelStyle = (levelStyles: HeatmapLevelStyles, level: number): HeatmapLevelStyle => levelStyles[level] ?? levelStyles[FIRST_LEVEL_INDEX];

// The base level has no pattern to draw, so it renders as a hairline swatch.
const BASE_HEATMAP_LEVEL = 0;

// A pattern without an explicit opacity renders fully opaque.
const FULL_PATTERN_OPACITY = 1;

interface SwatchArgs {
  readonly style: HeatmapLevelStyle;
  readonly level: number;
  readonly cellSize: number;
  readonly cornerRadius: number;
}

/** A solid swatch. */
export const heatmapLegendSolidSwatchStyle = (swatch: Readonly<SwatchArgs>): StyleObject => ({
  "background-color": swatch.style.color,
  "border-radius": px(swatch.cornerRadius),
  "box-sizing": "border-box",
  height: px(swatch.cellSize),
  width: px(swatch.cellSize),
  ...(swatch.level === BASE_HEATMAP_LEVEL ? { border: `1px solid ${swatch.style.color}` } : {}),
});

/** The pattern swatch's svg fills its shell. */
export const HEATMAP_LEGEND_SWATCH_SVG_STYLE: StyleObject = { display: "block", height: "100%", width: "100%" };

export interface HeatmapLegendPatternSwatch {
  readonly shellStyle: StyleObject;
  /** The level's tile, or undefined when its preset draws none. */
  readonly tile: MarkupNode | undefined;
  /** The swatch rect's fill: the tile, else the level's color. */
  readonly fill: string;
}

/** A pattern level's swatch (its tile's id scoped by `idPrefix`, so several legends on a page don't collide); undefined for a solid level. */
export const heatmapLegendPatternSwatch = (swatch: Readonly<SwatchArgs>, idPrefix: string): HeatmapLegendPatternSwatch | undefined => {
  if (!isHeatmapLevelPattern(swatch.style) || !swatch.style.pattern) {return undefined;}
  const patternId = `${idPrefix}-${heatmapLevelPatternId(swatch.level)}`;
  const tile = patternPresetTree(swatch.style.pattern, `${patternId}-base`, heatmapLevelPatternRenderOptions(swatch.style));
  return {
    fill: tile === undefined ? swatch.style.color : `url(#${patternId}-base)`,
    shellStyle: {
      "border-radius": px(swatch.cornerRadius),
      height: px(swatch.cellSize),
      opacity: swatch.style.patternOpacity ?? FULL_PATTERN_OPACITY,
      overflow: "hidden",
      width: px(swatch.cellSize),
    },
    tile,
  };
};
