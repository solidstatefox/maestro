import { erase } from "../erased-types";
import { createMark, defineChart, lineY } from "@tanstack/charts";
import type { ChartMark } from "@tanstack/charts";
import type { ChartDefinition, ChartGradient } from "@tanstack/charts";
import { scaleLinear, scaleUtc } from "../scales";
import type { ChartTooltipExtension } from "@tanstack/charts/tooltip";
import { tooltipBoxMotion } from "../tooltip/box-motion";
import type { TooltipBoxMotionProps } from "../tooltip/box-motion";
import { sizedTooltipPlacement } from "../tooltip/sized-tooltip-placement";
import { TOOLTIP_OFFSET, bklitTheme } from "../theme";
import type { ChartMargin } from "../theme";
import type { GridGuideProps } from "../cartesian/grid-guides";
import { liveGrid } from "./live-grid";
import { liveBackgroundMark, liveReferenceMark } from "./live-reference";
import type { ReferenceAreaProps } from "../types/reference-area";
import { liveTail } from "./live-tail";
import type { TailGeometry } from "./live-tail";
import { liveXLabels } from "./live-xlabels";
import { liveTip } from "./live-tip";
import { clampedOffset, edgeOpacity, Y_TICK_SPRING } from "./live-yaxis";

export interface LiveRow {
  readonly key: string;
  readonly t: number;
  readonly v: number;
  /** Left padding while history is shorter than the window: the rolling contract needs a constant keyed row count, so pads repeat the first value and are painted invisible
   * (line: horizontal gradient mask; area: collapsed onto the floor). */
  readonly pad: boolean;
}

// SAFETY: every live mark is built from LiveRow data, so a point's datum is a LiveRow (or absent).
export const liveRowOf = (point: { readonly datum?: unknown } | null | undefined): LiveRow | undefined => point?.datum as LiveRow | undefined;

/** Plain index access that may fall outside the list (`at()` would wrap negative indexes). */
const rowAt = <T>(list: readonly T[], i: number): T | undefined => list[i];

export interface LiveDefinitionInput {
  readonly rows: readonly LiveRow[];
  readonly xDomain: readonly [number, number];
  readonly yDomain: readonly [number, number];
  /** Fixed area floor (semantic y1): must not change between rolling updates. */
  readonly areaFloor: number;
  readonly margin: ChartMargin;
  readonly uid: string;
  readonly dataKey: string;
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly dotColor: string;
  readonly dotSize: number;
  readonly fill: boolean;
  readonly badge: boolean;
  /** The badge text as the tick starts: the first of bklit's display lerp walk, the rest written by the label walk (live-steps.ts). */
  readonly badgeLabel: string;
  /** bklit's pulse ring at the tip (LiveLine `pulse`; none during the intro, as the ring follows the tip's settle). */
  readonly pulse: boolean;
  /** Flips each tick so the grid's and the reference bands' CSS y reprojection restarts (the nodes themselves persist). */
  readonly badgeParity: number;
  /** Where the tail mark hands its geometry for the head clock (live-head.ts): the latest render's, null without a tail. */
  readonly tailSink: { tail: TailGeometry | null };
  /** The tip eases by a CSS animation along bklit's per-frame lerp (live-tip.ts); false during the intro, which follows the chart. */
  readonly tipEase: boolean;
  /** The y domain jumped this tick (bklit moves an expanding edge or a nice() step at once): the path must not reproject it over the roll,
   * so its plan fails on purpose and falls back to snap (liveline.css slides it back in). */
  readonly yJump: boolean;
  /** The dot: its clock time (one sample interval right of the newest sample's rest slot) and the target value. */
  readonly tip: { readonly t: number; readonly v: number } | undefined;
  /** The lerped display value when the newest sample arrived: where the dot starts this tick (bklit's virtual point). */
  readonly dispV: number;
  /** Pixels per ms of the live clock (the tail's click-through to the pointer). */
  readonly pxPerMs: number;
  /** Steps the curve is sampled at per row interval (smoothStepsFor the interval's width). */
  readonly smoothSteps: number;
  /** The seed frame has no roll: the tail renders at rest. */
  readonly still: boolean;
  /** Transition for the roll: linear, one sample interval long. */
  readonly rollMs: number;
  readonly easing: "linear" | "ease-out" | ((progress: number) => number);
  /** The evenly spaced x slot times (ms) at the start of the roll: bklit's fixed slots at 0..100% of the live window. */
  readonly xTickTimes: readonly number[];
  /** bklit's hover area in chart coordinates (the margin-inset plot; the tooltip does not show in the margins). */
  readonly hoverBounds: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number };
  readonly formatTime: (ms: number) => string;
  readonly formatValue: (v: number) => string;
  readonly yPosition: "left" | "right";
  /** Plot height in px. */
  readonly plotHeight: number;
  readonly tooltipEnabled: boolean;
  /** The tooltip extension: the stock one, also painting the hover indicator (live-hover.ts), which draws the crosshair, dot and time pill. */
  readonly tooltipUse: ChartTooltipExtension;
  /** The ChartTooltip props that pick the panel spring. */
  readonly tooltipBox?: TooltipBoxMotionProps;
  /** The `<Grid>` child: rows under the line at the y domain's ticks (live-grid.ts). None when absent. */
  readonly grid?: GridGuideProps;
  /** bklit's `<Background>` (its `opacity`), drawn after the Grid and before the line; its tile is in the live chart's defs. */
  readonly background?: { readonly opacity: number };
  /** bklit's ReferenceAreas inside a live chart (live-reference.ts), drawn with the underlays. */
  readonly references?: readonly ReferenceAreaProps[];
}

