import { dot } from "@tanstack/charts";
import type { areaY as areaYRaw, lineY as lineYRaw } from "@tanstack/charts";
import { d3Curve } from "@tanstack/charts/d3/shape";
import { isGradientRef } from "../gradients";
import { keyAttr, pushDecorative, yScaleOf } from "./build-state";
import type { AnyMark } from "../erased-types";
import type { BuildState } from "./build-state";
import { toNumber } from "./domains";
import { erase } from "../erased-types";
import type { CartesianInput } from "./input";
import type { AreaSeries, ResolvedSeries, Row } from "./series";
import { CLS, keyHas, keyIs, keyStarts } from "../renderer-dom";
import { horizontalPaint, resolveFadeZones } from "./stroke-paint";
import type { HorizontalPaint } from "./stroke-paint";
import { highlightBands } from "../markup/band-clip";
import { decorative } from "@tanstack/charts/mark/decorative";
import { markRendererOption, onCanvas } from "../canvas/renderer";
import type { HoverDimRule } from "./hover-css";
import type { HighlightBand } from "../markup/band-clip";

export const MARKER_BUCKETS = 12;
const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));
// Pixel rise given to a flat line: path coordinates are serialised to 3 decimals, so this is the smallest non-zero bounding box.
const FLAT_LINE_RISE_PX = 0.002;

export interface SeriesContext {
  readonly input: CartesianInput;
  readonly rows: readonly Row[];
  /** The rows the point markers draw: `rows` clipped to the brushed window (paths draw past it, under the clip). */
  readonly markerRows: readonly Row[];
  /** Every row, only when `rows` is decimated: bklit hovers on every row (use-chart-interaction.ts:81, data = visiblePlotData), so a hidden full-row line takes the focus. */
  readonly focusRows?: readonly Row[];
  readonly yDomains: ReadonlyMap<string, readonly [number, number]>;
  readonly fadeDomain: [Date, Date] | undefined;
  readonly xAccessor: (d: Row) => Date;
  readonly keyOf: (d: Row) => number;
  readonly lineY: typeof lineYRaw;
  readonly areaY: typeof areaYRaw;
  readonly tooltipEnabled: boolean;
  readonly state: BuildState;
  /** With a `renderer={canvasRenderer}` series: its drawn marks, gathered so the chart has one canvas layer (`pushSeriesMarks` places them),
   * after its glows (the first `glows`), which stay SVG (a CSS blur) under them. */
  readonly canvas?: { readonly marks: AnyMark[]; glows: number };
}

/** A series' drawn mark (fill, glow, line, focus line): with the series on canvas, the mark paints there and joins the canvas run; else it
 * goes where it is drawn, as a decorative mark when `asDecorative`. */
function pushDrawn(ctx: SeriesContext, s: ResolvedSeries, mark: AnyMark, asDecorative: boolean): void {
  (onCanvas(s.renderer) && ctx.canvas ? ctx.canvas.marks : ctx.state.marks).push(asDecorative ? decorative(mark) : mark);
}

/** The path of an invisible focus line (`${id}:focus`): its points are the focus source, its path is never seen (transparent, 0 wide),
 * so it is one moveto instead of every row's curve (2.4 MB of path data at 50,000 rows, which the browser hit-tests on every pointer move). */
const FOCUS_ONLY_CURVE: ReturnType<typeof d3Curve> = { line: () => "M0,0", area: () => "M0,0" };

/** A gradient's stops as the series paints them: a canvas renderer's own (`paintStops`, core/canvas/mark-renderer.ts), else as they are. */
const paintStops = <T extends { readonly opacity: number }>(s: ResolvedSeries, stops: T[]): T[] => (onCanvas(s.renderer) ? s.renderer.paintStops(stops) : stops);

/** A canvas series' hover dim: the canvas is one element, so its series dim together (the last one's opacity), and never by legend row. */
const canvasDim = (s: ResolvedSeries): HoverDimRule => ({ select: CLS.canvas, opacity: dimOpacityOf(s) });

// bklit passes dimOpacity 0.3 from Line (or its `highlight.dimOpacity`) and 0.6 from Area (SeriesHoverDim default 0.5 is unused by either).
const dimOpacityOf = (s: ResolvedSeries): number => s.dimOpacity;

