import { createMark } from "@tanstack/charts";
import type { areaY as areaYRaw, ChartBounds, ChartGradient, lineY as lineYRaw, ResolvedScale, SceneNode } from "@tanstack/charts";
import { d3Curve } from "@tanstack/charts/d3/shape";
import { curveNatural } from "d3-shape";
import { declaredBefore, propsFor } from "../carriers/table";
import type { ChildTable } from "../carriers/table";
import { erase } from "../erased-types";
import type { AnyMark } from "../erased-types";
import { patternPresetTree } from "../markup/patterns";
import { resourceHost, scopeMarkupIds } from "../markup/resources";
import type { MarkupNode } from "../markup/node";
import type { PatternPresetId } from "../pattern/pattern-preset-helpers";
import { scopePaintUrl } from "../resource-ids";
import type { TooltipRange } from "../tooltip/range-rows";
import type { BandFadeEdges, BandProps, BandStrokeProps, DeadlineFillType, DeadlineProps, WeekendsProps } from "../types/range-overlays";
import { bandConfigOf, bandGroupKey } from "./band-config";
import { pushDecorative, yScaleForAxis } from "./build-state";
import { computeWeekendRanges, DEFAULT_WEEKEND_DAYS, toValidDate } from "./date-ranges";
import type { DateRangeAlign } from "./date-ranges";
import type { OverlayDot } from "./hover-overlay";
import { axisId, toDate } from "./series";
import type { Row } from "./series";

const DAY_MS = 86_400_000;
const NO_POINTS: [] = [];
const SERIES_ROLES = ["line", "area", "patternArea", "seriesBar"] as const;
/** Mark id prefixes (renderer `data-ts-key`): the scoped CSS and the composed paint order (composed/series-order.ts) match them. */
export const BAND_KEY = "band:";
export const DEADLINE_KEY = "deadline:";
export const WEEKENDS_KEY = "wkend:";

const finite = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

// --- Band -------------------------------------------------------------------------------------------------------------------------

interface ResolvedStroke {
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly strokeDasharray: string | undefined;
  readonly strokeOpacity: number;
}

/** bklit `resolveEdgeStroke`: `false` hides the edge, an object overrides the shared stroke, a width of 0 hides it. */
function edgeStroke(override: BandStrokeProps | false | undefined, base: ResolvedStroke): ResolvedStroke | null {
  if (override === false) {
    return null;
  }
  const out: ResolvedStroke = {
    stroke: override?.stroke ?? base.stroke,
    strokeWidth: override?.strokeWidth ?? base.strokeWidth,
    strokeDasharray: override?.strokeDasharray ?? base.strokeDasharray,
    strokeOpacity: override?.strokeOpacity ?? base.strokeOpacity,
  };
  return out.strokeWidth > 0 ? out : null;
}

/** The unscoped pattern ids of the overlays' tiles; the defs host scopes them to the chart. */
const bandPatternId = (index: number): string => `band-pattern-${index}`;
const deadlinePatternId = (index: number): string => `deadline-pattern-${index}`;
const weekendsPatternId = (index: number): string => `weekends-pattern-${index}`;

const usesBandPattern = (b: BandProps): boolean => b.fillType === "pattern" && b.pattern !== "none";

export interface RangeBuildInput {
  readonly table: ChildTable;
  /** The rows the series paths draw (decimated, windowed). */
  readonly rows: readonly Row[];
  /** The rows in view, the source of the y domain. */
  readonly valueRows: readonly Row[];
  /** Every row, when `rows` is decimated: the band's focus line then covers them all (bklit hovers every row). */
  readonly focusRows: readonly Row[] | undefined;
  readonly xKey: string;
  readonly uid: string;
  readonly lineY: typeof lineYRaw;
  readonly areaY: typeof areaYRaw;
  readonly tooltipEnabled: boolean;
}