/** bklit's y label box is top-aligned at the tick (no -50% centring): its text centre sits this far below the gridline. */
const Y_LABEL_DY = 12.5;
/** bklit's x labels are HTML spans `bottom: 12` of the container (box top 232 in a 260px box, 40px bottom margin). */
const X_TICK_PADDING = 14;

/** bklit's area gradient top stop (stopOpacity 0.1 at 0%, 0 at 100%). */
const AREA_OPACITY = 0.1;

interface FocusPoint {
  key: string;
  markId: string;
  datumIndex: number;
  datum: unknown;
  xValue: Date;
  yValue: number;
  x: number;
  y: number;
}

/** bklit's hover reads the value at the pointer (price and time interpolated between the samples around the pointer x). A native focus strategy returns that point, re-resolved every
 * move and frame with no rebuild; nothing outside the plot, the tip clamps like interpolateAtTime. Keeps the row-at-or-left identity (like kit's `navigationPrimary`) so arrow keys continue from it. */
interface LiveFocusStrategy {
  readonly resolve: (points: readonly FocusPoint[], pointer: { x: number; y: number }) => FocusPoint[];
  readonly group: (points: readonly FocusPoint[], target: { point: FocusPoint }) => FocusPoint[];
  readonly navigation: (points: readonly FocusPoint[]) => FocusPoint[];
}

interface AnchorPoint {
  readonly x: number;
  readonly y: number;
}
const LINE_ID = "live:line";
const CURSOR_KEY = "live:cursor";

const line = (points: readonly FocusPoint[]): FocusPoint[] =>
  points
    .filter((p): boolean => {
      const d = liveRowOf(p);
      return p.markId === LINE_ID && d !== undefined && d.key !== CURSOR_KEY && !d.pad;
    })
    .sort((a, b) => a.x - b.x);