/** styles.css masks `:fill:fade*` ids with bklit's 0/15/85/100% horizontal edge fade; `{ left, right }` zones get their own mask (`:fade-c`, a scoped rule). */
function fadeSuffix(fadeEdges: ResolvedSeries["fadeEdges"]): string {
  if (!fadeEdges) {
    return "";
  }
  if (typeof fadeEdges === "object") {
    return resolveFadeZones(fadeEdges) ? ":fade-c" : "";
  }
  if (fadeEdges === "left") {
    return ":fade-left";
  }
  return fadeEdges === "right" ? ":fade-right" : ":fade";
}

/** The `:fade-c` mask of an area whose fade zones are its own (`fadeEdges={{ left, right }}`). */
function customFadeMask(fadeEdges: ResolvedSeries["fadeEdges"]): string | undefined {
  const zones = typeof fadeEdges === "object" ? resolveFadeZones(fadeEdges) : null;
  if (!zones) {
    return undefined;
  }
  const pct = (n: number): string => `${Math.round(n * 10_000) / 100}%`;
  const image = `linear-gradient(to right,${zones.left > 0 ? "transparent" : "#000"} 0%,#000 ${pct(zones.left)},#000 ${pct(1 - zones.right)},${zones.right > 0 ? "transparent" : "#000"} 100%)`;
  return `-webkit-mask-image:${image};mask-image:${image}`;
}

/** bklit `areaVerticalFadeStops` (fade-edges.ts): `fadeBottom` fades the bottom N% to nothing, else the gradient reaches `gradientToOpacity` at `gradientSpan` and holds it. */
export function areaVerticalStops(topOpacity: number, gradientToOpacity: number, gradientSpan: number | undefined, fadeBottom: number | undefined): { offset: number; opacity: number }[] {
  if (fadeBottom !== undefined) {
    const zone = Math.min(100, Math.max(0, fadeBottom)) / 100;
    if (zone <= 0) {
      return [{ offset: 0, opacity: topOpacity }, { offset: 1, opacity: topOpacity }];
    }
    return zone >= 1 ? [{ offset: 0, opacity: topOpacity }, { offset: 1, opacity: 0 }] : [{ offset: 0, opacity: topOpacity }, { offset: 1 - zone, opacity: topOpacity }, { offset: 1, opacity: 0 }];
  }
  const span = Math.min(1, Math.max(0.01, gradientSpan ?? 1));
  const stops = [{ offset: 0, opacity: topOpacity }, { offset: span, opacity: gradientToOpacity }];
  if (span < 1) {
    stops.push({ offset: 1, opacity: gradientToOpacity });
  }
  return stops;
}

function areaFill(ctx: SeriesContext, area: ResolvedSeries & AreaSeries): string {
  if (isGradientRef(area.fill)) {
    // bklit `fill="url(#x)"`: the user's own <LinearGradient id="x"> resource (see gradients.ts).
    return area.fill;
  }
  const id = `${ctx.input.uid}-${area.pattern ? "pattern" : "area"}-${area.index}`;
  if (area.pattern) {
    // No <pattern> support in chart gradients: paint solid and let styles.css mask it into hatching; a `fillOpacity` or `fadeBottom` paints the hatch with bklit's vertical fade.
    if (area.fillOpacity === 1 && !(area.fadeBottom !== undefined && area.fadeBottom > 0)) {
      return area.pattern.color;
    }
    ctx.state.gradients.push({ id, x1: 0, y1: 0, x2: 0, y2: 1, stops: areaVerticalStops(area.fillOpacity, area.fillOpacity, 1, area.fadeBottom).map((stop) => ({ ...stop, color: area.pattern?.color ?? area.fill })) });
    return `url(#${id})`;
  }
  ctx.state.gradients.push({
    id,
    x1: 0,
    y1: 0,
    x2: 0,
    y2: 1,
    stops: paintStops(area, areaVerticalStops(area.fillOpacity, area.gradientToOpacity ?? 0, area.gradientSpan, area.fadeBottom).map((stop) => ({ ...stop, color: area.fill }))),
  });
  return `url(#${id})`;
}

