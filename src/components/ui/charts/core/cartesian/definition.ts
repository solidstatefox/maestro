import { defineChart } from "@tanstack/charts";
import type { ChartDefinition, ChartTooltipInput } from "@tanstack/charts";
import type { BrushXChange } from "@tanstack/charts/interaction/brush";
import { scaleLinear, scaleTime } from "../scales";
import { REVEAL_EASING } from "../motion/easing";
import { bklitTooltip } from "../tooltip/bklit-tooltip";
import { tooltipBoxMotion } from "../tooltip/box-motion";
import { bklitTooltipPlacement } from "../tooltip/bklit-tooltip-portal";
import { propsFor } from "../carriers/table";
import { bklitTheme, BKLIT_TOOLTIP_PLACEMENT } from "../theme";
import { shortDateByDay } from "../format";
import { mergeTooltipCarriers } from "../tooltip/tooltip-carriers";
import { DEFAULT_Y_AXIS_ID, toDate } from "./series";
import type { Row } from "./series";
import { getBrushX } from "./brush-factory";
import type { BrushXFactory } from "./brush-factory";
import { erase } from "../erased-types";
import type { AnyMark } from "../erased-types";
import { gridColumnGuides, gridHostAttrs, gridRowGuides, loadingGridProps } from "./grid-guides";
import type { GridGuideProps as GridProps } from "./grid-guides";
import { backdropMarksFor, backgroundCssFor, backgroundMarksFor, overlaysFor, rangeDotsFor, rangesFor, trendMarksFor, valueLabelsMarkFor } from "./features";
import { pillLayout, pillTickReach } from "./date-pill";
import { dataExtent, resolveYDomains } from "./domains";
import { rowSets } from "./decimate";
import type { HoverVisuals } from "./hover-css";
import { buildHoverOverlayModel } from "./hover-guides";
import type { HoverOverlayModel } from "./hover-overlay";
import type { TooltipProps } from "./hover-guides";
import type { CartesianInput, CartesianSpec, ExtraDomains } from "./input";
import { plotSizeOf, ZERO_SIZE } from "./plot-size";
import type { PlotSize, PlotSnapshot } from "./plot-size";
import { cartesianFocus } from "./plot-focus";
import { pushSegmentMarks, hasSegments, readSegmentProps } from "./segment-marks";
import { drawsHighlight, pushSeriesMarks } from "./series-marks";
import type { AreaSeries } from "./series";
import { isBarRect, WIPE_KEY, wipeAt, wipedMarkFactories, wipeMotion, wipeWrap } from "./wipe";
import type { WipeSpec } from "./wipe";
import { buildXScale, xLabelFormat } from "./x-axis";
import type { XAxisProps } from "./x-axis";
import { buildYScales, primaryYAxis } from "./y-axis";
import type { YAxisProps } from "./y-axis";
import type { BuildState } from "./build-state";

export type { CartesianInput } from "./input";
export { hoverStaticCss } from "./hover-css";
export { bklitYDomain, niced, SINGLE_TIME_SPAN_MS } from "./domains";
export { navigationPrimary } from "./plot-focus";

const ENTER_INSTANT = { transition: { type: "tween", duration: 0 } } as const;
/** bklit useAnimatedYDomains: 500ms on LINE_LOADING_PULSE_EASE, applied to everything drawn with the y scale. */
export const Y_DOMAIN_GLIDE = { transition: { type: "tween", duration: 500, easing: REVEAL_EASING } } as const;
const UPDATE_MOTION = { transition: { type: "tween", duration: 200, easing: "ease-in-out" } } as const;