export interface RangeBuild {
  /** Weekends and deadlines: above the grid and Background, beneath every series. */
  readonly underlays: AnyMark[];
  /** Bands declared before the first series (bklit paints children in JSX order). */
  readonly bandsUnder: AnyMark[];
  /** Bands declared after a series. */
  readonly bandsOver: AnyMark[];
  readonly gradients: ChartGradient[];
  /** Band edge values per y axis id: both edges widen the y domain, with or without a `Line`. */
  readonly yValues: ReadonlyMap<string, readonly number[]>;
  /** A band takes the tooltip focus (the crosshair, pill and dots show on a band-only chart). */
  readonly focus: boolean;
  /** The scoped CSS: band fades, deadline fades, the underlays' fade-in. */
  readonly css: (scope: string) => string;
}

interface BandContext {
  readonly input: RangeBuildInput;
  readonly gradients: ChartGradient[];
  readonly out: AnyMark[];
}

/** One band's marks: the fill between the edges, then the lower and the upper edge (bklit's paint order), and its tooltip focus line. */
function bandMarks(b: BandProps, index: number, { input, gradients, out }: BandContext): void {
  const { upperKey, lowerKey } = b;
  const fill = b.fill ?? "var(--chart-line-primary)";
  const curve = d3Curve(b.curve ?? curveNatural);
  const onAxis = yScaleForAxis(b.yAxisId);
  const xOf = (d: Row): Date => toDate(d[input.xKey]);
  const keyOf = (d: Row): number => xOf(d).getTime();
  const upper = (d: Row): number | null => finite(d[upperKey]);
  const lower = (d: Row): number | null => finite(d[lowerKey]);
  // Rows missing an edge are gaps (bklit computeBandSegments ends a segment there); the native area / line skip a null y.
  const defined = (d: Row): boolean => upper(d) !== null && lower(d) !== null;
  const id = `${BAND_KEY}${index}`;
  let paint = fill;
  let opacity = b.fillOpacity ?? 0.15;
  if (usesBandPattern(b)) {
    paint = scopePaintUrl(`url(#${bandPatternId(index)})`, input.uid);
    opacity = b.patternOpacity ?? 1;
  } else if (b.fillType === "gradient") {
    // bklit's userSpaceOnUse gradient spans the band's own pixel extent, which is the area's bounding box: top at `fillOpacity`, bottom at `gradientToOpacity`.
    const gradientId = `${input.uid}-band-${index}`;
    gradients.push({ id: gradientId, x1: 0, y1: 0, x2: 0, y2: 1, stops: [{ offset: 0, color: fill, opacity: b.fillOpacity ?? 0.15 }, { offset: 1, color: fill, opacity: b.gradientToOpacity ?? 0 }] });
    paint = `url(#${gradientId})`;
    opacity = 1;
  }
  pushDecorative(
    out,
    input.areaY(input.rows, erase({
      id: `${id}:fill`,
      ...onAxis,
      x: xOf,
      y1: (d: Row) => (defined(d) ? lower(d) : null),
      y2: (d: Row) => (defined(d) ? upper(d) : null),
      key: keyOf,
      fill: paint,
      fillOpacity: opacity,
      curve,
    })),
  );
  const base: ResolvedStroke = { stroke: b.stroke ?? fill, strokeWidth: b.strokeWidth ?? 1, strokeDasharray: b.strokeDasharray, strokeOpacity: b.strokeOpacity ?? 1 };
  const focus = input.tooltipEnabled && b.showInTooltip !== false;
  const edges = [
    ["lower", lower, edgeStroke(b.lowerStroke, base)],
    ["upper", upper, edgeStroke(b.upperStroke, base)],
  ] as const;
  let focusTaken = false;
  for (const [edge, value, stroke] of edges) {
    if (!stroke) {
      continue;
    }
    // The upper edge is the band's focus source when it is drawn over every row (bklit hovers every row: use-chart-interaction.ts).
    const takesFocus = focus && edge === "upper" && input.focusRows === undefined;
    focusTaken ||= takesFocus;
    const mark = input.lineY(input.rows, erase({
      id: `${id}:${edge}`,
      ...onAxis,
      x: xOf,
      y: (d: Row) => (defined(d) ? value(d) : null),
      key: keyOf,
      ...(takesFocus ? { z: () => bandGroupKey(index) } : null),
      stroke: stroke.stroke,
      strokeWidth: stroke.strokeWidth,
      strokeOpacity: stroke.strokeOpacity,
      strokeDasharray: stroke.strokeDasharray?.replaceAll(",", " "),
      lineCap: "round",
      curve,
    }));
    if (takesFocus) {
      out.push(mark);
    } else {
      pushDecorative(out, mark);
    }
  }
  if (focus && !focusTaken) {
    // An invisible line over every row takes the focus (as an Area without a line does, series-marks.ts `pushFocusOnly`).
    out.push(input.lineY(input.focusRows ?? input.rows, erase({
      id: `${id}:focus`,
      ...onAxis,
      x: xOf,
      y: (d: Row) => (defined(d) ? upper(d) : null),
      z: () => bandGroupKey(index),
      key: keyOf,
      curve,
      stroke: "transparent",
      strokeOpacity: 0,
      strokeWidth: 0,
    })));
  }
}

