import { createSvgChartRenderer } from "@tanstack/charts/svg/renderer";
import { propsFor } from "../carriers/table";
import type { ChildTable } from "../carriers/table";
import { el } from "../markup/node";
import type { MarkupChild } from "../markup/node";
import { patternPresetTree } from "../markup/patterns";
import { memoCell } from "../memo";
import { px } from "../style";
import type { StyleObject } from "../style";
import type {
  HeatmapCellsProps,
  HeatmapChartProps,
  HeatmapMargin,
  HeatmapSeparatorProps,
  HeatmapSeparatorStyle,
  HeatmapTooltipConfig,
  HeatmapTooltipProps,
  HeatmapXAxisProps,
  HeatmapYAxisConfig,
  HeatmapYAxisProps,
} from "../types/heatmap";
import {
  buildHeatmapColorScaleFromStyles,
  buildHeatmapFillScale,
  heatmapLevelPatternId,
  heatmapLevelPatternRenderOptions,
  isHeatmapLevelPattern,
  resolveHeatmapLevelStyles,
} from "./colors";
import type { HeatmapLevelStyles } from "./colors";
import { filterHeatmapColumns, resolveHeatmapDisplayRange, rotateHeatmapColumnBins } from "./columns";
import type { HeatmapColumn, HeatmapDisplayRange } from "./columns";
import { DEFAULT_MARGIN, HEATMAP_INACTIVE_OPACITY } from "./context";
import type { HeatmapContextFields } from "./context";
import { getHeatmapDayLabels } from "./day-labels";
import { buildCellData, buildHeatmapDefinition } from "./definition";
import type { CellDatum } from "./definition";
import type { HeatmapScene } from "./focus";
import type { HeatmapHoverLook } from "./hover-attrs";
import { isHeatmapHoverEffectEnabled } from "./hover-style";
import type { HeatmapCellLayerInput } from "./cell-layer";
import {
  HEATMAP_DEFAULT_ENTER_DURATION_MS,
  HEATMAP_DEFAULT_LOADING_CELL_MAX_OPACITY,
  HEATMAP_DEFAULT_LOADING_CELL_RANDOMNESS,
  HEATMAP_LOADING_CHART_OPACITY,
  resolveHeatmapWaveTiming,
} from "./motion";
import { buildHeatmapSeparatorGradientStops, getHeatmapSeparatorLineY, normalizeHeatmapSeparatorConfig, resolveHeatmapSeparatorLayout } from "./separators";
import type { HeatmapSeparatorLayout, HeatmapSeparatorParsedConfig } from "./separators";
import type { HeatmapLabelClasses } from "./label-classes";
import { createHeatmapTooltipBody, HEATMAP_TOOLTIP_HIDE_DELAY_MS, heatmapTooltipConfig, heatmapTooltipGlide, heatmapTooltipHold } from "./tooltip";
import type { HeatmapTooltipGlideCurve } from "./tooltip";
import type { HeatmapTooltipBody } from "./tooltip";

const MIN_RENDERABLE_DIMENSION_PX = 10;
const DEFAULT_WEEK_ROW_COUNT = 7;
const REVEAL_HASH_MULTIPLIER = 31;
const REVEAL_HASH_MODULUS = 1_000_003;

/** Plot pixels past the grid, under a hundredth of a pixel (float error of a fitted grid) counted as none. */
const plotSlack = (pixels: number): number => (pixels > 0.01 ? pixels : 0);

/** The width a fluid heatmap assumes until its host is measured. */
export const HEATMAP_INITIAL_WIDTH_PX = 720;
/** The smallest host width change a fluid heatmap follows. */
export const HEATMAP_WIDTH_EPSILON_PX = 0.5;

// One module-level renderer: TanStack's plain SVG renderer, not `motion()`. Nothing in a heatmap animates natively (every mark and the
// definition are `motion: false`, `svgAnimation: false`: the cells' motion is cell-layer.ts's Web Animations), and the tooltip's hold after
// a cell is left is the native `hideDelay` (definition.ts), so the motion engine stays out of the bundle.
export const HEATMAP_RENDERER = /* @__PURE__ */ createSvgChartRenderer();