export interface CartesianBuild {
  tooltipEnabled: boolean;
  tooltipProps: TooltipProps;
  /** Resolved data domains, for the public chart-context hooks (scales are rebuilt from these). */
  domains: { readonly x: readonly [Date, Date]; readonly y: Readonly<Record<string, readonly [number, number]>> };
  readonly targetY: Readonly<Record<string, readonly [number, number]>>;
  /** x tick values (ms) and the pill reach (px), for the date pill's scoped tick-blanking CSS. */
  pillTicks: { readonly times: readonly number[]; readonly reachPx: number; readonly active: boolean };
  /** Hover visuals as scoped CSS inputs (see `hoverStaticCss`). */
  hover: HoverVisuals;
  /** The hover indicator (crosshair, dots, date pill) the host's HoverOverlay draws; null without a ChartTooltip. */
  overlay: HoverOverlayModel | null;
  /** Host attributes for the static grid edge-fade rules (styles.css). */
  gridAttrs: Record<string, string | undefined>;
  /** Mask rules for the Background child (background.ts); empty without one. */
  backgroundCss: (scope: string) => string;
}

/** The y-domain glide at `yDomainTweenDuration` (the 500ms default is the shared constant). */
const yGlide = (ms: number | undefined): typeof Y_DOMAIN_GLIDE => (ms === undefined || ms === 500 ? Y_DOMAIN_GLIDE : { transition: { type: "tween", duration: ms, easing: REVEAL_EASING } } as unknown as typeof Y_DOMAIN_GLIDE);

function updateMotion(step: CartesianInput["updateStep"], glideMs: number | undefined): typeof Y_DOMAIN_GLIDE | typeof UPDATE_MOTION | false {
  if (step === "snap") {
    return false;
  }
  return step === "glide" ? yGlide(glideMs) : UPDATE_MOTION;
}

/** Marks that follow the y scale only (grid rows); everything else positioned by the x scale snaps in a window step. */
const Y_ONLY_MARKS = /* @__PURE__ */ new Set(["grid-rows", "grid-highlight-rows"]);

/** bklit on a brushed xDomain change: x scale, axis and grid snap (time-series-chart-shell.tsx:284-300); series paths and y domain tween 500ms
 * (use-animated-series-path.ts:54-65, use-animated-y-domains.ts:88). Context fields: reference/motion.md. */
function windowMotion(context: { phase: string; role?: string; axis?: string; markId?: string }, glideMs: number | undefined): typeof Y_DOMAIN_GLIDE | false {
  if (context.phase !== "update") {
    return false;
  }
  const glide = yGlide(glideMs);
  if (context.axis !== undefined) {
    return context.axis === "y" ? glide : false;
  }
  const onlyY = context.markId !== undefined && Y_ONLY_MARKS.has(context.markId);
  return context.role === "line" || context.role === "area" || onlyY ? glide : false;
}

/** Entrance keeps the renderer's long tween; every later update or exit is snappy. Line / area / projection (and composed bar) reveal is the native `wipe-` tween
 * (wipeWrap); the rest of a cartesian entrance paints instantly under it. Composed bars carry their own per-mark `motion`, which overrides this. */
function chartMotion(spec: CartesianSpec): (context: { phase: string; key?: string; role?: string; axis?: string; markId?: string }) => unknown {
  return (context) => {
    if (context.key?.startsWith(WIPE_KEY)) {
      return wipeMotion(spec.wipe?.ms ?? spec.animationDuration, spec.wipe?.armedAt, spec.revealEasing);
    }
    if (spec.updateStep === "window") {
      return windowMotion(context, spec.yGlideMs);
    }
    return context.phase === "enter" ? ENTER_INSTANT : updateMotion(spec.updateStep, spec.yGlideMs);
  };
}

function brushControls(input: Pick<CartesianSpec, "brush">): ReturnType<BrushXFactory>[] | undefined {
  const { brush } = input;
  const brushX = getBrushX();
  if (!(brush && brushX)) {
    return undefined;
  }
  return [
    brushX(erase({
      range: {
        value: brush.range,
        onChange: (value: { start: Date; end: Date }, context: { readonly reason: BrushXChange<Date> }) => brush.onChange(value, context.reason.type),
      },
      keyboard: false,
      handleSize: 6,
      handleStyle: { fill: "var(--chart-1)", fillOpacity: 0.6 },
      // styles.css masks this rect into bklit's diagonal hatch (no <pattern> resources in 1.0).
      selectionStyle: { fill: brush.color ?? "var(--chart-1)", fillOpacity: 0.12, stroke: "var(--chart-brush-border)" },
    })),
  ];
}

