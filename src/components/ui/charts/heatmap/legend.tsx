"use client";
// The Less to More legend in React: the view over core/heatmap/legend.ts (levels, level styles, highlight, handlers and every style).
import { memo, useMemo, useSyncExternalStore } from 'react';
import type { CSSProperties, NamedExoticComponent, ReactElement } from 'react';
import { useHeatmapCoordinatorOptional } from "./context";
import { HEATMAP_INACTIVE_OPACITY } from "../core/heatmap/context";
import type { HeatmapHoverCoordinator, HeatmapHoverStyleParams, HeatmapLegendProps, HeatmapLegendVariant } from "../core/types/heatmap";
import { defaultHeatmapColorScale } from '../core/heatmap/colors';
import type { HeatmapLevelStyle, HeatmapLevelStyles } from '../core/heatmap/colors';
import {
  HEATMAP_LEGEND_LEVELS,
  HEATMAP_LEGEND_SWATCH_SVG_STYLE,
  heatmapLegendChrome,
  heatmapLegendGradientBoxStyle,
  heatmapLegendGradientLayout,
  heatmapLegendHandlers,
  heatmapLegendHighlight,
  heatmapLegendHoveredLevel,
  heatmapLegendLevelStyle,
  heatmapLegendLevelStyles,
  heatmapLegendPatternSwatch,
  heatmapLegendSegmentStyle,
  heatmapLegendSolidSwatchStyle,
  heatmapLegendSwatchesStyle,
  heatmapLegendSwatchWrapStyle,
  heatmapLegendTooltipLevel,
} from "../core/heatmap/legend";
import type { HeatmapLegendHighlight } from "../core/heatmap/legend";
import { toCamel } from "../core/style";
import { renderMarkup } from "../runtime/markup";
import { useSanitizedId } from "../kit/use-sanitized-id";

const noSubscription = (): () => void => (): void => {
  // No coordinator exists, so there is nothing to unsubscribe.
};

interface LegendHighlightArgs {
  readonly coordinator: Readonly<HeatmapHoverCoordinator> | null;
  readonly hoverParams: Readonly<HeatmapHoverStyleParams>;
  readonly isInteractive: boolean;
}

// Legend hover state from the coordinator; separate hook so HeatmapLegend stays short.
const useLegendHighlight = (highlight: Readonly<LegendHighlightArgs>): HeatmapLegendHighlight => {
  const { coordinator } = highlight;
  const hoveredLegendLevel = useSyncExternalStore(coordinator ? coordinator.subscribe : noSubscription, () => heatmapLegendHoveredLevel(coordinator), () => null);
  // Select the level (not the count) so the legend re-renders only when the hovered level changes.
  const tooltipLevel = useSyncExternalStore(coordinator ? coordinator.subscribe : noSubscription, () => heatmapLegendTooltipLevel(coordinator), () => null);
  return heatmapLegendHighlight({ hoverParams: highlight.hoverParams, hoveredLegendLevel, isInteractive: highlight.isInteractive, tooltipLevel });
};

interface LegendContentArgs {
  readonly variant: HeatmapLegendVariant;
  readonly levelStyles: HeatmapLevelStyles;
  readonly cellSize: number;
  readonly gap: number;
  readonly cornerRadius: number;
  readonly gradientSpan: number;
  readonly highlightedLevel: number | null;
  readonly isDimming: boolean;
  readonly inactiveOpacity: number;
  readonly inactiveScale: number;
  readonly activeScale: number;
  readonly isInteractive: boolean;
  readonly hoverParams: Readonly<HeatmapHoverStyleParams>;
  readonly onEnter: (level: number) => void;
  readonly onLeave: () => void;
  readonly swatchesStyle: CSSProperties;
}

interface HeatmapLegendGradientProps {
  readonly levels: readonly number[];
  readonly levelStyles: HeatmapLevelStyles;
  readonly cellSize: number;
  readonly gap: number;
  readonly cornerRadius: number;
  readonly gradientSpan: number;
  readonly highlightedLevel: number | null;
  readonly isDimming: boolean;
  readonly inactiveOpacity: number;
  readonly inactiveScale: number;
  readonly activeScale: number;
  readonly isInteractive: boolean;
  readonly onEnter: (level: number) => void;
  readonly onLeave: () => void;
}