const hashSignature = (signature: string): number => {
  let hash = 0;
  for (let index = 0; index < signature.length; index += 1) {
    hash = (hash * REVEAL_HASH_MULTIPLIER + (signature.codePointAt(index) ?? 0)) % REVEAL_HASH_MODULUS;
  }
  return hash;
};

type ChartStatus = NonNullable<HeatmapChartProps<unknown>["status"]>;
type ColorScale = (count: number | null | undefined) => string;
type HeatmapDefinition = ReturnType<typeof buildHeatmapDefinition>;
type HeatmapSeparatorLineYSpan = ReturnType<typeof getHeatmapSeparatorLineY>;

/** The props a pass reads (the framework keeps `className` and `children`). */
export type HeatmapPassProps = Omit<HeatmapChartProps<unknown>, "children" | "className">;

interface HeatmapPassInput {
  readonly props: HeatmapPassProps;
  /** The chart's config carriers. */
  readonly table: ChildTable;
  /** The host's width (core/size/fluid-width.ts: the initial width until the first measure). */
  readonly liveWidth: number;
  /** The host's height, which `layout="fill"` fits the cells in (0 until measured, and for a fluid chart). */
  readonly liveHeight: number;
}

interface HeatmapPassDeps {
  /** The chart's svg id prefix (pattern and separator-gradient ids, the hover sheet's scope). */
  readonly idPrefix: string;
  /** The last rendered scene, for the focus strategy (grid-focus.ts `getScene`). */
  readonly getScene: () => HeatmapScene | null;
}

export interface HeatmapPass<Style> {
  readonly status: ChartStatus;
  /** The `HeatmapCells` carrier's props: the grid draws only with one. */
  readonly cellsProps: HeatmapCellsProps | undefined;
  readonly interactive: boolean;
  readonly columnCount: number;
  readonly rowCount: number;
  readonly chartWidth: number;
  readonly chartHeight: number;
  /** The surface's height: the chart's plus half a gap (the inner box's negative margin takes it back). */
  readonly surfaceHeight: number;
  /** Whether the chart is large enough to draw. */
  readonly isRenderable: boolean;
  readonly definition: HeatmapDefinition;
  /** The hovered cell's tooltip as the text a framework renders (the renderer's `renderTooltipBody` context in). */
  readonly tooltipBody: HeatmapTooltipBody<Style>;
  readonly ariaLabel: string;
  readonly ariaDescription: string | undefined;
  /** The pattern tiles and the separator gradient for the chart's defs host, or null when neither is configured. */
  readonly resources: readonly MarkupChild[] | null;
  /** The loading label's text and its box (the plot area), or null when none shows. */
  readonly loadingLabel: { readonly text: string; readonly boxStyle: StyleObject } | null;
  /** Whether the hover emphasis runs (the chart is interactive and a hover prop is not 1). */
  readonly hoverEmphasis: boolean;
  /** What the hover emphasis's host attributes depend on (hover-attrs.ts): a hover scales cells, the chart draws separators. */
  readonly hoverLook: HeatmapHoverLook;
  /** The cell layer's settings (cell-layer.ts: the entrance wave, the shimmer, the conceal). */
  readonly cellLayer: HeatmapCellLayerInput;
  /** The host's style: its box, the loading opacity var and, when interactive, the hover vars. */
  readonly hostStyle: StyleObject;
  /** The box around the surface (half a gap pulled back at the bottom). */
  readonly innerStyle: StyleObject;
  /** The context's fields (context.ts `createHeatmapContext`). */
  readonly context: HeatmapContextFields<Style>;
  /** The readers' classes for the drawn labels and separator lines (label-classes.ts), or null without any. */
  readonly labelClasses: HeatmapLabelClasses | null;
  /** The tooltip's glide between cells (tooltip.ts `heatmapTooltipGlide`, played by tooltip-glide.ts), or null when it snaps. */
  readonly tooltipGlide: HeatmapTooltipGlideCurve | null;
}