/** Composed bar rects sit under bklit's one shared reveal clip, so they are wrapped like the line / area marks. */
function extraMarksOf(input: CartesianInput, yDomains: ExtraDomains): readonly AnyMark[] {
  const { wipe } = input;
  const marks = typeof input.extraMarks === "function" ? input.extraMarks(yDomains) : input.extraMarks;
  if (!wipe) {
    return marks;
  }
  // SAFETY: a mark's `id` option is not in the mark type; composed bars set it as a string.
  return marks.map((m, i) => (isBarRect((m as { id?: string }).id) ? wipeWrap(erase(m), `b${i}`, wipe, input.margin) : m));
}

/** The extra hover dots of a build, once its y domains are resolved. */
const extraDotsOf = (input: CartesianInput, yDomains: ExtraDomains): CartesianInput => (typeof input.extraDots === "function" ? { ...input, extraDots: input.extraDots(yDomains) } : input);

const cartesianTooltip = (tooltipProps: TooltipProps): ChartTooltipInput<Row, Date, number, "dom"> =>
  erase({
    use: bklitTooltip,
    ...BKLIT_TOOLTIP_PLACEMENT,
    // `topOffset` drops the pinned panel below the plot top.
    ...(tooltipProps.topOffset ? { portal: bklitTooltipPlacement({ pinTop: true, topOffset: tooltipProps.topOffset }) } : null),
    sticky: tooltipProps.pinnable === true,
    motion: tooltipBoxMotion(tooltipProps),
  });

/** The mark state of one cartesian build at one size: everything `chart()` returns, plus the metadata React reads. */
interface SizedBuild {
  readonly marks: AnyMark[];
  readonly scales: unknown;
  readonly gradients: BuildState["gradients"];
  readonly built: CartesianBuild;
}

/** Host attributes of the static grid edge-fade rules: from the grid carrier alone, so React has them before the draw. */
export function gridAttrsOf(table: CartesianInput["table"], chartLoading: boolean): CartesianBuild["gridAttrs"] {
  const carrier = propsFor<GridProps>(table, "grid")[0];
  return gridHostAttrs(chartLoading ? loadingGridProps(carrier) : carrier);
}

/** Whether the series draw a hover highlight path (the owned band clipPath is only mounted then). With or without a `ChartTooltip`: bklit's
 * hover is the chart's own (time-series-chart-shell.tsx's interaction handlers), so a chart without one still dims its lines and lights the
 * hovered segment (SeriesHoverDim, SeriesHighlightLayer); the tooltip only adds the panel, the crosshair, the dots and the date pill. */
export function hasHighlight(series: CartesianInput["series"]): boolean {
  return series.some(drawsHighlight);
}

/** The date pill's text of a row: its `ChartTooltip` `dateLabels` entry (by data row), else the short date. */
function pillTextOf(input: CartesianInput, dateLabels: readonly string[] | undefined): (row: Row) => string {
  const label = shortDateByDay();
  const format = (row: Row): string => label(toDate(row[input.xKey]));
  if (!dateLabels) {
    return format;
  }
  const index = new Map(input.data.map((row, i) => [row, i] as const));
  return (row) => dateLabels[index.get(row) ?? -1] ?? format(row);
}