interface GradientSegmentArgs {
  readonly level: number;
  readonly index: number;
  readonly barHeight: number;
  readonly segmentWidth: number;
  readonly highlightedLevel: number | null;
  readonly isDimming: boolean;
  readonly activeScale: number;
  readonly inactiveOpacity: number;
  readonly inactiveScale: number;
  readonly isInteractive: boolean;
  readonly onEnter: (level: number) => void;
  readonly onLeave: () => void;
}

// Enter-handler factory; module scope so the render path passes no inline closures.
const createGradientEnterHandler = (segment: Readonly<GradientSegmentArgs>): (() => void) => (): void => {
  segment.onEnter(segment.level);
};

// One gradient segment; plain function (not a component) so the element tree is unchanged.
const renderGradientSegment = (segment: Readonly<GradientSegmentArgs>): ReactElement => {
  const { onLeave: handleLeave } = segment;
  const handleEnter = createGradientEnterHandler(segment);
  const segmentStyle = toCamel(heatmapLegendSegmentStyle({
    activeScale: segment.activeScale,
    barHeight: segment.barHeight,
    inactiveOpacity: segment.inactiveOpacity,
    inactiveScale: segment.inactiveScale,
    index: segment.index,
    isDimming: segment.isDimming,
    isHighlighted: segment.highlightedLevel === segment.level,
    isInteractive: segment.isInteractive,
    segmentWidth: segment.segmentWidth,
  }));
  return (
    <span
      key={segment.level}
      className="ts-bkm-heatmap-legend-gradient-segment"
      onPointerEnter={handleEnter}
      onPointerLeave={handleLeave}
      style={segmentStyle}
    />
  );
};

const HeatmapLegendGradient = ({
  levels,
  levelStyles,
  cellSize,
  gap,
  cornerRadius,
  gradientSpan,
  highlightedLevel,
  isDimming,
  inactiveOpacity,
  inactiveScale,
  activeScale,
  isInteractive,
  onEnter,
  onLeave,
}: Readonly<HeatmapLegendGradientProps>): ReactElement => {
  const { barHeight, barStyle, barWidth, segmentWidth } = heatmapLegendGradientLayout({ cellSize, cornerRadius, gap, gradientSpan, highlightedLevel, inactiveOpacity, isDimming, levelStyles, levels });
  const containerStyle = useMemo(() => toCamel(heatmapLegendGradientBoxStyle(barWidth, barHeight)), [barHeight, barWidth]);

  return (
    <div className="ts-bkm-heatmap-legend-gradient" style={containerStyle}>
      <div aria-hidden="true" className="ts-bkm-heatmap-legend-gradient-bar" style={toCamel(barStyle)} />
      {levels.map((level, index) => renderGradientSegment({
        activeScale,
        barHeight,
        highlightedLevel,
        inactiveOpacity,
        inactiveScale,
        index,
        isDimming,
        isInteractive,
        level,
        onEnter,
        onLeave,
        segmentWidth,
      }))}
    </div>
  );
}

// Static svg fill style for the pattern branch; hoisted so it keeps identity.
const SWATCH_SVG_STYLE = /* @__PURE__ */ toCamel(HEATMAP_LEGEND_SWATCH_SVG_STYLE);

interface HeatmapLegendSwatchProps {
  readonly level: number;
  readonly style: HeatmapLevelStyle;
  readonly cellSize: number;
  readonly cornerRadius: number;
}