function pushAreaFill(ctx: SeriesContext, s: ResolvedSeries, area: ResolvedSeries & AreaSeries): void {
  const curve = d3Curve(s.curve);
  const baseline = ctx.yDomains.get(s.yAxisId)?.[0] ?? 0;
  const fill = areaFill(ctx, area);
  // A pattern's hatch is the group's own mask, so its edge fade masks the path inside instead (styles.css `:fill:pfade`).
  const pattern = s.kind === "pattern";
  const fillId = `${s.id}:fill${pattern ? fadeSuffix(area.fadeEdges).replace(":fade", ":pfade") : fadeSuffix(area.fadeEdges)}`;
  const mask = customFadeMask(area.fadeEdges);
  if (mask !== undefined) {
    // As styles.css matches the preset fades: the area group's key ends with the mark id (a pattern's: the path inside it).
    ctx.state.styles.push({ select: `.ts-chart__area[data-ts-key$="${keyAttr(fillId)}"]${pattern ? " > path" : ""}`, css: mask });
  }
  pushDrawn(
    ctx,
    s,
    ctx.areaY(ctx.rows, {
      id: fillId,
      ...yScaleOf(s),
      ...(s.kind === "pattern" ? {} : markRendererOption(s.renderer)),
      x: ctx.xAccessor,
      y1: baseline,
      y2: (d: Row): number => toNumber(d[s.dataKey]),
      fill,
      fillOpacity: 1,
      curve,
      key: ctx.keyOf,
    }),
    true,
  );
  if (s.kind !== "pattern") {
    ctx.state.hoverDim.push(onCanvas(s.renderer) ? canvasDim(s) : { select: `g${keyStarts(`${keyAttr(s.id)}:fill`)}`, opacity: dimOpacityOf(s), series: s.index, legendOpacity: dimOpacityOf(s) });
  }
}

/** The line's stroke paint and opacity: a ProfitLossLine is one sign colour or a gradient with a hard step at the zero crossing. */
interface LinePaint {
  readonly stroke: string;
  readonly plOpacity: number;
}

function profitLossStroke(ctx: SeriesContext, s: ResolvedSeries): LinePaint {
  const { profitLoss } = s;
  if (!profitLoss) {
    return { stroke: s.stroke, plOpacity: 1 };
  }
  const { state, input } = ctx;
  const hoveredSign = input.profitLossHovered ?? null;
  const signOpacity = (sign: 0 | 1): number => (hoveredSign !== null && hoveredSign !== sign ? 0.25 : 1);
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const row of ctx.rows) {
    const v = toNumber(row[s.dataKey]);
    if (Number.isFinite(v)) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  const lineGroup = `g${keyStarts(`${keyAttr(s.id)}:`)}:not(${keyStarts(`${keyAttr(s.id)}:hl`)}):not(${keyStarts(`${keyAttr(s.id)}:fill`)}):not(${keyIs(`${keyAttr(s.id)}:dot`)})`;
  if (hi <= 0) {
    state.plRules.push({ kind: "dim", select: lineGroup, sign: 1 });
    return { stroke: profitLoss.negative, plOpacity: signOpacity(1) };
  }
  if (lo >= 0) {
    state.plRules.push({ kind: "dim", select: lineGroup, sign: 0 });
    return { stroke: profitLoss.positive, plOpacity: signOpacity(0) };
  }
  // Vertical stroke gradient across the path's own bbox: hard colour step at the zero crossing.
  const id = `${input.uid}-pl-${s.index}`;
  const zero = hi / (hi - lo);
  state.gradients.push({
    id,
    x1: 0,
    y1: 0,
    x2: 0,
    y2: 1,
    stops: [
      { offset: 0, color: profitLoss.positive, opacity: signOpacity(0) },
      { offset: zero, color: profitLoss.positive, opacity: signOpacity(0) },
      { offset: zero, color: profitLoss.negative, opacity: signOpacity(1) },
      { offset: 1, color: profitLoss.negative, opacity: signOpacity(1) },
    ],
  });
  state.plRules.push({ kind: "stops", gradient: id });
  return { stroke: `url(#${id})`, plOpacity: 1 };
}

type Paint = (part: readonly Row[], id: string) => string;

/** A line's horizontal paint (bklit's edge fade and `strokeGradient`, pinned to the plot viewport, userSpaceOnUse); native gradients are bbox-relative, so the
 * stops are re-expressed in the x extent of the rows each mark draws (a projection widens the domain; a dashed line is two marks with their own bbox). */
interface GradientPaint {
  readonly paintFor: Paint;
  readonly lineValue: (d: Row) => number;
}