function liveFocus(bounds: LiveDefinitionInput["hoverBounds"], tail: FocusTail | undefined): LiveFocusStrategy {
  const visible = (points: readonly FocusPoint[]): FocusPoint[] => line(points).filter((p) => p.x >= bounds.left && p.x <= bounds.right);
  return {
    resolve(points: readonly FocusPoint[], { x, y }: { x: number; y: number }): FocusPoint[] {
      if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) {
        return [];
      }
      const rows = line(points);
      const first = rows.at(0);
      const last = rows.at(-1);
      if (first === undefined || last === undefined) {
        return [];
      }
      if (tail && x > last.x) {
        // Past the rolling path: the tail (N-1 -> N, then the dot) is not a row; read it off the live clock like bklit.
        const t = Math.min(tail.tipT, last.xValue.getTime() + (x - last.x) / tail.pxPerMs);
        const v = t <= tail.bT ? last.yValue + ((tail.bV - last.yValue) * (t - last.xValue.getTime())) / (tail.bT - last.xValue.getTime() || 1) : tail.bV;
        const row: LiveRow = { key: CURSOR_KEY, t, v, pad: false };
        return [{ ...last, datum: row, xValue: new Date(t), yValue: v, x, y: last.y - (v - last.yValue) * tail.pxPerValue }];
      }
      let from = first;
      let to = first;
      if (x >= last.x) {
        from = last;
        to = last;
      } else if (x > first.x) {
        for (const p of rows) {
          if (p.x <= x) {
            from = p;
          } else {
            to = p;
            break;
          }
        }
      } else {
        // x is at or before the first row: from and to stay on it.
      }
      const f = to.x > from.x ? (x - from.x) / (to.x - from.x) : 0;
      const t = from.xValue.getTime() + f * (to.xValue.getTime() - from.xValue.getTime());
      const v = from.yValue + f * (to.yValue - from.yValue);
      const row: LiveRow = { key: CURSOR_KEY, t, v, pad: false };
      return [{ ...from, datum: row, xValue: new Date(t), yValue: v, x, y: from.y + f * (to.y - from.y) }];
    },
    // Keyboard focus is a row; one the roll carried off the left stops at the plot's left edge, since bklit's crosshair is the cursor's x
    // (live-line-chart.tsx:229-269 resolveLiveTooltip). The point keeps its left neighbour's identity so the next arrow continues from there.
    group: (points: readonly FocusPoint[], { point }: { point: FocusPoint }): FocusPoint[] => {
      if (point.x >= bounds.left && point.x <= bounds.right) {
        return [point];
      }
      const rows = line(points);
      const to = rows.findIndex((p) => p.x > bounds.left);
      const a = rowAt(rows, to - 1);
      const b = rowAt(rows, to);
      if (point.x < bounds.left && a !== undefined && b !== undefined) {
        const f = (bounds.left - a.x) / (b.x - a.x || 1);
        return [{ ...a, x: bounds.left, y: a.y + f * (b.y - a.y) }];
      }
      const first = visible(points).at(0);
      return first === undefined ? [] : [first];
    },
    // The rows a hover can reach: real samples inside bklit's hover area, so Tab, Home and the first arrow land on a
    // drawn row and End on the newest.
    navigation: visible,
  };
}

interface FocusTail {
  readonly tipT: number;
  readonly bT: number;
  readonly bV: number;
  readonly pxPerMs: number;
  /** Plot pixels per value unit. */
  readonly pxPerValue: number;
}

/** Steps per row interval at most: on a wide interval the polyline chord error against the curve stays far below a pixel. */
const SMOOTH_STEPS = 4;
/** The widest chord (px) a step may span: a narrower interval takes fewer steps (each step is a point the rolling motion moves every frame). */
const SMOOTH_CHORD_PX = 3;

/** Steps per row interval for an interval `intervalPx` wide: chords of at most SMOOTH_CHORD_PX, at most SMOOTH_STEPS (a 600 ms sample over a 30 s
 * window on a 640 px plot keeps all four). */
export const smoothStepsFor = (intervalPx: number): number =>
  Number.isFinite(intervalPx) ? Math.min(SMOOTH_STEPS, Math.max(1, Math.ceil(intervalPx / SMOOTH_CHORD_PX))) : SMOOTH_STEPS;

const sign = (n: number): number => (n < 0 ? -1 : 1);

