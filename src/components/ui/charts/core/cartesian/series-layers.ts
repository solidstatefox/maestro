import { createMark } from "@tanstack/charts";
import type { ChartBounds, ChartGradient, ChartGradientStop, ResolvedScale, SceneNode } from "@tanstack/charts";
import { curveNatural, line as d3Line } from "d3-shape";
import type { CurveFactory } from "d3-shape";
import { computeTrendSegment } from "../analytics/trend";
import type { TrendPoint } from "../analytics/trend";
import { propsFor } from "../carriers/table";
import type { ChildTable } from "../carriers/table";
import { erase } from "../erased-types";
import type { AnyMark } from "../erased-types";
import { DEFAULT_LINE_STROKE } from "../theme";
import type { LineBackdropProps, LineBackdropStop, TrendLineProps } from "../types/cartesian";
import { toNumber } from "./domains";
import { axisId, DEFAULT_Y_AXIS_ID } from "./series";
import type { Row } from "./series";

/** What a layer is built from: the drawn rows, the plot and the y domains of one cartesian build. */
export interface SeriesLayerContext {
  readonly table: ChildTable;
  readonly rows: readonly Row[];
  readonly xAccessor: (d: Row) => Date;
  readonly uid: string;
  readonly plotWidth: number;
  readonly plotHeight: number;
  readonly yDomains: ReadonlyMap<string, readonly [number, number]>;
  readonly gradients: ChartGradient[];
}

type Scene = { nodes: SceneNode[]; points: [] };
const EMPTY: Scene = { nodes: [], points: [] };
/** Class of a layer held back until the reveal lands, then faded in (styles.css); a trend line fades in from the reveal's start (`bkm-trend-in`). */
const LAYER_IN = "bkm-layer-in";
// A speck that pins the region's bounding box (0.01 px square, under the plot clip when outside it).
const SPECK = 0.01;
// A segment's pixel rise when it is level: an objectBoundingBox gradient needs a bbox with height (path coordinates keep 3 decimals).
const LEVEL_RISE = 0.002;

const yScaleIn = (scales: Readonly<Record<string, ResolvedScale>>, yAxisId: string | number | undefined): ResolvedScale | undefined => {
  const id = axisId(yAxisId);
  return (id === DEFAULT_Y_AXIS_ID ? scales.y : scales[`y:${id}`]) ?? scales.y;
};

const round3 = (n: number): string => String(Math.round(n * 1000) / 1000);

// ---------------------------------------------------------------------------------------------------------------------------------------
// LineBackdrop
// ---------------------------------------------------------------------------------------------------------------------------------------

const DEFAULT_BACKDROP_STOPS: readonly LineBackdropStop[] = [
  { offset: 0, color: DEFAULT_LINE_STROKE, opacity: 0.35 },
  { offset: 1, color: DEFAULT_LINE_STROKE, opacity: 0 },
];

/** The box B (plot px, origin at the plot's top-left) and the circle of the ellipse in B's units. */
interface BackdropBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
}

/** B: the box over the plot and the ellipse, widened on one axis to the ellipse's aspect ratio (so its radius is one in B's units). */
export function backdropBox(width: number, height: number, center: { readonly x: number; readonly y: number }, radius: { readonly x: number; readonly y: number }): BackdropBox | null {
  const cx = width * center.x;
  const cy = height * center.y;
  const rx = Math.max(1, width * radius.x);
  const ry = Math.max(1, height * radius.y);
  let x0 = Math.min(0, cx - rx);
  let x1 = Math.max(width, cx + rx);
  let y0 = Math.min(0, cy - ry);
  let y1 = Math.max(height, cy + ry);
  const aspect = ry / rx;
  if ((y1 - y0) / (x1 - x0) < aspect) {
    const grow = (x1 - x0) * aspect - (y1 - y0);
    y0 -= grow / 2;
    y1 += grow / 2;
  } else {
    const grow = (y1 - y0) / aspect - (x1 - x0);
    x0 -= grow / 2;
    x1 += grow / 2;
  }
  const w = x1 - x0;
  const h = y1 - y0;
  if (!(w > 0 && h > 0 && Number.isFinite(w) && Number.isFinite(h))) {
    return null;
  }
  return { x: x0, y: y0, w, h, cx: (cx - x0) / w, cy: (cy - y0) / h, r: rx / w };
}