function buildSized(input: CartesianInput): SizedBuild {
  const { data, xKey, table, series, uid } = input;
  const { lineY, areaY } = wipedMarkFactories(input.wipe, input.margin);
  const tooltipProps = mergeTooltipCarriers(propsFor<TooltipProps>(table, "tooltip")[0], table);
  const tooltipEnabled = tooltipProps !== undefined;
  const gridCarrier = propsFor<GridProps>(table, "grid")[0];
  const grid = input.chartLoading === true ? loadingGridProps(gridCarrier) : gridCarrier;
  const xAxis = propsFor<XAxisProps>(table, "xAxis")[0];
  const yAxes = propsFor<YAxisProps>(table, "yAxis");

  // Rows visible in the (optional) brushed window, plus one neighbour each side so paths reach the edge.
  const { rows, drawRows, pathRows } = rowSets(input);
  const xAccessor = (d: Row): Date => toDate(d[xKey]);
  const keyOf = (d: Row): number => xAccessor(d).getTime();

  // bklit's ChartRevealClip also covers the projection lines (projection-line.tsx is a plain clipped child). The terminal marker is a
  // post-overlay outside the clip (line-series-terminal-marker.tsx:91), so it is not wrapped: styles.css `bkm-terminal-fade|grow` enter it at the ready flip.
  const { wipe } = input;
  const wipeOverlay = <M>(mark: M, tag: string): M => (wipe ? wipeWrap(erase(mark), tag, wipe, input.margin) : mark);
  const overlays = overlaysFor(table, rows, xKey, uid, wipe ? wipeOverlay : undefined);
  // The data extent widened by the overlays and the extra marks, unless the chart is windowed.
  const xDomain: [Date, Date] | undefined = input.xDomain
    ? [input.xDomain[0], input.xDomain[1]]
    : dataExtent(data, xKey, [...input.extraXValues, ...overlays.xValues]);
  const overlayExtent = dataExtent(data, xKey, overlays.xValues);

  // Band, Deadline and Weekends (range-overlays.ts), when the chart uses one.
  const ranges = rangesFor({
    table,
    rows: pathRows,
    valueRows: rows,
    focusRows: drawRows === rows ? undefined : rows,
    xKey,
    uid,
    lineY,
    areaY,
    tooltipEnabled,
  });

  const { yDomains, targetY } = resolveYDomains({
    series,
    rows,
    extraYValues: input.extraYValues,
    overlayYValues: overlays.yValues,
    projectionYValues: overlays.projectionYValues,
    rangeYValues: ranges?.yValues,
    yDomainFrom: input.yDomainFrom,
    overrides: input.yDomainOverrides,
    extraYByAxis: input.extraYByAxis,
    floatingAxes: input.floatingAxes,
    yScaleDomainMax: input.yScaleDomainMax,
  });

  // Hover dim + highlight are fixed host-attribute CSS (`hoverStaticCss`), NOT mark `states`: any mark state re-resolves, re-renders and reconciles the scene on every pointermove
  // (resolveMarkStateScene always returns a fresh one), ~4ms of main thread per move.
  const state: BuildState = { marks: [], gradients: [...input.extraGradients], hoverDim: [], hoverHighlights: [], plRules: [], styles: [] };
  // bklit's Grid ticks are independent of the axis labels' and can drop edge lines: those rows / columns are marks under the series.
  const primaryAxis = primaryYAxis(yAxes);
  const primaryDomain = yDomains.get(DEFAULT_Y_AXIS_ID) ?? [0, 100];
  const rowGuides = gridRowGuides(grid, scaleLinear().domain(primaryDomain), primaryAxis !== undefined, primaryAxis?.numTicks);
  const columnMarks = gridColumnGuides(grid, scaleTime().domain(input.xDomain ?? overlayExtent ?? [new Date(0), new Date(1)]));
  state.marks.push(...backgroundMarksFor(table, uid), ...rowGuides.marks, ...columnMarks);
  // Weekends and Deadline sit above the grid and Background and beneath the series (bklit's underlay layer), then the bands declared before them.
  if (ranges) {
    state.marks.push(...ranges.underlays, ...ranges.bandsUnder);
    state.gradients.push(...ranges.gradients);
  }
  // bklit hides LineBackdrop and TrendLine while loading (they show from the reveal on).
  const layers = input.chartLoading === true
    ? undefined
    : { table, rows: pathRows, xAccessor, uid, plotWidth: input.plotWidth ?? 0, plotHeight: input.plotHeight ?? 0, yDomains, gradients: state.gradients };
  if (layers) {
    state.marks.push(...backdropMarksFor(layers));
  }
  const seriesStart = state.marks.length;
  pushSeriesMarks({ input, rows: pathRows, markerRows: drawRows, focusRows: drawRows === rows ? undefined : rows, yDomains, fadeDomain: input.fadeDomain ? [input.fadeDomain[0], input.fadeDomain[1]] : xDomain, xAccessor, keyOf, lineY, areaY, tooltipEnabled, state });
  if (layers) {
    // bklit draws TrendLine under the shell's one reveal clip (time-series-chart-shell.tsx): it is wiped in with the series.
    state.marks.push(...trendMarksFor(layers).map((mark, i) => wipeOverlay(mark, `t${i}`)));
  }

  const overlayX: [Date, Date] = input.xDomain ? [input.xDomain[0], input.xDomain[1]] : (overlayExtent ?? [new Date(0), new Date(1)]);
  const underMarks: AnyMark[] = [];
  const overMarks = overlays.marks(primaryDomain, overlayX, input.plotWidth ?? 0, underMarks);
  state.marks.splice(seriesStart, 0, ...underMarks);
  state.marks.push(...(ranges?.bandsOver ?? []), ...overMarks, ...extraMarksOf(input, yDomains));
  // bklit AreaValueLabels: one final layer over every fill, inside the reveal clip.
  const valueLabels = valueLabelsMarkFor({ id: "value-labels", rows, series: series.filter((s): s is typeof s & AreaSeries => s.kind === "area"), xOf: xAccessor });
  if (valueLabels) {
    state.marks.push(wipeOverlay(valueLabels, "vl"));
  }
  state.gradients.push(...overlays.gradients);

  const segmentProps = readSegmentProps(table);
  const segments = xDomain !== undefined && hasSegments(segmentProps);
  if (xDomain && segments) {
    pushSegmentMarks(state, segmentProps, uid, xDomain, primaryDomain, input.plotWidth ?? 0);
  }

  // Hover indicator: crosshair rule + date pill, then one dot per series.
  const pillActive = tooltipEnabled && tooltipProps.showDatePill !== false;
  const pillText = pillTextOf(input, tooltipProps?.dateLabels);
  const pillLabels = pillActive ? rows.map(pillText) : [];
  // `dateLabels` are the reader's own strings: the compact text pill, not the month / day ticker that rolls dates.
  const pill = pillActive && tooltipProps.dateLabels === undefined ? pillLayout(pillLabels) : null;
  const bandDots = tooltipEnabled && ranges?.focus === true && tooltipProps.showDots !== false
    ? rangeDotsFor(table, new Set(series.map((s) => s.dataKey)), { r: tooltipProps.dotSize ?? 5, strokeWidth: tooltipProps.dotStrokeWidth ?? 2 })
    : [];
  const overlay = tooltipEnabled ? buildHoverOverlayModel({ input: extraDotsOf(input, yDomains), rows, keyOf, tooltipProps, pill, pillActive, pillText, rangeDots: bandDots, rangeFocus: ranges?.focus === true }) : null;

  const x = buildXScale({ input, rows, xAxis, xDomain, overlaysWidenX: overlays.xValues.length > 0, pillActive });
  const formatX = xLabelFormat(input, xAxis);
  const tickLabels = x.tickTimes.map((t) => formatX(new Date(t)));

  const yScales = buildYScales({ yDomains, yAxes, rowGuides, grid });
  const scales = erase({ x: x.scale, ...yScales });

  const plSeries = series.find((s) => s.profitLoss);
  const plSigns = rows.map((row): 0 | 1 | null => {
    const v = plSeries ? row[plSeries.dataKey] : undefined;
    if (typeof v !== "number") {
      return null;
    }
    return v >= 0 ? 0 : 1;
  });
  const built: CartesianBuild = {
    tooltipEnabled,
    tooltipProps: tooltipProps ?? {},
    domains: { x: xDomain ?? [new Date(0), new Date(1)], y: Object.fromEntries(yDomains) },
    /** The y domains the data resolves to (differs from `domains.y` only in the "snap" step). */
    targetY,
    pillTicks: { times: x.tickTimes, reachPx: pillTickReach(xAxis?.tickerHalfWidth ?? 50, pill, pillLabels, tickLabels) + 12, active: pillActive },
    overlay,
    gridAttrs: gridHostAttrs(grid),
    backgroundCss: (scope) => backgroundCssFor(scope, table) + (ranges?.css(scope) ?? ""),
    hover: { dim: state.hoverDim, highlights: state.hoverHighlights, pl: state.plRules, times: rows.map(keyOf), plSigns, segmentLeft: segments ? input.margin.left : null, bandClip: `${uid}-hlband`, styles: state.styles, spans: [...new Set(state.hoverHighlights.map((hl) => hl.span ?? 1).filter((span) => span > 1))] },
  };
  return { marks: state.marks, scales, gradients: state.gradients, built };
}