/** d3's curveMonotoneX slope3 tangent at an interior row i, in value per ms (0 at the ends, which are never read). */
function monotoneTangent(rows: readonly LiveRow[], i: number): number {
  const at = rowAt(rows, i);
  const prev = rowAt(rows, i - 1);
  const next = rowAt(rows, i + 1);
  if (at === undefined) {
    return 0;
  }
  const slope = (a: LiveRow, b: LiveRow): number => (b.v - a.v) / (b.t - a.t || 1);
  if (prev !== undefined && next !== undefined) {
    const h0 = at.t - prev.t;
    const h1 = next.t - at.t;
    const s0 = slope(prev, at);
    const s1 = slope(at, next);
    const p = (s0 * h1 + s1 * h0) / (h0 + h1);
    return (sign(s0) + sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0;
  }
  // The end rows only seed their neighbour (see smoothRows), so their own tangent is never read.
  return 0;
}

/** The curve as plain rows: native rolling refuses a custom curve path (`custom-path`), so bklit's curveMonotoneX is sampled into `steps - 1` interior rows per interval on the exact cubic.
 * The end rows only supply tangents, so every emitted value is final the tick it appears (the rolling contract compares retained rows by value); one row interval past the tip is cut anyway. */
function smoothRows(rows: readonly LiveRow[], steps: number): readonly LiveRow[] {
  if (rows.length < 4) {
    return rows;
  }
  const tangents = rows.map((_, i) => monotoneTangent(rows, i));
  const out: LiveRow[] = [];
  for (let i = 1; i < rows.length - 2; i += 1) {
    const a = rows[i];
    const b = rows[i + 1];
    const h = b.t - a.t;
    out.push(a);
    for (let j = 1; j < steps; j += 1) {
      const u = j / steps;
      const u2 = u * u;
      const u3 = u2 * u;
      const v =
        (2 * u3 - 3 * u2 + 1) * a.v +
        (u3 - 2 * u2 + u) * h * (tangents[i]) +
        (-2 * u3 + 3 * u2) * b.v +
        (u3 - u2) * h * (tangents[i + 1]);
      // The interval out of the last pad row is cut with the pads (liveline.css starts the path at the first real sample).
      out.push({ key: `${a.key}~${j}`, t: a.t + h * u, v, pad: a.pad });
    }
  }
  const penultimate = rows.at(-2);
  if (penultimate) {
    out.push(penultimate);
  }
  return out;
}

const drawnRows = /* @__PURE__ */ new WeakMap<readonly LiveRow[], readonly LiveRow[]>();
/** The drawn line's value at plot-clock time `t`: the same smoothed rows the rolling path is drawn through (smoothRows), so a point placed with it sits on the stroke
 * (the keyboard guide at the plot's left edge on a jump tick, live-line-chart.tsx). Before the first emitted row it holds that row's value. */
export function drawnValueAt(rows: readonly LiveRow[], t: number): number {
  // The rows a definition drew (buildLiveDefinition keeps them), else the widest sampling.
  let pts = drawnRows.get(rows);
  if (!pts) {
    pts = smoothRows(rows, SMOOTH_STEPS);
    drawnRows.set(rows, pts);
  }
  const first = pts.at(0);
  if (first === undefined) {
    return 0;
  }
  if (t <= first.t) {
    return first.v;
  }
  let lo = 0;
  let hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if ((pts[mid]).t <= t) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const a = pts[lo];
  const b = pts[hi];
  return t >= b.t ? b.v : a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t || 1);
}

/** The area under the line: the same rows closed down to the floor (pads collapsed onto it), one path with no points of its own. A native area
 * with its points doubled the renderer's work per tick (its rolling plan and the presentation of every point) and per frame; this one rides
 * the line's rolling transform instead, which the head clock copies onto it (live-head.ts). Unkeyed, so the renderer writes its shape as it
 * draws (a keyed node's shape would land a frame later, on the motion's first tick). The focus strategy only resolves `live:line` points. */
function liveArea(rows: readonly LiveRow[], floor: number, fill: string): ChartMark<unknown, Date, number> {
  return createMark<unknown, Date, number>(() => ({
    id: "live:area",
    channels: {},
    render: ({ scales }) => {
      const yFloor = scales.y.map(floor);
      const top = rows.flatMap((r): [number, number][] => {
        const x = scales.x.map(new Date(r.t));
        const y = r.pad ? yFloor : scales.y.map(r.v);
        return Number.isFinite(x) && Number.isFinite(y) ? [[x, y]] : [];
      });
      const first = top.at(0);
      const last = top.at(-1);
      if (!first || !last || !Number.isFinite(yFloor)) {
        return { nodes: [], points: [] };
      }
      const points: [number, number][] = [...top, [last[0], yFloor], [first[0], yFloor]];
      return {
        nodes: [{ kind: "group", key: "", className: "ts-chart__area bkm-live-area", children: [
          { kind: "area", key: "", className: "bkm-live-area-path", points, style: { fill, fillOpacity: AREA_OPACITY, stroke: "none" } },
        ] }],
        points: [],
      };
    },
  }), false);
}

interface LiveDefinition {
  definition: ChartDefinition<LiveRow, Date, number>;
  /** The area ramp in svg px: full strength at `top` (the curve's peak), zero at `bottom` (the plot bottom). */
  fillRamp: { readonly top: number; readonly bottom: number };
}