interface FadeSides {
  readonly top: boolean;
  readonly right: boolean;
  readonly bottom: boolean;
  readonly left: boolean;
}

/** bklit `resolveBandFadeSides`. */
function fadeSides(fade: BandFadeEdges | undefined): FadeSides {
  if (fade === true) {
    return { top: true, right: true, bottom: true, left: true };
  }
  if (fade === "left" || fade === "right") {
    return { top: false, right: fade === "right", bottom: false, left: fade === "left" };
  }
  if (fade && typeof fade === "object") {
    return { top: fade.top === true, right: fade.right === true, bottom: fade.bottom === true, left: fade.left === true };
  }
  return { top: false, right: false, bottom: false, left: false };
}

/** One axis of bklit's band fade mask (`bandFadeStops`): transparent at a faded end, opaque within `size` of it. */
const fadeGradient = (direction: string, start: boolean, end: boolean, size: number): string => {
  const span = Math.min(50, Math.max(0, size * 100));
  return `linear-gradient(${direction},${start ? "transparent" : "#000"} 0%,#000 ${span}%,#000 ${100 - span}%,${end ? "transparent" : "#000"} 100%)`;
};

/** The band's fade as a CSS mask over its marks' boxes: the fill's box is the band's own extent (bklit's vertical fade), its width the plot's (the horizontal one). */
function bandFadeCss(scope: string, b: BandProps, index: number): string {
  const sides = fadeSides(b.fadeEdges);
  const horizontal = sides.left || sides.right;
  const vertical = sides.top || sides.bottom;
  if (!(horizontal || vertical)) {
    return "";
  }
  const size = b.fadeSize ?? 0.15;
  const layers = [
    horizontal ? fadeGradient("to right", sides.left, sides.right, size) : null,
    vertical ? fadeGradient("to bottom", sides.top, sides.bottom, size) : null,
  ].filter(Boolean).join(",");
  const mask = `mask-image:${layers};mask-repeat:no-repeat;mask-origin:fill-box;mask-size:100% 100%;mask-composite:intersect`;
  // The marks sit in their wipe groups (wipe.ts): the area and line groups themselves carry the band's key.
  return `${scope} .ts-chart__marks :is(.ts-chart__area,.ts-chart__line)[data-ts-key^="${BAND_KEY}${index}:"]{${mask}}`;
}

// --- Deadline -------------------------------------------------------------------------------------------------------------------

const DEADLINE_COLOR = "var(--chart-negative, var(--color-red-500))";
const LABEL_INSET = 6;
const LABEL_FLIP_WIDTH = 96;

function deadlineOpacity(fillType: DeadlineFillType): number {
  if (fillType === "pattern") {
    return 0.6;
  }
  return fillType === "gradient" ? 0.25 : 0.12;
}

const usesDeadlinePattern = (d: DeadlineProps): boolean => (d.fillType ?? "pattern") === "pattern" && d.pattern !== "none";