interface HeatmapChartConfig<Style> {
  readonly cellsProps: HeatmapCellsProps | undefined;
  readonly hasXAxis: boolean;
  /** `HeatmapXAxis`'s `className`. */
  readonly xAxisClassName: string | undefined;
  readonly hasYAxis: boolean;
  readonly margin: HeatmapMargin;
  readonly separatorConfig: HeatmapSeparatorParsedConfig | undefined;
  readonly separatorStyle: HeatmapSeparatorStyle | null;
  readonly tooltipConfig: HeatmapTooltipConfig<Style> | null;
  readonly yAxis: HeatmapYAxisConfig;
}

/** The config carriers in the table, normalised to the chart's margin, y axis, separator and tooltip settings. */
const createChartConfig = <Style>(): ((table: ChildTable, columnSeparators: HeatmapSeparatorParsedConfig | undefined, marginProp: Readonly<Partial<HeatmapMargin>> | undefined) => HeatmapChartConfig<Style>) => {
  const marginCell = memoCell<HeatmapMargin>();
  const yAxisCell = memoCell<HeatmapYAxisConfig>();
  const separatorConfigCell = memoCell<HeatmapSeparatorParsedConfig | undefined>();
  const separatorStyleCell = memoCell<HeatmapSeparatorStyle | null>();
  const tooltipCell = memoCell<HeatmapTooltipConfig<Style> | null>();
  return (table, columnSeparators, marginProp) => {
    const cellsProps = propsFor<HeatmapCellsProps>(table, "heatmapCells").at(0);
    const yAxisProps = propsFor<HeatmapYAxisProps>(table, "heatmapYAxis").at(0);
    const xAxisProps = propsFor<HeatmapXAxisProps>(table, "heatmapXAxis").at(0);
    const tooltipProps = propsFor<HeatmapTooltipProps<Style>>(table, "heatmapTooltip").at(0);
    const separatorProps = propsFor<HeatmapSeparatorProps>(table, "heatmapSeparator").at(0);
    const margin = marginCell([marginProp], () => ({
      bottom: marginProp?.bottom ?? DEFAULT_MARGIN.bottom,
      left: marginProp?.left ?? DEFAULT_MARGIN.left,
      right: marginProp?.right ?? DEFAULT_MARGIN.right,
      top: marginProp?.top ?? DEFAULT_MARGIN.top,
    }));
    const yAxis = yAxisCell([yAxisProps], () => ({
      className: yAxisProps?.className,
      labelFormat: yAxisProps?.labelFormat ?? "full",
      rowOpacity: yAxisProps?.rowOpacity,
      tickFilter: yAxisProps?.tickFilter ?? "odd",
    }));
    const separatorConfig = separatorConfigCell(
      [columnSeparators, separatorProps],
      () => columnSeparators ?? normalizeHeatmapSeparatorConfig(separatorProps === undefined ? undefined : { every: separatorProps.every, groupBy: separatorProps.groupBy, spacing: separatorProps.spacing }) ?? undefined,
    );
    const separatorStyle = separatorStyleCell([separatorProps], () => (separatorProps === undefined ? null : {
      className: separatorProps.className, labelClassName: separatorProps.labelClassName, labelFormat: separatorProps.labelFormat, labelOffset: separatorProps.labelOffset,
      showLabels: separatorProps.showLabels, stroke: separatorProps.stroke, strokeDasharray: separatorProps.strokeDasharray,
      strokeOpacity: separatorProps.strokeOpacity, strokeStyle: separatorProps.strokeStyle, strokeWidth: separatorProps.strokeWidth,
      gradient: separatorProps.gradient, paddingY: separatorProps.paddingY, startOffset: separatorProps.startOffset,
    }));
    const tooltipConfig = tooltipCell([tooltipProps], () => heatmapTooltipConfig(tooltipProps));
    return { cellsProps, hasXAxis: table.has("heatmapXAxis"), hasYAxis: yAxisProps !== undefined, margin, separatorConfig, separatorStyle, tooltipConfig, xAxisClassName: xAxisProps?.className, yAxis };
  };
};

interface ColumnModelInput {
  readonly colorScaleProp: ColorScale | undefined;
  readonly data: HeatmapColumn[];
  readonly levelColors: HeatmapChartProps<unknown>["levelColors"];
  readonly levelStyles: HeatmapLevelStyles | undefined;
  readonly separatorConfig: HeatmapSeparatorParsedConfig | undefined;
  readonly weekStartDay: NonNullable<HeatmapChartProps<unknown>["weekStartDay"]>;
  readonly xDomain: [Date, Date] | undefined;
}