function backdropMark(props: Readonly<LineBackdropProps>, index: number, ctx: SeriesLayerContext): AnyMark | null {
  const box = backdropBox(ctx.plotWidth, ctx.plotHeight, props.center ?? { x: 0.5, y: 1 }, props.radius ?? { x: 0.75, y: 1 });
  if (box === null) {
    return null;
  }
  const id = `backdrop-${index}:${props.dataKey}`;
  const gradientId = `${ctx.uid}-backdrop-${index}`;
  const stops: ChartGradientStop[] = (props.stops ?? DEFAULT_BACKDROP_STOPS).map((stop) => ({ offset: Math.min(1, Math.max(0, stop.offset)), color: stop.color, opacity: stop.opacity ?? 1 }));
  ctx.gradients.push({ id: gradientId, type: "radial", cx: box.cx, cy: box.cy, r: box.r, stops });
  const { rows, xAccessor } = ctx;
  const curve: CurveFactory = props.curve ?? curveNatural;
  const above = props.side !== "below";
  const animate = props.animate !== false;
  const opacity = props.opacity ?? 1;
  return erase(createMark<unknown, Date, number>(() => ({
    id,
    channels: {},
    render: ({ scales, chart }): Scene => {
      const yScale = yScaleIn(scales, props.yAxisId);
      if (!yScale || chart.width <= 0 || chart.height <= 0) {
        return EMPTY;
      }
      const points: [number, number][] = [];
      for (const row of rows) {
        const x = scales.x.map(xAccessor(row));
        const y = yScale.map(toNumber(row[props.dataKey]));
        if (Number.isFinite(x) && Number.isFinite(y)) {
          points.push([x, y]);
        }
      }
      const first = points[0];
      const last = points.at(-1);
      const lineD = points.length > 1 ? d3Line().curve(curve)(points) : null;
      if (!(first && last && lineD)) {
        return EMPTY;
      }
      const edge = round3(above ? chart.y : chart.y + chart.height);
      // bklit seriesRegionPath: the line, then to the edge and back to its first x; then the specks at B's corners.
      const bx0 = chart.x + box.x;
      const by0 = chart.y + box.y;
      const bx1 = bx0 + box.w - SPECK;
      const by1 = by0 + box.h - SPECK;
      const speck = (x: number, y: number): string => `M${round3(x)},${round3(y)}h${SPECK}v${SPECK}Z`;
      const path = `${lineD}L${round3(last[0])},${edge}L${round3(first[0])},${edge}Z${speck(bx0, by0)}${speck(bx1, by1)}`;
      const clip: ChartBounds = { x: chart.x, y: chart.y, width: chart.width, height: chart.height };
      return {
        nodes: [{
          kind: "group",
          key: id,
          className: animate ? `bkm-backdrop ${LAYER_IN}` : "bkm-backdrop",
          ariaHidden: true,
          clip,
          children: [{ kind: "area", key: `${id}:region`, points, path, style: { fill: `url(#${gradientId})`, stroke: "none", opacity } }],
        }],
        points: [],
      };
    },
  })));
}