const resolveExtraMarks = (extra: CartesianSpec["extraMarks"], size: PlotSize): CartesianInput["extraMarks"] => (typeof extra === "function" ? (yDomains) => extra(size, yDomains) : extra);
const resolveExtraDots = (extra: CartesianSpec["extraDots"], size: PlotSize): CartesianInput["extraDots"] => (typeof extra === "function" ? (yDomains) => extra(size, yDomains) : extra);

/** The responsive definition: TanStack calls `chart({ width, height })` in its draw (and on every resize), which builds the size-dependent marks, scales and gradients, and hands the
 * result to `onBuilt` (host writes and the lazy readers). No React state, measure or rebuild sits on the path to the first draw. */
export function buildCartesianDefinition(spec: CartesianSpec, onBuilt: (snapshot: PlotSnapshot) => void): ChartDefinition<Row, Date, number> {
  const tooltipProps = mergeTooltipCarriers(propsFor<TooltipProps>(spec.table, "tooltip")[0], spec.table);
  const tooltipEnabled = tooltipProps !== undefined;
  let live: PlotSize = ZERO_SIZE;
  const size = (): PlotSize => live;
  // The focus is bklit's nearest-x row inside the plot with or without a tooltip: the hover dim and the highlight segment follow it (`hasHighlight`).
  const focus = spec.focusOf ? spec.focusOf(size) : cartesianFocus(spec.margin, size);
  const wipe: WipeSpec | undefined = spec.wipe;
  return erase(defineChart(erase({
    chart: ({ width, height }: { width: number; height: number }) => {
      live = plotSizeOf(width, height, spec.margin);
      const sized: CartesianInput = {
        ...spec,
        plotWidth: live.innerWidth,
        innerWidth: live.innerWidth,
        plotHeight: live.innerHeight,
        wipe: wipe ? wipeAt(wipe, live) : undefined,
        extraMarks: resolveExtraMarks(spec.extraMarks, live),
        extraDots: resolveExtraDots(spec.extraDots, live),
      };
      const { marks, scales, gradients, built } = buildSized(sized);
      onBuilt({ built, size: live });
      return {
        marks: spec.orderMarks ? spec.orderMarks(marks) : marks,
        scales,
        margin: spec.margin,
        theme: bklitTheme,
        gradients,
        // Not `clip: true`: that would also cut the date pill (it hangs below the plot). styles.css clips the series
        // paths to the plot instead ([data-bkm-clip]).
        clip: false,
      };
    },
    motion: chartMotion(spec),
    focus,
    maxFocusDistance: Number.POSITIVE_INFINITY,
    focusRing: false,
    controls: brushControls(spec),
    tooltip: tooltipEnabled ? cartesianTooltip(tooltipProps) : false,
  })));
}