const HeatmapLegendSwatch = ({ level, style, cellSize, cornerRadius }: Readonly<HeatmapLegendSwatchProps>): ReactElement => {
  // Unconditional (rules of hooks); consumed only by the pattern branch. Ids are useId-scoped so multiple charts/legends on one page don't collide.
  const reactId = useSanitizedId();
  const pattern = heatmapLegendPatternSwatch({ cellSize, cornerRadius, level, style }, reactId);
  if (pattern !== undefined) {
    return (
      <span
        aria-hidden="true"
        className="ts-bkm-heatmap-legend-swatch ts-bkm-heatmap-legend-swatch--pattern"
        style={toCamel(pattern.shellStyle)}
      >
        <svg aria-hidden="true" viewBox={`0 0 ${cellSize} ${cellSize}`} style={SWATCH_SVG_STYLE}>
          {pattern.tile === undefined ? undefined : renderMarkup(pattern.tile)}
          <rect
            fill={pattern.fill}
            height={cellSize}
            rx={cornerRadius}
            ry={cornerRadius}
            width={cellSize}
          />
        </svg>
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className="ts-bkm-heatmap-legend-swatch"
      style={toCamel(heatmapLegendSolidSwatchStyle({ cellSize, cornerRadius, level, style }))}
    />
  );
};

interface LegendSwatchArgs {
  readonly level: number;
  readonly highlightedLevel: number | null;
  readonly isDimming: boolean;
  readonly hoverParams: Readonly<HeatmapHoverStyleParams>;
  readonly levelStyles: HeatmapLevelStyles;
  readonly isInteractive: boolean;
  readonly cellSize: number;
  readonly cornerRadius: number;
  readonly onEnter: (level: number) => void;
  readonly onLeave: () => void;
}

// Enter-handler factory; module scope so the render path passes no inline closures.
const createSwatchEnterHandler = (swatch: Readonly<LegendSwatchArgs>): (() => void) => (): void => {
  swatch.onEnter(swatch.level);
};

// One swatch with its hover wrapper; plain function (not a component) so the element tree is unchanged.
const renderLegendSwatch = (swatch: Readonly<LegendSwatchArgs>): ReactElement => {
  const swatchWrapStyle = toCamel(heatmapLegendSwatchWrapStyle(swatch));
  const style = heatmapLegendLevelStyle(swatch.levelStyles, swatch.level);
  const { onLeave: handleLeave } = swatch;
  const handleEnter = createSwatchEnterHandler(swatch);
  const swatchNode = (<HeatmapLegendSwatch level={swatch.level} style={style} cellSize={swatch.cellSize} cornerRadius={swatch.cornerRadius} />);
  return (
    <span
      key={swatch.level}
      aria-hidden="true"
      className="ts-bkm-heatmap-legend-swatch-wrap"
      onPointerEnter={handleEnter}
      onPointerLeave={handleLeave}
      style={swatchWrapStyle}
    >
      {swatchNode}
    </span>
  );
};

// Gradient-vs-swatches branch; plain function (not a component) so the element tree is unchanged.
const renderLegendContent = (content: Readonly<LegendContentArgs>): ReactElement => {
  const { onEnter: handleEnter, onLeave: handleLeave } = content;
  if (content.variant === "gradient") {
    return (
      <HeatmapLegendGradient
        levels={HEATMAP_LEGEND_LEVELS}
        levelStyles={content.levelStyles}
        cellSize={content.cellSize}
        gap={content.gap}
        cornerRadius={content.cornerRadius}
        gradientSpan={content.gradientSpan}
        highlightedLevel={content.highlightedLevel}
        isDimming={content.isDimming}
        inactiveOpacity={content.inactiveOpacity}
        inactiveScale={content.inactiveScale}
        activeScale={content.activeScale}
        isInteractive={content.isInteractive}
        onEnter={handleEnter}
        onLeave={handleLeave}
      />
    );
  }
  return (
    <div className="ts-bkm-heatmap-legend-swatches" style={content.swatchesStyle}>
      {HEATMAP_LEGEND_LEVELS.map((level) => renderLegendSwatch({
        cellSize: content.cellSize,
        cornerRadius: content.cornerRadius,
        highlightedLevel: content.highlightedLevel,
        hoverParams: content.hoverParams,
        isDimming: content.isDimming,
        isInteractive: content.isInteractive,
        level,
        levelStyles: content.levelStyles,
        onEnter: handleEnter,
        onLeave: handleLeave,
      }))}
    </div>
  );
};

interface LegendModelArgs {
  readonly interactive: boolean | undefined;
  readonly levelStylesProp: HeatmapLevelStyles | undefined;
  readonly colorScale: (count: number | null | undefined) => string;
  readonly activeScale: number;
  readonly inactiveOpacity: number;
  readonly inactiveScale: number;
}

interface LegendModel {
  readonly isInteractive: boolean;
  readonly levelStyles: HeatmapLevelStyles;
  readonly hoverParams: HeatmapHoverStyleParams;
  readonly highlightedLevel: number | null;
  readonly isDimming: boolean;
  readonly onEnter: (level: number) => void;
  readonly onLeave: () => void;
}

// Derived legend state; one hook so HeatmapLegend stays short.
const useLegendModel = (model: Readonly<LegendModelArgs>): LegendModel => {
  const coordinator = useHeatmapCoordinatorOptional();
  const isInteractive = model.interactive ?? Boolean(coordinator);
  const levelStyles = heatmapLegendLevelStyles(model.levelStylesProp, model.colorScale);
  const hoverParams: HeatmapHoverStyleParams = { activeScale: model.activeScale, inactiveOpacity: model.inactiveOpacity, inactiveScale: model.inactiveScale };
  const { highlightedLevel, isDimming } = useLegendHighlight({ coordinator, hoverParams, isInteractive });
  const { onEnter, onLeave } = heatmapLegendHandlers(coordinator, isInteractive);
  return { highlightedLevel, hoverParams, isDimming, isInteractive, levelStyles, onEnter, onLeave };
};

const RenderHeatmapLegend = ({
  lessLabel = "Less",
  moreLabel = "More",
  cellSize = 11,
  gap = 2,
  cornerRadius = 2,
  align = "end",
  variant = "swatches",
  gradientSpan = 5,
  fontSize,
  labelClassName,
  levelStyles: levelStylesProp,
  colorScale = defaultHeatmapColorScale,
  inactiveOpacity = HEATMAP_INACTIVE_OPACITY,
  inactiveScale = 1,
  activeScale = 1,
  interactive,
  className,
}: Readonly<HeatmapLegendProps>): ReactElement => {
  const model = useLegendModel({ activeScale, colorScale, inactiveOpacity, inactiveScale, interactive, levelStylesProp });
  const chrome = heatmapLegendChrome({ align, className, fontSize, labelClassName });
  const labelStyle = chrome.labelStyle === undefined ? undefined : toCamel(chrome.labelStyle);
  const swatchesStyle = useMemo(() => toCamel(heatmapLegendSwatchesStyle(gap)), [gap]);

  return (
    <div className={chrome.rootClass} style={toCamel(chrome.rootStyle)}>
      <span className={chrome.labelClass} style={labelStyle}>{lessLabel}</span>
      {renderLegendContent({
        activeScale,
        cellSize,
        cornerRadius,
        gap,
        gradientSpan,
        highlightedLevel: model.highlightedLevel,
        hoverParams: model.hoverParams,
        inactiveOpacity,
        inactiveScale,
        isDimming: model.isDimming,
        isInteractive: model.isInteractive,
        levelStyles: model.levelStyles,
        onEnter: model.onEnter,
        onLeave: model.onLeave,
        swatchesStyle,
        variant,
      })}
      <span className={chrome.labelClass} style={labelStyle}>{moreLabel}</span>
    </div>
  );
};

/**
 * The Less to More legend: level swatches (or a gradient bar) sharing `levelStyles` with the chart.
 * Place it inside the same `HeatmapInteractionProvider` as the chart so hovering a swatch dims the other levels of the grid.
 */
const HeatmapLegend: NamedExoticComponent<Readonly<HeatmapLegendProps>> = /* @__PURE__ */ Object.assign(/* @__PURE__ */ memo(RenderHeatmapLegend), { displayName: "HeatmapLegend" });

export {
  HEATMAP_LEGEND_LEVELS,
  HeatmapLegend,
};