interface ColumnModel {
  readonly colorScale: ColorScale;
  readonly columns: HeatmapColumn[];
  readonly fillScale: ColorScale;
  readonly hasPattern: boolean;
  readonly resolvedLevelStyles: HeatmapLevelStyles;
  readonly separatorLayout: HeatmapSeparatorLayout | null;
}

const createColumnModel = (): ((input: ColumnModelInput) => ColumnModel) => {
  const columnsCell = memoCell<HeatmapColumn[]>();
  const normalizedCell = memoCell<HeatmapSeparatorParsedConfig | null>();
  const layoutCell = memoCell<HeatmapSeparatorLayout | null>();
  const levelStylesCell = memoCell<HeatmapLevelStyles>();
  const colorScaleCell = memoCell<ColorScale>();
  const fillScaleCell = memoCell<ColorScale>();
  const hasPatternCell = memoCell<boolean>();
  return ({ colorScaleProp, data, levelColors, levelStyles, separatorConfig, weekStartDay, xDomain }) => {
    const columns = columnsCell([data, xDomain, weekStartDay], () => rotateHeatmapColumnBins(filterHeatmapColumns(data, xDomain), weekStartDay));
    const normalizedSeparator = normalizedCell([separatorConfig], () => normalizeHeatmapSeparatorConfig(separatorConfig));
    const separatorLayout = layoutCell([normalizedSeparator, columns], () => resolveHeatmapSeparatorLayout(normalizedSeparator, columns));
    const resolvedLevelStyles = levelStylesCell([levelColors, levelStyles], () => resolveHeatmapLevelStyles(levelColors, levelStyles));
    const colorScale = colorScaleCell([colorScaleProp, resolvedLevelStyles], () => colorScaleProp ?? buildHeatmapColorScaleFromStyles(resolvedLevelStyles));
    const fillScale = fillScaleCell([resolvedLevelStyles], () => buildHeatmapFillScale(resolvedLevelStyles));
    const hasPattern = hasPatternCell([resolvedLevelStyles], () => resolvedLevelStyles.some((style) => isHeatmapLevelPattern(style)));
    return { colorScale, columns, fillScale, hasPattern, resolvedLevelStyles, separatorLayout };
  };
};

interface MetricsInput {
  readonly binSize: number;
  readonly columns: readonly HeatmapColumn[];
  readonly layout: "fluid" | "fill";
  readonly liveWidth: number;
  /** The host's height, for `layout="fill"`. */
  readonly liveHeight: number;
  /** `sizingColumnCount` while `xDomain` is set: the column count the cell size is fitted to. */
  readonly sizingColumnCount: number | undefined;
  readonly margin: HeatmapMargin;
  readonly separatorLayout: HeatmapSeparatorLayout | null;
}

interface Metrics {
  readonly cellSize: number;
  readonly chartHeight: number;
  readonly chartWidth: number;
  readonly columnCount: number;
  readonly innerHeight: number;
  readonly innerWidth: number;
  readonly isRenderable: boolean;
  readonly rowCount: number;
}

/** Cell size and chart box (bklit heatmap-chart.tsx computeHeatmapDimensions): square cells sized to the width (`binSize` 0), also to the
 * height under `layout="fill"` (the chart then takes at least the host's height), or `binSize` cells (a fluid chart then takes the grid's width). */