/** bklit's area gradient (0.1 -> 0 over the AreaClosed bbox) as one ramp in the svg's coordinates, masking flat-painted pieces (liveline.css). */
function areaFillRamp(rows: readonly LiveRow[], input: Readonly<LiveDefinitionInput>): LiveDefinition["fillRamp"] {
  // Peak over every real row: the tail (N and the dot) is part of bklit's curve.
  let curvePeak = Number.NEGATIVE_INFINITY;
  for (const r of rows) {
    if (!r.pad) {
      curvePeak = Math.max(curvePeak, r.v);
    }
  }
  const [yLo, yHi] = input.yDomain;
  const plotBottom = input.margin.top + input.plotHeight;
  const peakPx = Number.isFinite(curvePeak) ? input.margin.top + ((yHi - curvePeak) / (yHi - yLo || 1)) * input.plotHeight : input.margin.top;
  return { top: Math.round(peakPx * 100) / 100, bottom: Math.round(plotBottom * 100) / 100 };
}

/** bklit's line gradient: full strength at the top of the curve, 60% at the bottom, so the lower (older) stretch reads lighter. */
function lineGradient(id: string, stroke: string): ChartGradient {
  return {
    id,
    x1: 0,
    y1: 0,
    x2: 0,
    y2: 1,
    stops: [
      { offset: 0, color: stroke, opacity: 1 },
      { offset: 1, color: stroke, opacity: 0.6 },
    ],
  };
}

interface TailSpan {
  readonly a: LiveRow;
  readonly b: LiveRow;
  readonly tip: { readonly t: number; readonly v: number };
}

/** The tail (N-1 -> N -> dot) exists once the window holds real rows at both ends. */
function tailSpan(rows: readonly LiveRow[], tip: LiveDefinitionInput["tip"]): TailSpan | undefined {
  const a = rows.at(-2);
  const b = rows.at(-1);
  if (!tip || !a || !b) {
    return undefined;
  }
  if (rows.length < 4 || a.pad || b.pad) {
    return undefined;
  }
  return { a, b, tip };
}

/** bklit's line gradient runs 1 -> 0.6 down the curve's bbox; a piece takes the opacity at its own middle. */
function tailLineOpacity(rows: readonly LiveRow[], tail: TailSpan): number {
  let vMin = Number.POSITIVE_INFINITY;
  let vMax = Number.NEGATIVE_INFINITY;
  for (const [i, r] of rows.entries()) {
    if (!r.pad && i > 0 && i < rows.length - 1) {
      vMin = Math.min(vMin, r.v);
      vMax = Math.max(vMax, r.v);
    }
  }
  const midV = (tail.a.v + tail.b.v) / 2;
  return vMax > vMin ? 0.6 + 0.4 * Math.min(1, Math.max(0, (midV - vMin) / (vMax - vMin))) : 1;
}

/** The tail drawn beside the rolling path, which ends at N-1 (see live-tail.ts). */
function tailMark(input: Readonly<LiveDefinitionInput>, rows: readonly LiveRow[], pathRows: readonly LiveRow[], tail: TailSpan): ReturnType<typeof liveTail> {
  return liveTail({
    id: "live:tail",
    aT: tail.a.t,
    aV: tail.a.v,
    aSlope: monotoneTangent(rows, rows.length - 2),
    bT: tail.b.t,
    bV: tail.b.v,
    dispV: input.dispV,
    tipT: tail.tip.t,
    stroke: input.stroke,
    strokeWidth: input.strokeWidth,
    strokeOpacity: tailLineOpacity(rows, tail),
    areaFloor: input.areaFloor,
    fill: input.fill ? input.stroke : undefined,
    fillOpacity: AREA_OPACITY,
    // Three row intervals of the path (a roll's x start is one interval, two after a late sample, plus what is left of the
    // previous roll): the cut at the path's end stays covered.
    lead: pathRows.slice(-(3 * input.smoothSteps + 1)).map((r): [number, number] => [r.t, r.v]),
    still: input.still,
    sink: input.tailSink,
  });
}

interface LiveTooltipOptions {
  readonly use: ChartTooltipExtension;
  readonly anchor: (points: unknown, context: { pointer: { x: number } | null; focus: { primary: { x: number } }; plot: { y: number } }) => AnchorPoint;
  readonly placement: readonly string[];
  readonly offset: number;
  readonly portal: ReturnType<typeof sizedTooltipPlacement>;
  readonly className: string;
  readonly sticky: boolean;
  readonly motion: ReturnType<typeof tooltipBoxMotion>;
}