function gradientPaint(ctx: SeriesContext, s: ResolvedSeries, paint: HorizontalPaint, yValue: (d: Row) => number): GradientPaint {
  const { input, rows } = ctx;
  const [d0, d1] = ctx.fadeDomain ?? [new Date(0), new Date(1)];
  let vLo = Number.POSITIVE_INFINITY;
  let vHi = Number.NEGATIVE_INFINITY;
  let lastRow: Row | undefined;
  for (const row of rows) {
    const v = toNumber(row[s.dataKey]);
    if (Number.isFinite(v)) {
      vLo = Math.min(vLo, v);
      vHi = Math.max(vHi, v);
      lastRow = row;
    }
  }
  let lineValue = yValue;
  // A flat line has a zero-height bounding box, which an objectBoundingBox gradient cannot paint (bklit's userSpaceOnUse
  // paint draws it): give it a sub-pixel rise, as the sankey flat flows do.
  if (vLo === vHi && lastRow !== undefined) {
    const [yLo, yHi] = ctx.yDomains.get(s.yAxisId) ?? [0, 100];
    const rise = ((yHi - yLo) * FLAT_LINE_RISE_PX) / Math.max(1, input.plotHeight ?? 200);
    lineValue = (d: Row): number => yValue(d) + (d === lastRow ? rise : 0);
  }
  const spanD = d1.getTime() - d0.getTime();
  const paintFor: Paint = (part, id) => {
    let tLo = Number.POSITIVE_INFINITY;
    let tHi = Number.NEGATIVE_INFINITY;
    for (const row of part) {
      if (Number.isFinite(toNumber(row[s.dataKey]))) {
        const t = ctx.keyOf(row);
        tLo = Math.min(tLo, t);
        tHi = Math.max(tHi, t);
      }
    }
    const spanL = tHi - tLo;
    const stops: { offset: number; color: string; opacity: number }[] = [];
    if (spanD > 0 && spanL > 0 && Number.isFinite(spanL)) {
      const pAt = (o: number): number => (tLo + o * spanL - d0.getTime()) / spanD;
      const oAt = (p: number): number => (d0.getTime() + p * spanD - tLo) / spanL;
      const first = paint.at(clamp01(pAt(0)));
      stops.push({ offset: 0, color: first.color, opacity: first.opacity });
      for (const v of paint.stops) {
        const o = oAt(v.offset);
        if (o > 1e-6 && o < 1 - 1e-6) {
          stops.push({ offset: o, color: v.color, opacity: v.opacity });
        }
      }
      const last = paint.at(clamp01(pAt(1)));
      stops.push({ offset: 1, color: last.color, opacity: last.opacity });
    } else {
      for (const v of paint.stops) {
        stops.push({ offset: v.offset, color: v.color, opacity: v.opacity });
      }
    }
    ctx.state.gradients.push({ id, x1: 0, y1: 0, x2: 1, y2: 0, stops: paintStops(s, stops) });
    return `url(#${id})`;
  };
  return { paintFor, lineValue };
}

/** Row index the dashed tail starts from, when it falls inside the data. */
function dashedAt(ctx: SeriesContext, s: ResolvedSeries): number | undefined {
  return s.dashFromIndex !== undefined && s.dashFromIndex > 0 && s.dashFromIndex < ctx.input.data.length ? s.dashFromIndex : undefined;
}

interface DashSplit {
  readonly head: readonly Row[];
  readonly tail: readonly Row[];
}

/** The rows up to and from the dash row (kept in both so the halves join); undecimated, the full data is split by index. */
function splitAtDash(ctx: SeriesContext, dashAt: number): DashSplit {
  const { data } = ctx.input;
  if (!ctx.focusRows) {
    return { head: data.slice(0, dashAt + 1), tail: data.slice(dashAt) };
  }
  const at = ctx.keyOf(data[dashAt] ?? {});
  return { head: ctx.rows.filter((r) => ctx.keyOf(r) <= at), tail: ctx.rows.filter((r) => ctx.keyOf(r) >= at) };
}

/** The y accessor of a series' line marks (a flat painted line rises a hair) and its stroke paint for a run of rows. */
interface SeriesStroke {
  readonly paintFor: Paint;
  readonly lineValue: (d: Row) => number;
}

function linePaintOf(ctx: SeriesContext, s: ResolvedSeries, stroke: string): SeriesStroke {
  const yValue = (d: Row): number => toNumber(d[s.dataKey]);
  const paint = s.profitLoss ? null : horizontalPaint(stroke, s.strokeGradient, s.fadeEdges);
  return paint ? gradientPaint(ctx, s, paint, yValue) : { paintFor: () => stroke, lineValue: yValue };
}