const computeHeatmapMetrics = ({ binSize, columns, layout, liveHeight, liveWidth, margin, separatorLayout, sizingColumnCount }: Readonly<MetricsInput>): Metrics => {
  const rowCount = columns[0]?.bins.length ?? DEFAULT_WEEK_ROW_COUNT;
  const columnCount = columns.length;
  const sizingCount = Math.max(sizingColumnCount ?? columnCount, 1);
  const gutterTotal = separatorLayout ? separatorLayout.atColumns.length * separatorLayout.spacing : 0;
  const explicitBinSize = binSize > 0 ? binSize : undefined;
  const widthCell = Math.max((liveWidth - margin.left - margin.right - gutterTotal) / sizingCount, 0);
  const fill = layout === "fill" && liveHeight > 0;
  const cellSize = explicitBinSize ?? (fill ? Math.min(widthCell, Math.max(liveHeight - margin.top - margin.bottom, 0) / Math.max(rowCount, 1)) : widthCell);
  const innerWidth = columnCount * cellSize + gutterTotal;
  const innerHeight = rowCount * cellSize;
  const chartHeight = fill ? Math.max(liveHeight, margin.top + innerHeight + margin.bottom) : margin.top + innerHeight + margin.bottom;
  const chartWidth = explicitBinSize !== undefined && layout === "fluid" ? margin.left + innerWidth + margin.right : liveWidth;
  const isRenderable = chartWidth >= MIN_RENDERABLE_DIMENSION_PX && chartHeight >= MIN_RENDERABLE_DIMENSION_PX;
  return { cellSize, chartHeight, chartWidth, columnCount, innerHeight, innerWidth, isRenderable, rowCount };
};

interface ResourcesInput {
  readonly hasPattern: boolean;
  readonly levelStyles: HeatmapLevelStyles;
  readonly margin: HeatmapMargin;
  readonly patternIdPrefix: string | undefined;
  readonly separatorGradientId: string;
  readonly separatorLayout: HeatmapSeparatorLayout | null;
  readonly separatorSpan: HeatmapSeparatorLineYSpan;
  readonly separatorStyle: HeatmapSeparatorStyle | null;
}

/** Each pattern level's tile and the `<pattern>` shifting it onto the plot's origin. */
const patternNodes = (levelStyles: HeatmapLevelStyles, patternIdPrefix: string | undefined, phaseX: number, phaseY: number): MarkupChild[] =>
  levelStyles.flatMap((style, level) => {
    if (!isHeatmapLevelPattern(style) || !style.pattern) {return [];}
    const id = heatmapLevelPatternId(level);
    const scopedId = patternIdPrefix !== undefined && patternIdPrefix !== "" ? `${patternIdPrefix}-${id}` : id;
    const tile = patternPresetTree(style.pattern, `${scopedId}-base`, heatmapLevelPatternRenderOptions(style));
    if (tile === undefined) {return [];}
    return [
      tile,
      el("pattern", { id: scopedId, href: `#${scopedId}-base`, "xlink:href": `#${scopedId}-base`, patternTransform: `translate(${phaseX} ${phaseY})` }),
    ];
  });

/** The pattern tiles and the separator gradient for the defs host; null when neither is configured. */
const heatmapResources = ({ hasPattern, levelStyles, margin, patternIdPrefix, separatorGradientId, separatorLayout, separatorSpan, separatorStyle }: Readonly<ResourcesInput>): MarkupChild[] | null => {
  const patterns = hasPattern ? patternNodes(levelStyles, patternIdPrefix, margin.left, margin.top) : null;
  const gradient = separatorStyle?.gradient === undefined || separatorLayout === null ? null : (
    // Vertical stroke gradient in user space; sized to the line span (see definition `separatorSpan`).
    el(
      "linearGradient",
      { id: separatorGradientId, gradientUnits: "userSpaceOnUse", x1: 0, x2: 0, y1: margin.top + separatorSpan.y1, y2: margin.top + separatorSpan.y2 },
      buildHeatmapSeparatorGradientStops(separatorStyle.gradient, separatorStyle.strokeOpacity ?? 1).map((stop) =>
        el("stop", { offset: stop.offset, "stop-color": stop.color, "stop-opacity": stop.opacity }, [], { key: stop.offset })),
    )
  );
  if (patterns === null && gradient === null) {return null;}
  return [...(patterns ?? []), gradient];
};

// bklit heatmap-chart.tsx:482-497: the label box is the plot area (margin-inset), not the whole surface.
const loadingLabelBoxStyle = (margin: Readonly<HeatmapMargin>, width: number, height: number): StyleObject => ({
  height: px(Math.max(height - margin.top - margin.bottom, 0)), left: px(margin.left), "pointer-events": "none", position: "absolute", top: px(margin.top), width: px(Math.max(width - margin.left - margin.right, 0)),
});