/** bklit TooltipBox: panel top on the plot top, `offset` right of the pointer (flipping left at the edge). */
function liveTooltip(use: ChartTooltipExtension, boxMotion: ReturnType<typeof tooltipBoxMotion>): LiveTooltipOptions {
  return {
    // bklitTooltip's instant hide (bklit TooltipBox has no exit presence; the roll's repeat hides are skipped; gap #19), painting the hover indicator.
    use,
    // The pointer, not the focused row, so the box does not snap to the 18px row grid.
    anchor: (_points, context) => ({
      x: context.pointer?.x ?? context.focus.primary.x,
      y: context.plot.y - TOOLTIP_OFFSET,
    }),
    placement: ["bottom-right", "bottom-left"],
    offset: TOOLTIP_OFFSET,
    // The same placement without the per-paint size read (gap #21, kit/tooltip/sized-tooltip-placement.ts).
    portal: sizedTooltipPlacement(),
    className: "bkm-live-tooltip",
    sticky: false,
    // bklit's box follows the pointer on tooltipBoxSpring.
    motion: boxMotion,
  };
}

export function buildLiveDefinition(input: Readonly<LiveDefinitionInput>): LiveDefinition {
  const { rows, uid, stroke, strokeWidth, tooltipEnabled } = input;
  const pathRows = smoothRows(rows, input.smoothSteps);
  drawnRows.set(rows, pathRows);
  const x = (d: LiveRow): Date => new Date(d.t);
  const common = { x, y: (d: LiveRow): number => d.v, key: (d: LiveRow): string => d.key, z: (): string => input.dataKey };
  const lineId = `${uid}-live-line`;
  const gradients: ChartGradient[] = [lineGradient(lineId, stroke)];
  const marks: unknown[] = [];
  const fillRamp = areaFillRamp(rows, input);
  if (input.grid) {
    // bklit draws Grid first, under the series (live-grid.ts).
    marks.push(liveGrid({ id: "live:grid", grid: input.grid, yDomain: input.yDomain, left: input.hoverBounds.left, right: input.hoverBounds.right, parity: input.badgeParity }));
  }
  // bklit LiveLineChart: the clip-excluded Grid, then the underlays (Background, ReferenceArea), then the series (live-line-chart.tsx:614-624).
  if (input.background) {
    marks.push(liveBackgroundMark({ uid, opacity: input.background.opacity, left: input.hoverBounds.left, right: input.hoverBounds.right }));
  }
  if (input.references && input.references.length > 0) {
    marks.push(liveReferenceMark({ id: "live:refs", uid, references: input.references, left: input.hoverBounds.left, right: input.hoverBounds.right, parity: input.badgeParity }));
  }
  if (input.fill) {
    marks.push(liveArea(pathRows, input.areaFloor, stroke));
  }
  // The pad / past-the-tip cuts of the line are CSS clip-path (liveline.css), not a gradient.
  marks.push(lineY(pathRows, erase({ id: LINE_ID, ...common, stroke: `url(#${lineId})`, strokeWidth })));
  const tail = tailSpan(rows, input.tip);
  input.tailSink.tail = null;
  if (tail) {
    marks.push(tailMark(input, rows, pathRows, tail));
  }
  if (input.tip) {
    marks.push(
      liveTip({
        id: "live:tip",
        time: input.tip.t,
        value: input.tip.v,
        color: input.dotColor,
        stroke,
        dotSize: input.dotSize,
        badge: input.badge,
        label: input.badgeLabel,
        pulse: input.pulse,
        ease: input.tipEase,
      }),
    );
  }
  // bklit's TooltipIndicator (chart-tooltip.tsx:258-283, tooltip-indicator.tsx:125-190), the tooltip's dot and the time pill are the hover
  // indicator's (live-hover.ts), painted with the tooltip: no crosshair mark, so the renderer's focus guide layer stays empty.

  const tailFocus: FocusTail | undefined = tail
    ? { tipT: tail.tip.t, bT: tail.b.t, bV: tail.b.v, pxPerMs: input.pxPerMs, pxPerValue: input.plotHeight / (input.yDomain[1] - input.yDomain[0] || 1) }
    : undefined;
  const spec = erase({
    marks,
    controls: [
      liveXLabels({ id: "live:xlabels", times: input.xTickTimes, rollMs: input.rollMs, padding: X_TICK_PADDING, fontSize: 12, format: input.formatTime }),
    ],
    motion: {
      path: { update: "rolling", x: "shift", y: input.yJump ? "fixed" : "reproject", fallback: "snap" },
      transition: { type: "tween", duration: input.rollMs, easing: input.easing },
    },
    scales: {
      x: {
        scale: scaleUtc().domain([new Date(input.xDomain[0]), new Date(input.xDomain[1])]),
        // The x labels are fixed slots drawn by liveXLabels (live-xlabels.ts); the axis itself draws nothing.
        axis: { line: false, ticks: false, tickLabels: false },
      },
      y: {
        scale: scaleLinear().domain([input.yDomain[0], input.yDomain[1]]),
        side: input.yPosition,
        // The y labels are a second chart over this one (buildLiveYAxisDefinition): the axis itself draws nothing.
        axis: { line: false, ticks: false, tickLabels: false },
      },
    },
    // Explicit margins on every side: the rolling contract needs stable plot bounds.
    margin: input.margin,
    theme: bklitTheme,
    gradients,
    clip: true,
    focus: tooltipEnabled ? liveFocus(input.hoverBounds, tailFocus) : undefined,
    maxFocusDistance: Number.POSITIVE_INFINITY,
    focusRing: false,
    tooltip: tooltipEnabled ? liveTooltip(input.tooltipUse, tooltipBoxMotion(input.tooltipBox)) : false,
  });
  const definition: ChartDefinition<LiveRow, Date, number> = erase(defineChart(spec));
  return { definition, fillRamp };
}