/** The region in plot px: its unclipped data extent (bklit pins the fade and gradient to it, so they stay put while a brushed window pans). */
function regionPx(d: DeadlineProps, x: ResolvedScale, chart: ChartBounds): { readonly x0: number; readonly x1: number } | null {
  const start = toValidDate(d.date);
  if (start === null) {
    return null;
  }
  const end = d.endDate === undefined ? null : toValidDate(d.endDate);
  const x0 = x.map(start) - chart.x;
  const x1 = end === null ? chart.width : x.map(end) - chart.x;
  return Number.isFinite(x0) && Number.isFinite(x1) && x1 > x0 ? { x0, x1 } : null;
}

/** The drawn region of the i-th deadline at the chart's scales: rect, rule and label in svg space. The rect spans the region's whole data
 * extent inside a group clipped to the plot, so its gradient and fade (relative to the rect's box) are fixed per deadline: a pan or a zoom
 * moves the rect and never rewrites a style. */
function deadlineScene(d: DeadlineProps, index: number, uid: string, x: ResolvedScale, chart: ChartBounds): SceneNode[] {
  const region = regionPx(d, x, chart);
  if (!region || chart.width <= 0 || chart.height <= 0) {
    return [];
  }
  const { x0, x1 } = region;
  const fillType = d.fillType ?? "pattern";
  const color = d.color ?? DEADLINE_COLOR;
  const lineVisible = d.showLine !== false && x0 >= 0 && x0 <= chart.width;
  const hasFill = fillType !== "none" && Math.min(chart.width, x1) > Math.max(0, x0);
  const children: SceneNode[] = [];
  if (hasFill) {
    let fill = color;
    if (fillType === "gradient") {
      fill = `url(#${uid}-deadline-${index})`;
    } else if (usesDeadlinePattern(d)) {
      fill = scopePaintUrl(`url(#${deadlinePatternId(index)})`, uid);
    }
    children.push({
      kind: "group",
      key: `${DEADLINE_KEY}${index}:clip`,
      clip: chart,
      children: [{
        kind: "group",
        key: `${DEADLINE_KEY}${index}:region`,
        className: "bkm-dl-region",
        children: [{ kind: "rect", key: `${DEADLINE_KEY}${index}:rect`, x: chart.x + x0, y: chart.y, width: x1 - x0, height: chart.height, style: { fill, opacity: d.fillOpacity ?? deadlineOpacity(fillType) } }],
      }],
    });
  }
  if (lineVisible) {
    const lx = chart.x + x0;
    children.push({
      kind: "rule",
      key: `${DEADLINE_KEY}${index}:line`,
      x1: lx,
      x2: lx,
      y1: chart.y,
      y2: chart.y + chart.height,
      style: { stroke: d.stroke ?? color, strokeWidth: d.strokeWidth ?? 1, strokeOpacity: d.strokeOpacity ?? 1, strokeDasharray: d.strokeDasharray?.replaceAll(",", " ") },
    });
    if (d.label !== undefined && d.label !== "") {
      const flipped = x0 > chart.width - LABEL_FLIP_WIDTH;
      const bottom = d.labelPosition === "bottom";
      children.push({
        kind: "label",
        key: `${DEADLINE_KEY}${index}:label`,
        x: flipped ? lx - LABEL_INSET : lx + LABEL_INSET,
        y: bottom ? chart.y + chart.height - LABEL_INSET : chart.y + LABEL_INSET,
        text: d.label,
        anchor: flipped ? "end" : "start",
        baseline: bottom ? "auto" : "hanging",
        fontSize: 11,
        fontWeight: 500,
        style: { fill: d.labelColor ?? color },
      });
    }
  }
  return children.length === 0 ? [] : [{ kind: "group", key: `${DEADLINE_KEY}${index}`, className: d.className === undefined ? "bkm-deadline" : `bkm-deadline ${d.className}`, ariaHidden: true, children }];
}