interface HoverCssParams {
  readonly activeScale: number;
  readonly inactiveOpacity: number;
  readonly inactiveScale: number;
  readonly showDelay: number;
  readonly hideDelay: number;
}

// Hover emphasis is a fixed styles.css rule set keyed on host `data-hm-hover` (cell | level) plus one scoped rule for the hovered cell or level
// (hover-attrs.ts); opacity/scale props are host CSS vars. The tween is the hover profile's (styles.css `--bkm-hover-dur`), not a host var.
const hoverVars = (params: Readonly<HoverCssParams>): StyleObject => ({
  "--bkm-hm-active-s": params.activeScale,
  "--bkm-hm-inactive-o": params.inactiveOpacity,
  "--bkm-hm-inactive-s": params.inactiveScale,
  "--bkm-hm-show-delay": `${params.showDelay}ms`,
  "--bkm-hm-hide-delay": `${params.hideDelay}ms`,
});

/** One chart's pass builder. */
export function createHeatmapPass<Style>({ idPrefix, getScene }: HeatmapPassDeps): (input: HeatmapPassInput) => HeatmapPass<Style> {
  const config = createChartConfig<Style>();
  const columnModel = createColumnModel();
  const dayLabelsCell = memoCell<readonly string[]>();
  const displayRangeCell = memoCell<HeatmapDisplayRange | undefined>();
  const cellDataCell = memoCell<CellDatum[]>();
  const separatorSpanCell = memoCell<HeatmapSeparatorLineYSpan>();
  const revealEpochCell = memoCell<number>();
  const cellLayerCell = memoCell<HeatmapCellLayerInput>();
  const hoverLookCell = memoCell<HeatmapHoverLook>();
  const definitionCell = memoCell<HeatmapDefinition>();
  const tooltipBodyOf = createHeatmapTooltipBody<Style>();
  const containerStyleCell = memoCell<StyleObject>();
  const hoverStyleCell = memoCell<StyleObject>();
  const hostStyleCell = memoCell<StyleObject>();
  const innerStyleCell = memoCell<StyleObject>();
  const resourcesCell = memoCell<MarkupChild[] | null>();
  const loadingLabelCell = memoCell<HeatmapPass<Style>["loadingLabel"]>();
  const labelClassesCell = memoCell<HeatmapLabelClasses | null>();
  return ({ props, table, liveWidth, liveHeight }) => {
    const {
      data, layout = "fluid", binSize = 0, gap = 2, colorScale: colorScaleProp, margin: marginProp, weekStartDay = 0, xDomain, levelColors, levelStyles,
      status = "ready", animationDuration = HEATMAP_DEFAULT_ENTER_DURATION_MS, enterTransition, enterStaggerScale = 1,
      revealSignature = "", loadingCellMaxOpacity = HEATMAP_DEFAULT_LOADING_CELL_MAX_OPACITY, loadingCellRandomness = HEATMAP_DEFAULT_LOADING_CELL_RANDOMNESS,
      loadingLabel, animate = true, loadingOpacity = HEATMAP_LOADING_CHART_OPACITY, showLoadingCells = true, ariaDescription, ariaLabel, aspectRatio,
      columnSeparators, sizingColumnCount,
    } = props;

    const { cellsProps, hasXAxis, hasYAxis, margin, separatorConfig, separatorStyle, tooltipConfig, xAxisClassName, yAxis } = config(table, columnSeparators, marginProp);
    const { colorScale, columns, fillScale, hasPattern, resolvedLevelStyles, separatorLayout } = columnModel({ colorScaleProp, data, levelColors, levelStyles, separatorConfig, weekStartDay, xDomain });
    const { cellSize, chartHeight, chartWidth, columnCount, innerHeight, innerWidth, isRenderable, rowCount } = computeHeatmapMetrics({
      binSize, columns, layout, liveHeight, liveWidth, margin, separatorLayout, sizingColumnCount: xDomain === undefined ? undefined : sizingColumnCount,
    });
    const hideGhostCells = cellsProps?.hideGhostCells ?? true;
    const dayLabels = dayLabelsCell([weekStartDay], () => getHeatmapDayLabels(weekStartDay));
    const displayRange = displayRangeCell([columns, hideGhostCells], () => (hideGhostCells ? resolveHeatmapDisplayRange(columns) : undefined));
    const cellData = cellDataCell([cellSize, columns, dayLabels, displayRange, separatorLayout], () => buildCellData({ cellSize, columns, dayLabels, displayRange, layout: separatorLayout }));

    const patternIdPrefix = hasPattern ? `${idPrefix}-hm` : undefined;
    const interactive = cellsProps?.interactive ?? true;
    const animateCells = animate && animationDuration > 0;
    const separatorGradientId = `${idPrefix}-hm-sep`;
    const separatorSpan = separatorSpanCell(
      [innerHeight, margin.top, separatorStyle?.paddingY, separatorStyle?.startOffset],
      () => getHeatmapSeparatorLineY({ innerHeight, marginTop: margin.top, paddingY: separatorStyle?.paddingY, startOffset: separatorStyle?.startOffset }),
    );
    const revealEpoch = revealEpochCell([revealSignature], () => hashSignature(revealSignature));

    // The cells' motion is the cell layer's (cell-layer.ts), read from the drawn cells: the entrance settings never redraw.
    const cellLayer = cellLayerCell([status, animate, animateCells, showLoadingCells, animationDuration, enterTransition, enterStaggerScale, columnCount, revealSignature, loadingCellMaxOpacity], () => ({
      animate, enter: animateCells, loadingCellMaxOpacity, revealKey: revealSignature, shimmer: animate && showLoadingCells, status,
      timing: resolveHeatmapWaveTiming({ animationDurationMs: animationDuration, columnCount, enterStaggerScale, enterTransition }),
    }));

    // The deps are React's: `loadingCellRandomness`, `animate` and `showLoadingCells` are read but don't rebuild the definition.
    // The plot past the grid (`layout="fill"` fitting the height, `sizingColumnCount`, a `binSize` on a filled width): bklit leaves it empty
    // right of and below the cells, so the band scales get it as margin.
    const slackRight = plotSlack(chartWidth - margin.left - margin.right - innerWidth);
    const slackBottom = plotSlack(chartHeight - margin.top - margin.bottom - innerHeight);
    const definition = definitionCell([
      cellData, cellSize, columns, cellsProps, dayLabels, gap, innerWidth, slackRight, slackBottom,
      interactive, separatorLayout, resolvedLevelStyles, margin, patternIdPrefix, revealSignature, separatorStyle, separatorGradientId, separatorSpan, hasXAxis, hasYAxis, status,
      tooltipConfig, yAxis, getScene,
    ], () => buildHeatmapDefinition({
      getScene,
      cellData, cellSize, columns, cornerRadius: cellsProps?.cornerRadius ?? 2, dayLabels,
      gap, slack: { bottom: slackBottom, right: slackRight },
      innerWidth, interactive, layout: separatorLayout, levelStyles: resolvedLevelStyles, margin, patternIdPrefix, revealKey: revealSignature, cellRenderer: cellsProps?.renderer,
      rowOpacity: cellsProps?.rowOpacity, separator: separatorStyle, separatorGradientId, separatorSpan, showXAxis: hasXAxis, showYAxis: hasYAxis, status, tooltipClassName: "",
      loadingCellRandomness, loadingShimmer: animate && showLoadingCells, tooltipEnabled: tooltipConfig !== null, tooltipInstant: tooltipConfig?.instant ?? false, tooltipHideDelay: heatmapTooltipHold(tooltipConfig), yAxis,
    }));

    const tooltipBody = tooltipBodyOf(cellData, tooltipConfig);

    const containerStyle = containerStyleCell([aspectRatio], (): StyleObject => ({
      ...(aspectRatio !== undefined && aspectRatio.length > 0 ? { "aspect-ratio": aspectRatio } : {}),
      height: "100%", position: "relative", width: "100%",
    }));

    const resources = resourcesCell(
      [hasPattern, resolvedLevelStyles, margin, patternIdPrefix, separatorGradientId, separatorLayout, separatorSpan, separatorStyle],
      () => heatmapResources({ hasPattern, levelStyles: resolvedLevelStyles, margin, patternIdPrefix, separatorGradientId, separatorLayout, separatorSpan, separatorStyle }),
    );

    const activeScale = cellsProps?.activeScale ?? 1;
    const inactiveOpacity = cellsProps?.inactiveOpacity ?? HEATMAP_INACTIVE_OPACITY;
    const inactiveScale = cellsProps?.inactiveScale ?? 1;
    const showDelay = tooltipConfig?.showDelay ?? 0;
    const hideDelay = tooltipConfig?.hideDelay ?? HEATMAP_TOOLTIP_HIDE_DELAY_MS;
    const hoverStyle = hoverStyleCell([activeScale, inactiveOpacity, inactiveScale, showDelay, hideDelay], () => hoverVars({ activeScale, hideDelay, inactiveOpacity, inactiveScale, showDelay }));
    // bklit gates cell emphasis on these props (heatmap-cells.tsx:500-508, isHeatmapHoverEffectEnabled): with all three at 1 nothing dims,
    // so the host attributes are not written (each write restyles every cell and replays a no-op none -> scale(1) transition).
    const hoverEffect = isHeatmapHoverEffectEnabled({ activeScale, inactiveOpacity, inactiveScale });
    // bklit dims the chart to `loadingOpacity` while loading (and while concealing the ready cells on the way back to loading).
    const dimmed = status === "loading" && loadingOpacity !== 1;
    const hostStyle = hostStyleCell([containerStyle, hoverStyle, interactive, dimmed, loadingOpacity], () => ({
      ...containerStyle, ...(interactive ? hoverStyle : {}), ...(dimmed ? { opacity: loadingOpacity } : {}),
    }));
    const innerStyle = innerStyleCell([gap], (): StyleObject => ({ position: "relative", "margin-bottom": px(-gap / 2) }));

    const showLoadingLabel = (loadingLabel ?? "").trim().length > 0 && status === "loading";
    const label = loadingLabelCell([showLoadingLabel, loadingLabel, margin, chartWidth, chartHeight], () =>
      (showLoadingLabel ? { boxStyle: loadingLabelBoxStyle(margin, chartWidth, chartHeight), text: loadingLabel ?? "" } : null));

    return {
      status,
      cellsProps,
      interactive,
      columnCount,
      rowCount,
      chartWidth,
      chartHeight,
      surfaceHeight: chartHeight + gap / 2,
      isRenderable,
      definition,
      tooltipBody,
      ariaLabel: ariaLabel ?? cellsProps?.ariaLabel ?? "Heatmap chart",
      ariaDescription: ariaDescription ?? cellsProps?.ariaDescription,
      resources,
      loadingLabel: label,
      hoverEmphasis: interactive && hoverEffect,
      hoverLook: hoverLookCell([inactiveScale, activeScale, separatorLayout, separatorStyle], () => ({
        decor: separatorLayout !== null && separatorStyle !== null, scaled: inactiveScale !== 1 || activeScale !== 1,
      })),
      cellLayer,
      hostStyle,
      innerStyle,
      tooltipGlide: heatmapTooltipGlide(tooltipConfig),
      labelClasses: labelClassesCell([hasXAxis, xAxisClassName, hasYAxis, yAxis.className, separatorStyle?.labelClassName, separatorStyle?.className], () => {
        const classes = {
          separatorLabel: separatorStyle?.labelClassName || undefined,
          separatorLine: separatorStyle?.className || undefined,
          x: (hasXAxis && xAxisClassName) || undefined,
          y: (hasYAxis && yAxis.className) || undefined,
        };
        return Object.values(classes).some((value) => value !== undefined) ? classes : null;
      }),
      context: {
        animateCells, animationDuration, ariaDescription, ariaLabel, cellSize, status, colorScale, hasCustomColorScale: colorScaleProp !== undefined, columnCount, columns,
        enterStaggerScale, enterTransition, fillScale, gap, height: chartHeight, innerHeight, innerWidth, isRenderable, levelStyles: resolvedLevelStyles,
        loadingCellMaxOpacity, loadingCellRandomness, loadingLabel, loadingOpacity, margin, revealEpoch, rowCount, separator: separatorStyle, separatorLayout,
        showLoadingCells, tooltip: tooltipConfig, weekStartDay, width: chartWidth, yAxis,
      },
    };
  };
}