export interface LiveYAxisInput {
  readonly xDomain: readonly [number, number];
  readonly yDomain: readonly [number, number];
  readonly margin: ChartMargin;
  readonly formatValue: (v: number) => string;
  readonly yPosition: "left" | "right";
  readonly yTicks: readonly number[];
  /** Ticks that left the set this frame: still drawn, fading out (live-ylabels.ts). */
  readonly yLeaving: readonly number[];
  /** Where each leaving tick stood (plot px from the top): it fades there, opacity only (live-ylabels.ts). */
  readonly yFrozen?: ReadonlyMap<number, number>;
  /** Gap between the y tick labels and the plot edge (shrunk when a label is wider than the margin). */
  readonly yLabelPad: number;
  /** Plot height in px (y tick edge fade). */
  readonly plotHeight: number;
}

/** The y labels as their own chart (live-ylabels.ts says why): the same margins and native y axis as the line's chart, no series, focus or tooltip. */
export function buildLiveYAxisDefinition(input: Readonly<LiveYAxisInput>): ChartDefinition<LiveRow, Date, number> {
  const spec = erase({
    marks: [],
    scales: {
      x: {
        scale: scaleUtc().domain([new Date(input.xDomain[0]), new Date(input.xDomain[1])]),
        axis: { line: false, ticks: false, tickLabels: false },
      },
      y: {
        scale: scaleLinear().domain([input.yDomain[0], input.yDomain[1]]),
        side: input.yPosition,
        axis: {
          line: false,
          ticks: { values: input.yTicks, size: 0, padding: input.yLabelPad, format: (v: number) => input.formatValue(v) },
          tickLabels: {
            fontSize: 12,
            fontWeight: 400,
            fill: "var(--chart-label)",
            // Every candidate renders: a label pulled to the plot bound (dy below) would otherwise be thinned against its neighbours.
            thin: false,
            // bklit's label box sits Y_LABEL_DY under the tick; a label whose final slot is off the plot stays at bklit's
            // bound (live-yaxis.ts clampedOffset: live-y-axis.tsx:182, exit is opacity-only at :205).
            // A leaving tick holds where it stood (exit is opacity-only), within the same bound.
            dy: ({ value, position }: { value: number; position: number }) => {
              const plotY = position - input.margin.top;
              const held = input.yFrozen?.get(value);
              return Y_LABEL_DY + (held === undefined ? clampedOffset(plotY, input.plotHeight) : clampedOffset(held, input.plotHeight) + held - plotY);
            },
            // bklit fades labels within 28px of the plot edge (position-keyed, so it follows the domain glide). The native
            // tick position is in chart coordinates; bklit measures from the plot top.
            opacity: ({ value, position }: { value: number; position: number }) =>
              input.yLeaving.includes(value) ? 0 : edgeOpacity(position - input.margin.top, input.plotHeight),
            // bklit's tick spring (live-y-axis.tsx:89, :198-205): enter/exit fade and the position glide.
            motion: { transition: Y_TICK_SPRING },
          },
        },
      },
    },
    margin: input.margin,
    theme: bklitTheme,
    focus: false,
    tooltip: false,
  });
  return erase(defineChart(spec));
}