function deadlineMark(d: DeadlineProps, index: number, uid: string): AnyMark {
  return erase(createMark<unknown, Date, number>(() => ({
    id: `${DEADLINE_KEY}${index}`,
    channels: {},
    render: ({ scales, chart }) => ({ nodes: scales.x ? deadlineScene(d, index, uid, scales.x, chart) : [], points: NO_POINTS }),
  })));
}

/** The deadline's gradient fill across the region's rect: `color` at its left edge to `gradientToOpacity` (relative to the rect's opacity) at its right. */
function deadlineGradient(d: DeadlineProps, index: number, uid: string): ChartGradient {
  const color = d.color ?? DEADLINE_COLOR;
  const opacity = d.fillOpacity ?? deadlineOpacity("gradient");
  return {
    id: `${uid}-deadline-${index}`,
    x1: 0,
    y1: 0,
    x2: 1,
    y2: 0,
    stops: [{ offset: 0, color, opacity: 1 }, { offset: 1, color, opacity: opacity > 0 ? (d.gradientToOpacity ?? 0) / opacity : 0 }],
  };
}

/** bklit's right-edge fade (`fade`, `fadeLength`) as a mask over the region's rect: opaque to `1 - fadeLength` of it, transparent at its end. */
function deadlineFadeCss(scope: string, d: DeadlineProps, index: number): string {
  const length = Math.min(1, Math.max(0, d.fadeLength ?? 0.5));
  if (d.fade === false || length <= 0) {
    return "";
  }
  return `${scope} [data-ts-key="${DEADLINE_KEY}${index}"] .bkm-dl-region{mask-image:linear-gradient(to right,#000 ${((1 - length) * 100).toFixed(2)}%,transparent 100%);mask-repeat:no-repeat;mask-origin:fill-box;mask-size:100% 100%}`;
}

// --- Weekends -------------------------------------------------------------------------------------------------------------------

/** bklit `resolveAutoAlign`: centred spans when the chart has SeriesBar columns at midnight; noon columns already sit mid-day. */
function resolveAlign(w: WeekendsProps, table: ChildTable, first: Date | undefined): DateRangeAlign {
  const align = w.align ?? "auto";
  if (align !== "auto") {
    return align;
  }
  const hasColumns = propsFor(table, "seriesBar").length > 0;
  if (!(hasColumns && first) || Number.isNaN(first.getTime())) {
    return "calendar";
  }
  const hours = w.utc === true ? first.getUTCHours() : first.getHours();
  const minutes = w.utc === true ? first.getUTCMinutes() : first.getMinutes();
  return hours === 0 && minutes === 0 ? "centered" : "calendar";
}

function weekendsScene(w: WeekendsProps, index: number, uid: string, align: DateRangeAlign, x: ResolvedScale, chart: ChartBounds): SceneNode[] {
  const [lo, hi] = x.domain;
  if (lo === undefined || hi === undefined || chart.width <= 0 || chart.height <= 0) {
    return [];
  }
  const d0 = toDate(lo);
  const d1 = toDate(hi);
  const span = Math.abs(d1.getTime() - d0.getTime());
  if (!(span > 0) || (chart.width * DAY_MS) / span < (w.minDayWidth ?? 2)) {
    return [];
  }
  const fillType = w.fillType ?? "pattern";
  const pattern = fillType === "pattern" && w.pattern !== "none";
  const fill = pattern ? scopePaintUrl(`url(#${weekendsPatternId(index)})`, uid) : (w.fill ?? "var(--chart-foreground-muted)");
  const left = chart.x;
  const right = chart.x + chart.width;
  const rects: SceneNode[] = computeWeekendRanges(d0, d1, { weekendDays: w.weekendDays ?? DEFAULT_WEEKEND_DAYS, utc: w.utc === true, align }).flatMap(({ start, end }) => {
    const a = x.map(start);
    const b = x.map(end);
    const x0 = Math.max(left, Math.min(a, b));
    const x1 = Math.min(right, Math.max(a, b));
    return x1 > x0 ? [{ kind: "rect", key: `${WEEKENDS_KEY}${index}:${start.getTime()}`, x: x0, y: chart.y, width: x1 - x0, height: chart.height, style: { fill } } satisfies SceneNode] : [];
  });
  if (rects.length === 0) {
    return [];
  }
  const opacity = w.fillOpacity ?? (pattern ? 0.45 : 0.08);
  return [{ kind: "group", key: `${WEEKENDS_KEY}${index}`, className: w.className === undefined ? "bkm-weekends" : `bkm-weekends ${w.className}`, ariaHidden: true, style: { opacity }, children: rects }];
}