/** bklit line.tsx glow: a blurred copy of the stroke behind the line (`feGaussianBlur` there; a CSS blur here, the same Gaussian), dimmed with it on hover. */
function pushGlow(ctx: SeriesContext, s: ResolvedSeries, common: Readonly<Record<string, unknown>>, paintFor: Paint, lineId: string): void {
  const { glow } = s;
  if (!glow) {
    return;
  }
  const id = `${s.id}:glow`;
  // The line group's key is the mark id and its z group (`line:k:glow:string:…`).
  ctx.state.styles.push({ select: `g${keyStarts(`${keyAttr(id)}:`)}`, css: `filter:blur(${glow.blur}px)` });
  const mark = decorative(ctx.lineY(ctx.rows, erase({ ...common, id, stroke: paintFor(ctx.rows, `${lineId}-glow`), strokeWidth: glow.strokeWidth, strokeOpacity: glow.opacity })));
  // On a canvas series the glow stays an SVG path (the blur is CSS), under the canvas run.
  if (onCanvas(s.renderer) && ctx.canvas) {
    ctx.canvas.marks.splice(ctx.canvas.glows++, 0, mark);
  } else {
    ctx.state.marks.push(mark);
  }
}

function pushLine(ctx: SeriesContext, s: ResolvedSeries): number | undefined {
  const { input, rows, state } = ctx;
  const curve = d3Curve(s.curve);
  const { stroke, plOpacity } = profitLossStroke(ctx, s);
  const { paintFor, lineValue } = linePaintOf(ctx, s, stroke);
  const dashAt = dashedAt(ctx, s);
  const common = {
    ...yScaleOf(s),
    x: ctx.xAccessor,
    y: lineValue,
    z: (): string => s.dataKey,
    key: ctx.keyOf,
    strokeWidth: s.strokeWidth,
    curve,
    strokeOpacity: plOpacity,
  };
  const lineId = `${input.uid}-line-${s.kind}-${s.index}`;
  pushGlow(ctx, s, common, paintFor, lineId);
  if (onCanvas(s.renderer)) {
    state.hoverDim.push(canvasDim(s));
  }
  state.hoverDim.push({ select: `g${keyStarts(`${keyAttr(s.id)}:`)}:not(${keyStarts(`${keyAttr(s.id)}:hl`)}):not(${keyStarts(`${keyAttr(s.id)}:fill`)}):not(${keyIs(`${keyAttr(s.id)}:dot`)}):not(${keyStarts(`${keyAttr(s.id)}:active-`)}):not(${keyHas(":marker")})`, opacity: dimOpacityOf(s), series: s.index, legendOpacity: dimOpacityOf(s) });
  // Decimated: the drawn line is decorative and `${id}:focus` (every row, invisible) is the focus source.
  const pushLineMark = (mark: AnyMark): void => {
    pushDrawn(ctx, s, mark, ctx.focusRows !== undefined);
  };
  const drawn = { ...common, ...markRendererOption(s.renderer) };
  if (dashAt === undefined) {
    pushLineMark(ctx.lineY(rows, { id: s.id, ...drawn, stroke: paintFor(rows, lineId) }));
  } else {
    // bklit draws the whole (decimated) path and dashes it from `data[dashFromIndex]` (area.tsx:252-276): split the drawn rows at that row, shared by both halves.
    const { head, tail } = splitAtDash(ctx, dashAt);
    pushLineMark(ctx.lineY(head, { id: s.id, ...drawn, stroke: paintFor(head, lineId) }));
    pushLineMark(
      ctx.lineY(tail, {
        id: `${s.id}:tail`,
        ...drawn,
        stroke: paintFor(tail, `${lineId}-tail`),
        strokeDasharray: s.dashArray.replace(",", " "),
      }),
    );
  }
  if (ctx.focusRows !== undefined) {
    pushDrawn(ctx, s, ctx.lineY(ctx.focusRows, erase({ id: `${s.id}:focus`, ...drawn, curve: FOCUS_ONLY_CURVE, stroke: "transparent", strokeOpacity: 0, strokeWidth: 0 })), false);
  }
  if (s.loading && s.loading.style !== "sweep") {
    // The pulse overlay is a second, decorative line over the real one (bklit line.tsx LineLoadingOverlays); loading-css.ts animates it.
    pushDecorative(state.marks, ctx.lineY(rows, erase({ id: `${s.id}:loading`, ...common, stroke: s.loading.stroke, strokeOpacity: 1 })));
  }
  return dashAt;
}