/** The LineBackdrop children's marks, in declaration order (drawn under the series). */
export function backdropMarks(ctx: SeriesLayerContext): AnyMark[] {
  if (!(ctx.plotWidth > 0 && ctx.plotHeight > 0)) {
    return [];
  }
  return propsFor<LineBackdropProps>(ctx.table, "lineBackdrop").flatMap((props, i) => {
    const mark = backdropMark(props, i, ctx);
    return mark ? [mark] : [];
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// TrendLine
// ---------------------------------------------------------------------------------------------------------------------------------------

/** bklit trend-line.tsx defaults. */
const TREND_DEFAULTS = { strokeWidth: 2, dash: "6,4", gradientEnd: "var(--chart-5)", fadeLength: 15 } as const;

/** The stops of a trend line's stroke along its own length: the gradient's colours (or one colour) under the end fade's opacities. */
export function trendStops(props: Readonly<TrendLineProps>): ChartGradientStop[] | null {
  const stroke = props.stroke ?? DEFAULT_LINE_STROKE;
  const gradient = props.strokeStyle === "gradient";
  const fade = props.fadeEdges ?? false;
  const left = fade === true || fade === "left";
  const right = fade === true || fade === "right";
  if (!(gradient || left || right)) {
    return null;
  }
  const length = Math.min(50, Math.max(0, props.fadeEdgesLength ?? TREND_DEFAULTS.fadeLength)) / 100;
  const start = gradient ? (props.gradientStart ?? stroke) : stroke;
  const end = gradient ? (props.gradientEnd ?? TREND_DEFAULTS.gradientEnd) : stroke;
  const colorAt = (t: number): string => (start === end || t <= 0 ? start : t >= 1 ? end : `color-mix(in srgb, ${end} ${Math.round(t * 10_000) / 100}%, ${start})`);
  const offsets = [0, ...(left && length > 0 ? [length] : []), ...(right && length > 0 ? [1 - length] : []), 1];
  return offsets.map((t, i) => ({
    offset: t,
    color: colorAt(t),
    opacity: (i === 0 && left && length > 0) || (i === offsets.length - 1 && right && length > 0) ? 0 : 1,
  }));
}

function trendMark(props: Readonly<TrendLineProps>, index: number, ctx: SeriesLayerContext): AnyMark | null {
  const { rows, xAccessor } = ctx;
  const points: TrendPoint[] = rows.map((row) => ({ x: xAccessor(row).getTime(), y: toNumber(row[props.dataKey]) }));
  const segment = computeTrendSegment(points);
  if (segment === null) {
    return null;
  }
  const id = `trend-${index}:${props.dataKey}`;
  const stops = trendStops(props);
  let stroke = props.stroke ?? DEFAULT_LINE_STROKE;
  // Pixel direction of the segment: x grows with time, y shrinks with the value (the bbox gradient runs from its start corner to its end corner).
  const rising = segment.y2 > segment.y1;
  if (stops) {
    const gradientId = `${ctx.uid}-trend-${index}`;
    ctx.gradients.push({ id: gradientId, x1: 0, y1: rising ? 1 : 0, x2: 1, y2: rising ? 0 : 1, stops });
    stroke = `url(#${gradientId})`;
  }
  const strokeWidth = props.strokeWidth ?? TREND_DEFAULTS.strokeWidth;
  const dash = (props.strokeStyle ?? "dashed") === "dashed" ? (props.strokeDasharray ?? TREND_DEFAULTS.dash).replaceAll(",", " ") : undefined;
  const animate = props.animate !== false;
  const className = props.className ?? "chart-trend-line";
  return erase(createMark<unknown, Date, number>(() => ({
    id,
    channels: {},
    render: ({ scales }): Scene => {
      const yScale = yScaleIn(scales, props.yAxisId);
      if (!yScale) {
        return EMPTY;
      }
      const x1 = scales.x.map(new Date(segment.x1));
      const x2 = scales.x.map(new Date(segment.x2));
      const y1 = yScale.map(segment.y1);
      let y2 = yScale.map(segment.y2);
      if (![x1, x2, y1, y2].every(Number.isFinite)) {
        return EMPTY;
      }
      if (stops && Math.abs(y2 - y1) < LEVEL_RISE) {
        y2 = y1 - LEVEL_RISE;
      }
      return {
        nodes: [{
          kind: "group",
          key: id,
          // bklit shows a time-series trend from the reveal's start (trend-line.tsx isVisiblePhase), fading in over it.
          className: animate ? `${className} bkm-trend bkm-trend-in` : `${className} bkm-trend`,
          ariaHidden: true,
          style: { opacity: props.opacity ?? 1 },
          children: [{
            kind: "polyline",
            key: `${id}:line`,
            points: [[x1, y1], [x2, y2]],
            style: { fill: "none", stroke, strokeWidth, lineCap: "round", ...(dash === undefined ? undefined : { strokeDasharray: dash }) },
          }],
        }],
        points: [],
      };
    },
  })));
}

/** The TrendLine children's marks, in declaration order (drawn over the series). */
export function trendMarks(ctx: SeriesLayerContext): AnyMark[] {
  return propsFor<TrendLineProps>(ctx.table, "trendLine").flatMap((props, i) => {
    const mark = trendMark(props, i, ctx);
    return mark ? [mark] : [];
  });
}