function weekendsMark(w: WeekendsProps, index: number, uid: string, align: DateRangeAlign): AnyMark {
  return erase(createMark<unknown, Date, number>(() => ({
    id: `${WEEKENDS_KEY}${index}`,
    channels: {},
    render: ({ scales, chart }) => ({ nodes: scales.x ? weekendsScene(w, index, uid, align, scales.x, chart) : [], points: NO_POINTS }),
  })));
}

// --- The build --------------------------------------------------------------------------------------------------------------------

/** The underlays' fade-in, restarted as a loading chart turns ready (they are hidden while it loads). */
const underlayCss = (scope: string): string => {
  const sel = `.ts-chart__marks>:is([data-ts-key^="${WEEKENDS_KEY}"],[data-ts-key^="${DEADLINE_KEY}"])`;
  return `${scope}[data-bkm-status="loading"] ${sel}{opacity:0}${scope}:not([data-bkm-status="loading"]) ${sel}{animation:bkm-refarea-in 420ms ease-out both}`;
};

/** Every Band, Deadline and Weekends child of a chart as marks, with what they add to the domain, the tooltip and the scoped CSS. */
export function buildRangeOverlays(input: RangeBuildInput): RangeBuild {
  const { table, uid } = input;
  const gradients: ChartGradient[] = [];
  const underlays: AnyMark[] = [];
  const bandsUnder: AnyMark[] = [];
  const bandsOver: AnyMark[] = [];
  const yValues = new Map<string, number[]>();
  const cssParts: ((scope: string) => string)[] = [];
  let focus = false;

  const first = input.rows.at(0);
  for (const [i, w] of propsFor<WeekendsProps>(table, "weekends").entries()) {
    underlays.push(weekendsMark(w, i, uid, resolveAlign(w, table, first === undefined ? undefined : toDate(first[input.xKey]))));
  }
  for (const [i, d] of propsFor<DeadlineProps>(table, "deadline").entries()) {
    underlays.push(deadlineMark(d, i, uid));
    if ((d.fillType ?? "pattern") === "gradient") {
      gradients.push(deadlineGradient(d, i, uid));
    }
    cssParts.push((scope) => deadlineFadeCss(scope, d, i));
  }
  if (underlays.length > 0) {
    cssParts.push(underlayCss);
  }

  for (const [i, b] of propsFor<BandProps>(table, "band").entries()) {
    const config = bandConfigOf(b);
    if (!config) {
      continue;
    }
    const list = yValues.get(config.yAxisId) ?? [];
    for (const row of input.valueRows) {
      const hi = finite(row[b.upperKey]);
      const lo = finite(row[b.lowerKey]);
      if (hi !== null && lo !== null) {
        list.push(hi, lo);
      }
    }
    yValues.set(config.yAxisId, list);
    const out = declaredBefore(table, b, SERIES_ROLES) ? bandsUnder : bandsOver;
    bandMarks(b, i, { input, gradients, out });
    focus ||= input.tooltipEnabled && config.showInTooltip;
    cssParts.push((scope) => bandFadeCss(scope, b, i));
  }
  if (propsFor(table, "band").length > 0) {
    // bklit draws a band only in the drawn phases (band.tsx `isBandVisiblePhase`): hidden while the chart loads, revealed with the lines.
    cssParts.push((scope) => `${scope}[data-bkm-status="loading"] .ts-chart__marks [data-ts-key^="${BAND_KEY}"]{opacity:0}`);
  }
  return { underlays, bandsUnder, bandsOver, gradients, yValues, focus, css: (scope) => cssParts.map((part) => part(scope)).join("") };
}