function pushPointMarkers(ctx: SeriesContext, s: ResolvedSeries): void {
  const { markerRows: rows, state } = ctx;
  // bklit SeriesMarkersDimWrapper: a focused point or another hovered legend row dims the markers (0.15s transition in styles.css).
  const mk = s.marker;
  state.hoverDim.push({
    select: `g${keyStarts(`${keyAttr(s.id)}:marker`)}`,
    opacity: mk.fadeOnHover ? mk.inactiveOpacity : 1,
    series: s.index,
    legendOpacity: mk.fadeOnHover ? mk.inactiveOpacity : 1,
    marker: { opacity: mk.fadeOnHover ? mk.inactiveOpacity : 1, blur: mk.fadeOnHover ? mk.inactiveBlur : 0, enterBlur: mk.enterBlur, animate: mk.animate },
  });
  // bklit MarkerCircles (series-point-marker.tsx:55-91): optional outline, filled core, outer ring at radius + ringGap + strokeWidth / 2.
  const r = mk.radius;
  const xy = { ...yScaleOf(s), x: ctx.xAccessor, y: (d: Row): number => toNumber(d[s.dataKey]), key: ctx.keyOf };
  // bklit reveals each marker (0.5s fade, 2px blur) as the line's clip sweep reaches it; `decorative()` strips the datum from the motion context, so markers go in x-ordered buckets
  // that styles.css `bkm-mk-in` staggers (bucket i of MARKER_BUCKETS at i/MARKER_BUCKETS of the entrance, `--bkm-mk` written per bucket id by host-style markerStagger).
  const bucketCount = Math.max(1, Math.min(MARKER_BUCKETS, rows.length));
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const part = rows.slice(Math.floor((bucket * rows.length) / bucketCount), Math.floor(((bucket + 1) * rows.length) / bucketCount));
    if (mk.outlineWidth > 0) {
      const ringOuter = mk.strokeWidth > 0 ? r + mk.ringGap + mk.strokeWidth : r;
      pushDecorative(state.marks, dot(part, erase({ ...xy, id: `${s.id}:marker-out:${bucket}`, r: ringOuter + mk.outlineWidth / 2, fill: "none", stroke: mk.outlineColor, strokeWidth: mk.outlineWidth })));
    }
    if (mk.strokeWidth > 0) {
      pushDecorative(state.marks, dot(part, erase({ ...xy, id: `${s.id}:marker-ring:${bucket}`, r: r + mk.ringGap + mk.strokeWidth / 2, fill: "none", stroke: mk.stroke, strokeWidth: mk.strokeWidth })));
    }
    pushDecorative(state.marks, dot(part, erase({ ...xy, id: `${s.id}:marker:${bucket}`, r, fill: mk.fill })));
  }
}

// Hover highlight (bklit HighlightSegment): the same path re-stroked at full opacity, clipped to the band `--bkm-hl0/1` (`hoverStaticCss` styles) that the focus (hover) or drag (selection) sync writes,
// so neither re-resolves the definition. Always present (transparent when idle) so toggling never re-mounts. `highlight` styles it: its colour or ramp, width, a glow
// behind it (a blurred copy, clipped to the same band), soft ends (a mask, not a clip: core/markup/band-clip.ts) and a wider span (its own band).
function pushHighlight(ctx: SeriesContext, s: ResolvedSeries, dashAt: number | undefined): void {
  const hlRows = dashAt === undefined ? ctx.rows : ctx.input.data.slice(0, dashAt + 1);
  const hl = s.highlight;
  ctx.state.hoverHighlights.push({ select: `path${keyStarts(`${keyAttr(s.id)}:hl`)}`, span: hl?.span ?? 1, fade: hl?.fadeLength ?? 0 });
  const yScale = yScaleOf(s);
  const curve = d3Curve(s.curve);
  const color = hl?.stroke ?? s.stroke;
  const paint = hl?.gradient === undefined ? null : horizontalPaint(color, hl.gradient, false);
  const { paintFor, lineValue } = paint ? gradientPaint(ctx, s, paint, (d: Row): number => toNumber(d[s.dataKey])) : { paintFor: (): string => color, lineValue: (d: Row): number => toNumber(d[s.dataKey]) };
  const stroke = paintFor(hlRows, `${ctx.input.uid}-hl-${s.kind}-${s.index}`);
  const base = { ...yScale, x: ctx.xAccessor, y: lineValue, key: ctx.keyOf, stroke, curve };
  if (hl?.glow) {
    const id = `${s.id}:hl-glow`;
    ctx.state.styles.push({ select: `path${keyStarts(keyAttr(id))}`, css: `filter:blur(${hl.glow.blur}px)` });
    pushDecorative(ctx.state.marks, ctx.lineY(hlRows, erase({ ...base, id, strokeWidth: hl.glow.strokeWidth, strokeOpacity: hl.glow.opacity })));
  }
  pushDecorative(ctx.state.marks, ctx.lineY(hlRows, erase({ ...base, id: `${s.id}:hl`, strokeWidth: hl?.strokeWidth ?? s.strokeWidth })));
}