/** The tooltip's band rows: each band's group key in declaration order (after the series rows, as bklit lists them), label, color and edge keys. */
export function rangeTooltipBase(table: ChildTable): { readonly order: string[]; readonly labels: Record<string, string>; readonly colors: Record<string, string>; readonly ranges: Record<string, TooltipRange> } {
  const order: string[] = [];
  const labels: Record<string, string> = {};
  const colors: Record<string, string> = {};
  const ranges: Record<string, TooltipRange> = {};
  for (const [i, b] of propsFor<BandProps>(table, "band").entries()) {
    const config = bandConfigOf(b);
    if (config?.showInTooltip) {
      const key = bandGroupKey(i);
      order.push(key);
      labels[key] = config.label;
      colors[key] = config.color;
      ranges[key] = { upperKey: config.upperKey, lowerKey: config.lowerKey };
    }
  }
  return { order, labels, colors, ranges };
}

/** One tooltip dot per band edge (bklit chart-tooltip.tsx `bandDots`): deduplicated, and skipped where a series already dots that key. */
export function rangeDots(table: ChildTable, seriesKeys: ReadonlySet<string>, shape: { readonly r: number; readonly strokeWidth: number }): OverlayDot[] {
  const seen = new Set<string>();
  const dots: OverlayDot[] = [];
  for (const b of propsFor<BandProps>(table, "band")) {
    const config = bandConfigOf(b);
    if (!config?.showInTooltip) {
      continue;
    }
    for (const key of [config.upperKey, config.lowerKey]) {
      if (seriesKeys.has(key) || seen.has(key)) {
        continue;
      }
      seen.add(key);
      dots.push({
        shapes: [{ r: shape.r, fill: config.color, stroke: "var(--chart-background)", strokeWidth: shape.strokeWidth }],
        glide: true,
        valueOf: (row) => finite(row[key]) ?? undefined,
        yAxis: axisId(config.yAxisId),
      });
    }
  }
  return dots;
}

const patternTile = (preset: PatternPresetId, id: string, color: string, scale: number | undefined, strokeWidth: number | undefined): MarkupNode | undefined =>
  patternPresetTree(preset, id, { color, scale, strokeWidth });

/** The overlays' pattern tiles (bands with `fillType="pattern"`, deadlines and weekends with their striped default) in the chart's defs host. */
export function rangeResources(table: ChildTable, uid: string): MarkupNode | null {
  const tiles: MarkupNode[] = [];
  for (const [i, b] of propsFor<BandProps>(table, "band").entries()) {
    const tile = usesBandPattern(b) ? patternTile(b.pattern ?? "diagonal", bandPatternId(i), b.patternColor ?? b.fill ?? "var(--chart-line-primary)", b.patternScale, b.patternStrokeWidth) : undefined;
    if (tile) {
      tiles.push(tile);
    }
  }
  for (const [i, d] of propsFor<DeadlineProps>(table, "deadline").entries()) {
    const tile = usesDeadlinePattern(d) ? patternTile(d.pattern ?? "diagonal", deadlinePatternId(i), d.color ?? DEADLINE_COLOR, d.patternScale ?? 1.5, d.patternStrokeWidth ?? 1) : undefined;
    if (tile) {
      tiles.push(tile);
    }
  }
  for (const [i, w] of propsFor<WeekendsProps>(table, "weekends").entries()) {
    const pattern = (w.fillType ?? "pattern") === "pattern" && w.pattern !== "none";
    const tile = pattern ? patternTile(w.pattern ?? "diagonal", weekendsPatternId(i), w.fill ?? "var(--chart-foreground-muted)", w.patternScale ?? 1.5, w.patternStrokeWidth ?? 1) : undefined;
    if (tile) {
      tiles.push(tile);
    }
  }
  // Scoped with the chart's uid, as the paints above are (`scopePaintUrl`); the host's own id is distinct from the other defs hosts'.
  return tiles.length === 0 ? null : resourceHost(`${uid}-range`, scopeMarkupIds(tiles, uid));
}