const isAreaLike = (s: ResolvedSeries): s is ResolvedSeries & AreaSeries => s.kind === "area" || s.kind === "pattern";

/** An area-like series without a line (and every pattern area) draws no line, so no markers or highlight. */
const drawsLine = (s: ResolvedSeries): boolean => !isAreaLike(s) || (s.kind !== "pattern" && s.showLine);

/** The series gets a hover highlight path (`hasHighlight`: with or without a tooltip). */
export const drawsHighlight = (s: ResolvedSeries): boolean => drawsLine(s) && s.showHighlight && !s.profitLoss;

/** The wider or soft-ended highlight bands the series draw (core/markup/band-clip.ts hosts one clip or mask each). */
export const seriesHighlightBands = (series: readonly ResolvedSeries[]): HighlightBand[] =>
  highlightBands(series.filter(drawsHighlight).map((s) => ({ span: s.highlight?.span ?? 1, fade: s.highlight?.fadeLength ?? 0 })));

/** An Area with `showLine={false}` draws no line, and the line is a series' focus source: an invisible line over its rows takes the focus instead, since bklit's
 * tooltip is chart-level and hovers the rows whatever the series draws (use-chart-interaction.ts:81). No highlight or markers: `drawsLine` keeps them off. */
function pushFocusOnly(ctx: SeriesContext, s: ResolvedSeries): void {
  pushDrawn(ctx, s, ctx.lineY(ctx.focusRows ?? ctx.rows, erase({
    id: `${s.id}:focus`,
    ...yScaleOf(s),
    ...markRendererOption(s.renderer),
    x: ctx.xAccessor,
    y: (d: Row): number => toNumber(d[s.dataKey]),
    z: (): string => s.dataKey,
    key: ctx.keyOf,
    curve: FOCUS_ONLY_CURVE,
    stroke: "transparent",
    strokeOpacity: 0,
    strokeWidth: 0,
  })), false);
}

/** Appends every series' marks (area fill, line, loading overlay, markers, highlight) in series order. With a `renderer={canvasRenderer}` series,
 * the canvas series' drawn marks go first, in series order, then everything else in its order: TanStack gives each run of canvas marks its
 * own layer (five full-size canvases), so the chart keeps one. The paint order changes only where a canvas series' line would have covered
 * an earlier series' markers or hover highlight. */
export function pushSeriesMarks(context: SeriesContext): void {
  const canvas = context.input.series.some((s) => onCanvas(s.renderer)) ? { marks: [], glows: 0 } : undefined;
  const ctx: SeriesContext = canvas ? { ...context, canvas } : context;
  const start = ctx.state.marks.length;
  for (const s of ctx.input.series) {
    if (isAreaLike(s)) {
      pushAreaFill(ctx, s, s);
    }
    if (!drawsLine(s)) {
      if (s.kind === "area" && ctx.tooltipEnabled) {
        pushFocusOnly(ctx, s);
      }
      continue;
    }
    const dashAt = pushLine(ctx, s);
    if (s.showMarkers) {
      pushPointMarkers(ctx, s);
    }
    if (drawsHighlight(s)) {
      pushHighlight(ctx, s, dashAt);
    }
  }
  if (canvas) {
    ctx.state.marks.splice(start, 0, ...canvas.marks);
  }
}
