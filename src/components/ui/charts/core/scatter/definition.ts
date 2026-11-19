import { defineChart, dot } from "@tanstack/charts";
import type { ChartDefinition, ChartGradient, ChartMark, ChartMotionTiming } from "@tanstack/charts";
import { focusGroupX } from "@tanstack/charts/focus";
import { bklitTooltip } from "../tooltip/bklit-tooltip";
import { tooltipBoxMotion } from "../tooltip/box-motion";
import type { TooltipBoxMotionProps } from "../tooltip/box-motion";
import { scaleLinear, scaleTime, scaleUtc } from "../scales";
import { shortDateByDay } from "../format";
import { erase } from "../erased-types";
import { niced } from "../cartesian/definition";
import { propsFor } from "../carriers/table";
import type { ChildTable } from "../carriers/table";
import { userGradients } from "../gradients";
import { toDate } from "../cartesian/series";
import type { Row } from "../cartesian/series";
import { dataTickValues } from "../cartesian/x-axis";
import { formatTick } from "../cartesian/y-axis";
import { resumeEnter } from "../motion/resume-enter";
import { revealEndFromEnter } from "../size/reveal-clock";
import type { RevealClock } from "../size/reveal-clock";
import type { EnterPlan } from "../motion/resume-enter";
import { gridColumnGuides, gridHostAttrs, gridLineStyle, gridRowGuides } from "../cartesian/grid-guides";
import type { GridGuideProps as GridProps } from "../cartesian/grid-guides";
import { bklitTheme, BKLIT_TOOLTIP_PLACEMENT, X_TICK_PADDING } from "../theme";
import type { ChartMargin } from "../theme";
import { pillLayout, withPillGeometry } from "../cartesian/date-pill";
import type { HoverOverlayModel, OverlayDot, OverlayPlot } from "../cartesian/hover-overlay";
import type { PillLayout } from "../cartesian/date-pill";
import { CHART_PALETTE } from "../palette";
import { interactiveGateCss } from "../cartesian/gate-css";
import { typedAttr } from "../css-hooks";
import { HOVER_TRANSITION_CSS } from "../motion/springs";
import { CLS, keyStarts } from "../renderer-dom";
import type { ScatterInactiveMode } from "../types/cartesian";
import { jitterOffset, jitterRangePadding, minDistinctStep } from "./jitter";
import { markRendererOption } from "../canvas/renderer";
import { maxOf, minOf } from "../range";
import { cachedNavigation, columnWindow, nearestXWindow } from "../interaction/x-window";
import type { ChartMarkRenderer } from "../canvas/renderer";
import type { ResolvedScatterJitter } from "./jitter";

interface ScatterProps {
  dataKey: string;
  label?: string;
  yAxisId?: string | number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  ringGap?: number;
  outlineWidth?: number;
  outlineColor?: string;
  radius?: number;
  animate?: boolean;
  fadeOnHover?: boolean;
  inactiveOpacity?: number;
  inactiveMode?: ScatterInactiveMode;
  inactiveBlur?: number;
  enterBlur?: number;
  showActiveHighlight?: boolean;
  yGradient?: boolean | { from?: string; to?: string };
  renderer?: ChartMarkRenderer;
}

interface XAxisProps {
  numTicks?: number;
  tickMode?: "domain" | "data";
  formatValue?: (value: Date) => string;
}
interface YAxisProps {
  yAxisId?: string | number;
  orientation?: "left" | "right";
  numTicks?: number;
  formatLargeNumbers?: boolean;
  formatValue?: (value: number) => string;
}
interface TooltipProps extends TooltipBoxMotionProps {
  showDatePill?: boolean;
  showCrosshair?: boolean;
  showDots?: boolean;
  dotSize?: number;
  dotColor?: string | ((point: Row, line: unknown) => string);
  indicatorColor?: string | ((point: Row) => string);
  indicatorDasharray?: string;
}

interface ScatterSeries {
  readonly dataKey: string;
  /** Scatter `label`: the series' name in its tooltip row (`seriesLabels`). */
  readonly label?: string;
  readonly yAxisId: string;
  readonly fill: string;
  readonly stroke: string;
  readonly radius: number;
  readonly ringWidth: number;
  readonly ringGap: number;
  readonly outlineWidth: number;
  readonly outlineColor: string;
  readonly animate: boolean;
  readonly dim: boolean;
  readonly inactiveOpacity: number;
  readonly inactiveBlur: number;
  readonly enterBlur: number;
  readonly activeScale: number;
  /** bklit's series colour for tooltip dots and rows: `fill || stroke || palette` (ignores yGradient). */
  readonly tooltipColor: string;
  /** Where the series' dots draw (`renderer`): SVG circles, or one canvas bitmap. */
  readonly renderer: ChartMarkRenderer;
}

export interface ScatterInput {
  readonly data: readonly Row[];
  readonly xKey: string;
  readonly table: ChildTable;
  readonly margin: ChartMargin;
  readonly uid: string;
  readonly animationDuration: number;
  readonly easing: (t: number) => number;
  /** false = first pass: grid + axes only, so the dots enter as new data with their per-datum delay. */
  readonly revealed: boolean;
  /** bklit's reveal timer clock: the swap to static dots lands `animationDuration` after the chart's mount effect. */
  readonly revealClock?: RevealClock;
  /** Receives the size TanStack measured, from the `chart` callback inside its draw. */
  readonly sizeStore: SizeStore;
  /** `jitter` resolved (jitter.ts), or null: points that share an x spread into a strip plot and hover snaps to the nearest one. */
  readonly jitter: ResolvedScatterJitter | null;
  /** Formats the x ticks (unless `XAxis` has its own) and the date pill. */
  readonly formatXLabel?: (date: Date) => string;
}

export interface SizeStore {
  readonly get: () => { readonly width: number; readonly height: number };
  readonly subscribe: (cb: () => void) => () => void;
  readonly set: (width: number, height: number) => void;
}

/** The plot size as TanStack measured it: written in its draw, read by hover and by <FocusLayer> only (no React state on the path to the first draw). */
export function createSizeStore(): SizeStore {
  let size = { width: 0, height: 0 };
  const listeners = new Set<() => void>();
  return {
    get: () => size,
    subscribe: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    set: (width, height) => {
      if (width === size.width && height === size.height) {
        return;
      }
      size = { width, height };
      listeners.forEach((l) => { l(); });
    },
  };
}

const GRADIENT_TO = "var(--chart-positive)";
// bklit series-markers `enterDuration` (0.5s per dot).
const ENTER_MS = 500;
const DEFAULT_Y_AXIS = "left";

// Kept apart from kit toNumber: a string or null y cell is NaN here (a gap), but 5 / 0 there.
const toNumber = (value: unknown): number => (Number.isFinite(value) ? Number(value) : Number.NaN);
const axisId = (value: string | number | undefined): string => (value === undefined ? DEFAULT_Y_AXIS : String(value));

const gradientEnd = (gradient: ScatterProps["yGradient"]): string | null => {
  if (gradient === undefined || gradient === false) {
    return null;
  }
  return gradient === true ? GRADIENT_TO : (gradient.to ?? GRADIENT_TO);
};
// bklit's `a || b` on colour strings: an empty string falls through.
const firstNonEmpty = (...values: readonly (string | undefined)[]): string | undefined => values.find((v) => v !== undefined && v !== "");

function resolveScatterSeries(table: ChildTable): ScatterSeries[] {
  return propsFor<ScatterProps>(table, "scatter").map((p, index) => {
    // bklit paints the dot with a userSpaceOnUse gradient (y1 = innerHeight, y2 = 0) inside the dot's own translate(cx, cy),
    // so every dot samples the gradient at local y of about 0: the `to` stop (measured: all dots `to`, no per-height colour).
    // Parity kept: a series in one solid colour reads as a deliberate look in a Card (nothing looks broken), and a per-height blend would invent a `from`
    // default bklit never shows. Only the default `to` diverges, from Tailwind's emerald to the theme's `--chart-positive` (GRADIENT_TO).
    const gradientTo = gradientEnd(p.yGradient);
    const palette = CHART_PALETTE[index % CHART_PALETTE.length];
    const tooltipColor = firstNonEmpty(p.fill, p.stroke) ?? palette;
    const fill = gradientTo ?? p.fill ?? p.stroke ?? palette;
    const stroke = p.stroke ?? fill;
    // bklit's current defaults (2026-10-22): rings are opt-in, dimmed dots fade to 0.3 without blur unless `inactiveMode` is "blur".
    const ringWidth = p.strokeWidth ?? 0;
    return {
      dataKey: p.dataKey,
      label: p.label,
      yAxisId: axisId(p.yAxisId),
      fill,
      stroke,
      radius: p.radius ?? 5,
      ringWidth,
      ringGap: p.ringGap ?? 2,
      outlineWidth: p.outlineWidth ?? 0,
      outlineColor: p.outlineColor ?? stroke,
      animate: p.animate ?? true,
      dim: p.fadeOnHover ?? true,
      inactiveOpacity: p.inactiveOpacity ?? 0.3,
      inactiveBlur: p.inactiveMode === "blur" ? (p.inactiveBlur ?? 2) : 0,
      enterBlur: p.enterBlur ?? 2,
      activeScale: (p.showActiveHighlight ?? true) ? 1.35 : 1,
      tooltipColor,
      renderer: p.renderer ?? "svg",
    };
  });
}

/** bklit's scatter y domain: [0, max * 1.1] (100 when there is no positive value), visx-nice'd. */
function yDomain(values: readonly number[]): [number, number] {
  let max = 0;
  for (const v of values) {
    if (Number.isFinite(v) && v > max) {
      max = v;
    }
  }
  return niced([0, max <= 0 ? 100 : max * 1.1]);
}

type ScatterMark = ChartMark<Row, Date, number, Date, number, string, string>;
interface PillTickInfo {
  times: number[];
  spanMs: number;
  plotWidth: number;
  reachPx: number;
}
interface YScaleOption {
  yScale?: string;
}
interface YScaleConfig {
  scale: ReturnType<typeof scaleLinear>;
  grid: ReturnType<typeof gridLineStyle> | false;
  axis: unknown;
  channel?: "y";
  side?: "left" | "right";
}
interface ScatterChartConfig {
  marks: ScatterMark[];
  scales: Record<string, unknown>;
  margin: ChartMargin;
  theme: typeof bklitTheme;
  gradients: ChartGradient[];
  color?: { domain: string[]; range: string[] };
}
/** Mutable entrance state shared by the dot marks and the `chart` callback that measures the plot. */
interface ScatterLive {
  /** Plot inner width, written by the `chart` callback (which runs before the scene's motion is resolved) for the enter delay. */
  innerWidth: number;
  innerHeight: number;
  /** Clock of the first dot entrance (see `enterMotion`). */
  enterAt: number | null;
}

/** The mark option that targets a secondary y axis; the default axis takes none (not core/cartesian/y-axis.ts yScaleOption, which builds the scale itself). */
function yScaleOption(yAxisId: string): YScaleOption {
  return yAxisId === DEFAULT_Y_AXIS ? {} : { yScale: `y:${yAxisId}` };
}

const colorOr = (value: unknown, fallback: string): string => (typeof value === "string" ? value : fallback);

function resolveYScales(
  yDomains: ReadonlyMap<string, [number, number]>,
  yAxes: readonly YAxisProps[],
  grid: GridProps | undefined,
  rowGuides: ReturnType<typeof gridRowGuides>,
): Map<string, YScaleConfig> {
  const yScales = new Map<string, YScaleConfig>();
  for (const [id, domain] of yDomains) {
    const config = yAxes.find((a) => axisId(a.yAxisId) === id);
    const isPrimary = id === DEFAULT_Y_AXIS;
    const ticks = { count: isPrimary ? rowGuides.count : (config?.numTicks ?? 5) };
    const large = config?.formatLargeNumbers !== false;
    const resolved: YScaleConfig = {
      scale: scaleLinear().domain(domain),
      grid: isPrimary && rowGuides.native && grid !== undefined ? gridLineStyle(grid) : false,
      axis: config
        ? {
            line: false,
            ticks: { ...ticks, size: 0, format: (v: number) => (config.formatValue ? config.formatValue(v) : formatTick(v, large)) },
            // bklit y-axis.tsx:106-142 draws every scale tick, no collision test.
            tickLabels: { fontSize: 12, opacity: 1, thin: false },
          }
        : { line: false, ticks: { ...ticks, size: 0 }, tickLabels: false },
    };
    if (!isPrimary) {
      resolved.channel = "y";
    }
    const side = isPrimary ? config?.orientation : (config?.orientation ?? "right");
    if (side !== undefined) {
      resolved.side = side;
    }
    yScales.set(isPrimary ? "y" : `y:${id}`, resolved);
  }
  return yScales;
}

/** A jittered chart's lookups: the offsets (jitter.ts), each row's index (the hash's input) and the focused series (hover.ts sets it). */
interface JitterState {
  readonly jitter: ResolvedScatterJitter;
  /** The smallest step between two x values, in ms: the x spread's unit. */
  readonly gap: number;
  readonly rowIndex: ReadonlyMap<Row, number>;
  /** The series of the focused point: only its active copy shows (bklit's nearest-point hover). */
  readonly focused: { current: number | null };
}

interface TooltipModelInput {
  readonly tooltipProps: TooltipProps;
  readonly series: readonly ScatterSeries[];
  readonly data: readonly Row[];
  readonly xOf: (d: Row) => Date;
  readonly pill: PillLayout | null;
  readonly formatX: (date: Date) => string;
  readonly jittered: JitterState | null;
}

/** The hover indicator for the HoverOverlay the host owns (core/cartesian/hover-overlay.ts): crosshair rule, the focused point's active-highlight copies (they jump), one tooltip dot per series (they glide) and the date pill. */
function tooltipOverlay({ tooltipProps, series, data, xOf, pill, formatX, jittered }: TooltipModelInput): HoverOverlayModel {
  const head = series.at(0);
  const labelIndex = new Map<number, number>();
  const labels = data.map((row, i) => {
    labelIndex.set(xOf(row).getTime(), i);
    return formatX(xOf(row));
  });
  const valueOf = (dataKey: string) => (row: Row): number | undefined => {
    const value = toNumber(row[dataKey]);
    return Number.isFinite(value) ? value : undefined;
  };
  // A jittered point's spot: its offsets (ms on x, px on y) from where the row's value sits; the dots follow the point, not the date.
  const jitterSpot = (s: ScatterSeries, seriesIndex: number, state: JitterState) => (row: Row, plot: OverlayPlot): { dx: number; y: number } | undefined => {
    const value = valueOf(s.dataKey)(row);
    const domain = plot.yDomains[s.yAxisId];
    if (value === undefined || domain === undefined) {
      return undefined;
    }
    const offset = jitterOffset(state.jitter, state.gap, state.rowIndex.get(row) ?? 0, seriesIndex);
    const span = plot.xDomain[1] - plot.xDomain[0];
    return { dx: span > 0 ? (offset.x / span) * plot.innerWidth : 0, y: plot.innerHeight - ((value - domain[0]) / (domain[1] - domain[0] || 1)) * plot.innerHeight + offset.y };
  };
  // bklit's active highlight: the focused point's markers redrawn on top at activeScale (the dimmed layer keeps its own copy beneath, like bklit). They snap, no tween.
  const dots: OverlayDot[] = [];
  for (const [seriesIndex, s] of series.entries()) {
    if (!(s.dim && s.activeScale > 1)) {
      continue;
    }
    const k = s.activeScale;
    const ringOuter = s.ringWidth > 0 ? s.radius + s.ringGap + s.ringWidth : s.radius;
    const spot = jittered === null ? undefined : jitterSpot(s, seriesIndex, jittered);
    dots.push({
      yAxis: s.yAxisId,
      valueOf: valueOf(s.dataKey),
      // Jittered: only the focused point's series shows its active copy, on that point (bklit series-markers.tsx:313).
      ...(spot === undefined || jittered === null ? null : { at: (row: Row, plot: OverlayPlot) => (jittered.focused.current === seriesIndex ? spot(row, plot) : undefined) }),
      glide: false,
      shapes: [
        ...(s.outlineWidth > 0 ? [{ r: (ringOuter + s.outlineWidth / 2) * k, fill: "none", stroke: s.outlineColor, strokeWidth: s.outlineWidth * k }] : []),
        { r: s.radius * k, fill: s.fill, stroke: "none", strokeWidth: 0 },
        ...(s.ringWidth > 0 ? [{ r: (s.radius + s.ringGap + s.ringWidth / 2) * k, fill: "none", stroke: s.stroke, strokeWidth: s.ringWidth * k }] : []),
      ],
    });
  }
  // bklit TooltipDot per series: r = dotSize (5), 2px background stroke, springing to the hovered point, painted over the rule.
  if (tooltipProps.showDots !== false) {
    for (const [seriesIndex, s] of series.entries()) {
      dots.push({
        yAxis: s.yAxisId,
        valueOf: valueOf(s.dataKey),
        ...(jittered === null ? null : { at: jitterSpot(s, seriesIndex, jittered) }),
        glide: true,
        shapes: [{ r: tooltipProps.dotSize ?? 5, fill: colorOr(tooltipProps.dotColor, s.tooltipColor), stroke: "var(--chart-background)", strokeWidth: 2 }],
      });
    }
  }
  return {
    // A jittered chart hides the crosshair unless asked (it marks a date, not the hovered point).
    crosshair: head && (jittered === null ? tooltipProps.showCrosshair !== false : tooltipProps.showCrosshair === true) ? { color: colorOr(tooltipProps.indicatorColor, "var(--chart-crosshair)"), dash: tooltipProps.indicatorDasharray, width: 1 } : null,
    dots,
    indexOf: (time) => labelIndex.get(time) ?? 0,
    pill: head && pill !== undefined && tooltipProps.showDatePill !== false ? { labels, layout: pill } : null,
  };
}

interface SeriesMarksInput {
  readonly input: ScatterInput;
  readonly data: readonly Row[];
  readonly xOf: (d: Row) => Date;
  readonly minT: number;
  readonly span: number;
  /** The x range's padding in px at an inner width (a jittered chart's grows to keep its edge points in). */
  readonly padAt: (innerWidth: number) => number;
  readonly live: ScatterLive;
  readonly colorDomain: string[];
  readonly colorRange: string[];
  /** The series' place among the Scatter carriers (the jitter hash's input). */
  readonly seriesIndex: number;
  readonly jittered: JitterState | null;
  /** The y domain of an axis (a jittered y offset in px becomes value units through it). */
  readonly yDomainOf: (axis: string) => readonly [number, number];
  /** A dot's key: its row's time, or its row's index where times repeat. */
  readonly keyRow: (d: Row) => number;
}

/** The dot marks of one series (outline ring, disc + ring, or separate ring) with their per-datum entrance. */
function seriesMarks(s: ScatterSeries, deps: SeriesMarksInput): ScatterMark[] {
  const { input, data, xOf, minT, span, padAt, live, colorDomain, colorRange, seriesIndex, jittered, yDomainOf, keyRow } = deps;
  const { animationDuration, easing, revealed } = input;
  const marks: ScatterMark[] = [];
  const keyOf = (d: Row): string => `${s.dataKey}:${keyRow(d)}`;
  const valueOf = (d: Row): number => toNumber(d[s.dataKey]);
  const rows = revealed ? data.filter((d) => Number.isFinite(valueOf(d))) : [];
  // Jittered: each dot moves by its seeded offset, x in ms (any width) and y in px (through the axis' domain at the measured height).
  const offsetOf = (d: Row): { readonly x: number; readonly y: number } =>
    jittered === null ? { x: 0, y: 0 } : jitterOffset(jittered.jitter, jittered.gap, jittered.rowIndex.get(d) ?? 0, seriesIndex);
  const dotX = jittered === null || jittered.jitter.x <= 0 ? xOf : (d: Row): Date => new Date(xOf(d).getTime() + offsetOf(d).x);
  const yOf = jittered === null || jittered.jitter.y <= 0
    ? valueOf
    : (d: Row): number => {
        const [d0, d1] = yDomainOf(s.yAxisId);
        return valueOf(d) - (offsetOf(d).y * (d1 - d0)) / Math.max(1, live.innerHeight);
      };
  const visualExtent = s.radius + (s.ringWidth > 0 ? s.ringGap + s.ringWidth : 0) + Math.max(0, s.outlineWidth) + (s.activeScale > 1 ? s.radius * 0.35 : 0) + 2;
  // Entrance per bklit series-markers: delay (max(0, cx - visualExtent) / innerWidth) * revealDuration, cx inset by xPad.
  // At reveal end bklit swaps to static markers (a fading dot snaps visible): run `remain / ENTER_MS` of the curve, then land on 1.
  const planOf = (datum: Row): EnterPlan => {
    const pad = padAt(live.innerWidth);
    const cx = pad + ((dotX(datum).getTime() - minT) / span) * (live.innerWidth - pad * 2);
    const delay = live.innerWidth > 0 ? (Math.max(0, cx - visualExtent) / live.innerWidth) * animationDuration : 0;
    const endAt = revealEndFromEnter(input.revealClock ?? { mountedAt: null }, live.enterAt, animationDuration);
    const remain = endAt - delay;
    if (remain <= 1) {
      return { delay: endAt, duration: 1, easing };
    }
    return remain < ENTER_MS
      ? { delay, duration: remain, easing: (t) => (t >= 1 ? 1 : easing((t * remain) / ENTER_MS)) }
      : { delay, duration: ENTER_MS, easing };
  };
  // A render forced mid-entrance (web font swap after a hydrated mount, resize) re-runs the dots as an `update` and resumes the
  // same schedule; once the entrance is over an update is a data change and bklit snaps the dots.
  const enterMotion = s.animate
    ? (ctx: { phase: string; datum: Row }): ChartMotionTiming<Row> | false | undefined => {
        if (ctx.phase === "enter") {
          live.enterAt ??= performance.now();
          const plan = planOf(ctx.datum);
          return { delay: plan.delay, transition: { duration: plan.duration, easing: plan.easing, type: "tween" } };
        }
        return ctx.phase === "update" ? resumeEnter(planOf(ctx.datum), live.enterAt) : undefined;
      }
    : false;
  const pre = s.dim ? "" : "nodim:";
  const common = {
    ...yScaleOption(s.yAxisId),
    ...markRendererOption(s.renderer),
    x: dotX,
    z: (): string => s.dataKey,
    motion: erase(enterMotion),
  };

  if (s.outlineWidth > 0) {
    const ringOuter = s.ringWidth > 0 ? s.radius + s.ringGap + s.ringWidth : s.radius;
    marks.push(
      dot(rows, {
        ...common,
        id: `${pre}${s.dataKey}:outline`,
        y: yOf,
        key: keyOf,
        r: ringOuter + s.outlineWidth / 2,
        fill: "none",
        stroke: s.outlineColor,
        strokeWidth: s.outlineWidth,
      }),
    );
  }

  if (s.ringWidth > 0 && s.stroke === s.fill) {
    // bklit dims a point's disc + ring as ONE group, so the pair rides one mark: two circles per datum told apart by a colour key
    // (series colour or "none"); the disc is inset by half the ring width and its stroke fills the rest, keeping its outer edge at `radius`.
    const discKey = `${s.dataKey}:disc`;
    const ringKey = `${s.dataKey}:ring`;
    colorDomain.push(discKey, ringKey);
    colorRange.push(s.fill, "none");
    marks.push(
      dot(
        rows.flatMap((d) => [d, d]),
        {
          ...common,
          id: `${pre}${s.dataKey}`,
          y: yOf,
          color: (_d: Row, { index }: { index: number }) => (index % 2 === 0 ? discKey : ringKey),
          key: (d: Row, { index }: { index: number }) => `${keyOf(d)}:${index % 2}`,
          r: (_d: Row, { index }: { index: number }) => (index % 2 === 0 ? s.radius - s.ringWidth / 2 : s.radius + s.ringGap + s.ringWidth / 2),
          stroke: s.stroke,
          strokeWidth: s.ringWidth,
        },
      ),
    );
  } else {
    marks.push(dot(rows, { ...common, id: `${pre}${s.dataKey}`, y: yOf, key: keyOf, r: s.radius, fill: s.fill }));
    if (s.ringWidth > 0) {
      marks.push(
        dot(rows, {
          ...common,
          id: `${pre}${s.dataKey}:ring`,
          y: yOf,
          key: keyOf,
          r: s.radius + s.ringGap + s.ringWidth / 2,
          fill: "none",
          stroke: s.stroke,
          strokeWidth: s.ringWidth,
        }),
      );
    }
  }
  return marks;
}

interface FocusPoint {
  readonly markId: string;
  readonly datum: unknown;
  readonly x: number;
  readonly y: number;
  readonly xValue: unknown;
  readonly yValue: unknown;
}

interface JitterFocusInput {
  /** Each series' disc mark id, in series order. */
  readonly discMarks: readonly string[];
  readonly seriesOfMark: ReadonlyMap<string, number>;
  readonly outsidePlot: (context: { x: number; y: number }) => boolean;
  /** A dot's real x and y (its row's date and value), which the jitter moved. */
  readonly realOf: (point: FocusPoint) => { readonly x: Date; readonly y: number } | undefined;
}

/**
 * A jittered chart's focus (bklit use-scatter-chart-interaction.ts `resolveTooltipFromPoint`): the dot nearest the pointer in both axes,
 * grouped with its row's dots in the other series, each carrying its row's real date and value (the tooltip's title and rows), not
 * the moved ones. Keyboard order runs left to right.
 */
function jitterFocus({ discMarks, seriesOfMark, outsidePlot, realOf }: JitterFocusInput) {
  const discs = new Set(discMarks);
  // One copy per point, so a focus that holds keeps its points (the renderer compares them).
  const real = new WeakMap<FocusPoint, FocusPoint>();
  const realPoint = <P extends FocusPoint>(point: P): P => {
    const known = real.get(point);
    if (known !== undefined) {
      // SAFETY: the copy was made from this point, with the same fields.
      return known as P;
    }
    const values = realOf(point);
    const copy = values === undefined ? point : { ...point, xValue: values.x, yValue: values.y };
    real.set(point, copy);
    return copy;
  };
  return {
    resolve: <P extends FocusPoint>(points: readonly P[], context: { x: number; y: number; maxDistance: number }): P[] => {
      if (outsidePlot(context)) {
        return [];
      }
      let nearest: P | undefined;
      let best = Number.POSITIVE_INFINITY;
      for (const point of points) {
        if (seriesOfMark.has(point.markId)) {
          const distance = (point.x - context.x) ** 2 + (point.y - context.y) ** 2;
          if (distance < best) {
            best = distance;
            nearest = point;
          }
        }
      }
      return nearest === undefined ? [] : [nearest];
    },
    group: <P extends FocusPoint>(points: readonly P[], { point }: { point: P }): P[] => {
      // One point per series: a ringed disc's mark holds two circles per row.
      const seen = new Set([seriesOfMark.get(point.markId)]);
      const group = [realPoint(point)];
      for (const candidate of points) {
        const seriesIndex = seriesOfMark.get(candidate.markId);
        if (candidate.datum === point.datum && discs.has(candidate.markId) && !seen.has(seriesIndex)) {
          seen.add(seriesIndex);
          group.push(realPoint(candidate));
        }
      }
      return group;
    },
    navigation: <P extends FocusPoint>(points: readonly P[]): P[] => points.filter((point) => discs.has(point.markId)).toSorted((a, b) => a.x - b.x || a.y - b.y),
  };
}

export interface ScatterBuild {
  definition: ChartDefinition<Row, Date, number>;
  series: readonly ScatterSeries[];
  tooltipEnabled: boolean;
  /** The hover indicator (null without a Tooltip), placed by the host's HoverOverlay. */
  overlay: HoverOverlayModel | null;
  /** Resolved plot domains: x depends on the measured width (px inset), y is per axis id. */
  domains: { x: (width: number) => [Date, Date]; y: Record<string, [number, number]> };
  /** Tick values (ms) and span (ms) at a measured width, for the date pill's scoped tick-blanking CSS. */
  pillTicks: (width: number) => PillTickInfo | null;
  /** Host attributes for the static grid edge-fade rules (styles.css). */
  gridAttrs: Record<string, string | undefined>;
  /** Tells a jittered chart's overlay which series the focused point is in (its mark id), before the overlay moves to it. */
  noteFocus: (markId: string | null) => void;
}

export function buildScatterDefinition(input: ScatterInput): ScatterBuild {
  const { data, xKey, table, margin } = input;
  const series = resolveScatterSeries(table);
  const tooltipProps = propsFor<TooltipProps>(table, "tooltip").at(0);
  const tooltipEnabled = tooltipProps !== undefined;
  const grid = propsFor<GridProps>(table, "grid").at(0);
  const xAxis = propsFor<XAxisProps>(table, "xAxis").at(0);
  const yAxes = propsFor<YAxisProps>(table, "yAxis");

  const rowTimes = data.map((row) => toDate(row[xKey]).getTime());
  const minT = rowTimes.length > 0 ? minOf(rowTimes) : 0;
  const maxT = rowTimes.length > 0 ? maxOf(rowTimes) : 1;
  const span = Math.max(1, maxT - minT);
  const xPad = (series.length > 0 ? Math.max(...series.map((s) => s.radius)) : 5) + 10;
  const live: ScatterLive = { innerWidth: 0, innerHeight: 0, enterAt: null };
  const { jitter } = input;
  const formatX = input.formatXLabel ?? shortDateByDay();
  const rowIndex = new Map(data.map((row, i) => [row, i] as const));
  // A dot's key is its row's time, or its row's index where times repeat (a strip plot): two dots never share one.
  const timesRepeat = new Set(rowTimes).size !== rowTimes.length;
  const keyRow = timesRepeat ? (d: Row): number => rowIndex.get(d) ?? -1 : (d: Row): number => toDate(d[xKey]).getTime();
  const step = jitter !== null && jitter.x > 0 ? minDistinctStep(rowTimes) : { gap: 0, ratio: 0 };
  const jittered: JitterState | null = jitter === null ? null : { focused: { current: null }, gap: step.gap, jitter, rowIndex };
  // bklit's x range padding: (radius + 10)px, widened by a jitter so its edge points stay in the plot (scatter-jitter.ts).
  const padAt = (innerWidth: number): number => (jitter === null ? xPad : jitterRangePadding(xPad, innerWidth, step.ratio, jitter.x));

  const valuesByAxis = new Map<string, number[]>();
  for (const s of series) {
    const list = valuesByAxis.get(s.yAxisId) ?? [];
    for (const row of data) {
      list.push(toNumber(row[s.dataKey]));
    }
    valuesByAxis.set(s.yAxisId, list);
  }
  if (!valuesByAxis.has(DEFAULT_Y_AXIS)) {
    valuesByAxis.set(DEFAULT_Y_AXIS, []);
  }
  const yDomains = new Map([...valuesByAxis].map(([id, values]) => [id, yDomain(values)] as const));

  const gradients: ChartGradient[] = userGradients(table);
  // bklit's Grid ticks are independent of the axis labels' and can drop edge lines: those rows are marks under the series.
  const primaryAxis = yAxes.find((a) => axisId(a.yAxisId) === DEFAULT_Y_AXIS);
  const rowGuides = gridRowGuides(grid, scaleLinear().domain(yDomains.get(DEFAULT_Y_AXIS) ?? [0, 100]), primaryAxis !== undefined, primaryAxis?.numTicks);
  const xOf = (d: Row): Date => toDate(d[xKey]);

  const colorDomain: string[] = [];
  const colorRange: string[] = [];
  const marks: ScatterMark[] = [...rowGuides.marks];
  const yDomainOf = (axis: string): readonly [number, number] => yDomains.get(axis) ?? [0, 100];
  for (const [seriesIndex, s] of series.entries()) {
    marks.push(...seriesMarks(s, { input, data, xOf, minT, span, padAt, live, colorDomain, colorRange, seriesIndex, jittered, yDomainOf, keyRow }));
  }

  const pill = tooltipProps === undefined || tooltipProps.showDatePill === false ? null : pillLayout(data.map((row) => formatX(toDate(row[xKey]))));
  const overlay = tooltipProps === undefined ? null : tooltipOverlay({ tooltipProps, series, data, xOf, pill, formatX, jittered });

  const yScales = resolveYScales(yDomains, yAxes, grid, rowGuides);

  const xTicks: { count: number } | { values: Date[] } = xAxis?.tickMode === "domain" ? { count: xAxis.numTicks ?? 5 } : { values: dataTickValues(data, xKey, xAxis?.numTicks ?? 5) };
  const baseFormatX = xAxis?.formatValue ?? formatX;

  // bklit insets the x range by (radius + 10)px; widen the domain by the same pixel amount.
  const xDomainAt = (width: number): [Date, Date] => {
    const pad = padAt(Math.max(1, width - margin.left - margin.right));
    const plot = Math.max(1, width - margin.left - margin.right - pad * 2);
    // A single time has no extent: Date holds whole ms, so a sub-ms pad rounds away and the dot lands on the edge; 1ms either side centres it.
    if (maxT === minT) {
      return [new Date(minT - 1), new Date(maxT + 1)];
    }
    const padMs = (pad * span) / plot;
    return [new Date(minT - padMs), new Date(maxT + padMs)];
  };
  const outsidePlot = (context: { x: number; y: number }): boolean => {
    const outsideX = context.x < margin.left || context.x > margin.left + live.innerWidth;
    const outsideY = context.y < margin.top || context.y > margin.top + live.innerHeight;
    return live.innerHeight > 0 && (outsideX || outsideY);
  };
  // The series of each dot mark (disc, ring, outline), and each series' disc mark: a jittered focus picks among them.
  const seriesOfMark = new Map<string, number>();
  const discMarks: string[] = [];
  for (const [seriesIndex, s] of series.entries()) {
    const id = `${s.dim ? "" : "nodim:"}${s.dataKey}`;
    discMarks.push(id);
    for (const markId of [id, `${id}:ring`, `${id}:outline`]) {
      seriesOfMark.set(markId, seriesIndex);
    }
  }
  const focusStrategy = (): unknown => {
    if (!tooltipEnabled) {
      return undefined;
    }
    if (jittered === null) {
      // group-x, but only inside the inner plot (bklit's inner-sized hit rect): no tooltip or pill over the margins and axes.
      // Thousands of dots: the strategy runs on the nearest column's points only (interaction/x-window.ts), which returns the same.
      return {
        ...focusGroupX,
        resolve: (points: Parameters<typeof focusGroupX.resolve>[0], context: { x: number; y: number; maxDistance: number }): ReturnType<typeof focusGroupX.resolve> =>
          outsidePlot(context) ? [] : focusGroupX.resolve(nearestXWindow(points, context.x), context),
        group: (points: Parameters<typeof focusGroupX.group>[0], context: Parameters<typeof focusGroupX.group>[1]): ReturnType<typeof focusGroupX.group> =>
          focusGroupX.group(columnWindow(points, context.point), context),
        navigation: (points: Parameters<typeof focusGroupX.navigation>[0]): ReturnType<typeof focusGroupX.navigation> => cachedNavigation(points, focusGroupX.navigation),
      };
    }
    return jitterFocus({ discMarks, outsidePlot, realOf: (point) => {
      const seriesIndex = seriesOfMark.get(point.markId);
      const s = seriesIndex === undefined ? undefined : series[seriesIndex];
      // SAFETY: a dot's datum is one of this chart's rows.
      const row = point.datum as Row;
      return s === undefined ? undefined : { x: xOf(row), y: toNumber(row[s.dataKey]) };
    }, seriesOfMark });
  };
  const boxMotion = tooltipBoxMotion(tooltipProps);
  const definition: ChartDefinition<Row, Date, number> = erase(defineChart(erase({
    chart: ({ width, height }: { width: number; height: number }): ScatterChartConfig => {
      input.sizeStore.set(Math.round(width), Math.round(height));
      live.innerWidth = Math.max(1, width - margin.left - margin.right);
      live.innerHeight = height - margin.top - margin.bottom;
      const xDomain = xDomainAt(width);
      const columnMarks = gridColumnGuides(grid, scaleTime().domain(xDomain));
      const xScale = {
        scale: scaleUtc().domain(xDomain),
        grid: false,
        // bklit x-axis.tsx:397-430 builds every tick with no collision test.
        axis: xAxis === undefined
          ? false
          : { line: false, ticks: { ...xTicks, size: 0, padding: X_TICK_PADDING, format: baseFormatX }, tickLabels: { fontSize: 12, opacity: 1, thin: false } },
      };
      const scaleEntries: [string, unknown][] = [["x", xScale], ...yScales];
      if (!yScales.has("y")) {
        scaleEntries.push(["y", { scale: scaleLinear().domain([0, 100]), axis: false }]);
      }
      const config: ScatterChartConfig = {
        marks: [...columnMarks, ...marks],
        scales: Object.fromEntries(scaleEntries),
        margin,
        theme: bklitTheme,
        gradients,
      };
      if (colorDomain.length > 0) {
        config.color = { domain: colorDomain, range: colorRange };
      }
      return config;
    },
    // group-x, but only inside the inner plot (bklit's inner-sized hit rect): no tooltip or pill over the margins and axes.
    focus: focusStrategy(),
    maxFocusDistance: Number.POSITIVE_INFINITY,
    focusRing: false,
    tooltip: tooltipEnabled
      ? { use: bklitTooltip, ...BKLIT_TOOLTIP_PLACEMENT, sticky: false, motion: boxMotion }
      : false,
  })));

  let pillCache: { width: number; info: PillTickInfo | null } | null = null;
  const pillTicks = (width: number): PillTickInfo | null => {
    if (pillCache?.width === width) {
      return pillCache.info;
    }
    const info = pillTicksAt(width);
    pillCache = { width, info };
    return info;
  };
  const pillTicksAt = (width: number): PillTickInfo | null => {
    if (!tooltipEnabled || tooltipProps.showDatePill === false || series.length === 0) {
      return null;
    }
    const domain = xDomainAt(width);
    const tickDates = "values" in xTicks ? xTicks.values : scaleUtc().domain(domain).ticks(xTicks.count);
    const times = withPillGeometry(tickDates.map((d) => d.getTime()), { plotLeft: margin.left, domainStart: domain[0].getTime() });
    return { times, spanMs: domain[1].getTime() - domain[0].getTime(), plotWidth: Math.max(1, width - margin.left - margin.right), reachPx: 62 };
  };
  const noteFocus = (markId: string | null): void => {
    if (jittered !== null) {
      jittered.focused.current = markId === null ? null : (seriesOfMark.get(markId) ?? null);
    }
  };
  return { definition, series, tooltipEnabled, overlay, domains: { x: xDomainAt, y: Object.fromEntries(yDomains) }, pillTicks, gridAttrs: gridHostAttrs(grid), noteFocus };
}

/** Hover emphasis (bklit `fadeOnHover` + `showActiveHighlight`) as FIXED rules: the host carries `data-bkm-hover` while a column is focused plus `--bkm-inactive` (opacity) and `--bkm-blur` (px);
 * every dot group dims + blurs as one layer (like bklit), the focused column's active copy is a native focus mark, and series with `fadeOnHover` off carry a `nodim:` mark id. */
const GROUPS = /* @__PURE__ */ (() => `[data-bkm-chart="scatter"] g${CLS.dot}:not(${/* @__PURE__ */ keyStarts("nodim:")})`)();
const HOVERING = '[data-bkm-chart="scatter"][data-bkm-interactive][data-bkm-hover]';
export const SCATTER_HOVER_CSS = /* @__PURE__ */ [
  // bklit's enter blur (`--bkm-enter-blur`, default 2px) follows the in-flight `opacity` attribute. Not in styles.css (the CSS pipeline drops `attr(type())`);
  // typed attr() is Chromium-only (133+), so under `@supports` other browsers enter without the blur.
  /* @__PURE__ */ typedAttr(`[data-bkm-chart="scatter"] ${CLS.dot} circle[opacity]:not([opacity="1"]){filter:blur(calc((1 - attr(opacity type(<number>), 1)) * var(--bkm-enter-blur, 2) * 1px))}`),
  // Hover and keyboard focus are live from the reveal's first frame (`data-bkm-interactive`).
  /* @__PURE__ */ interactiveGateCss('[data-bkm-chart="scatter"]'),
  // No transition on the dots (series-point-marker.tsx:95); the fade lives on the dim wrapper group (series-markers.tsx:240-251): bklit 150ms ease-in-out, the snappy variant's hover profile.
  // Dim layer: one opacity + blur per series' dot group while hovered, toggled on enter / leave only; the active copy is a focus mark.
  `${GROUPS}{transition:opacity ${HOVER_TRANSITION_CSS},filter ${HOVER_TRANSITION_CSS}}`,
  `${HOVERING} g${CLS.dot}:not(${/* @__PURE__ */ keyStarts("nodim:")}){opacity:var(--bkm-inactive)}`,
  // `inactiveMode: "blur"` only: the default fade takes no filter at all.
  `${HOVERING}[data-bkm-dim-blur] g${CLS.dot}:not(${/* @__PURE__ */ keyStarts("nodim:")}){filter:blur(calc(var(--bkm-blur) * 1px))}`,
  // Dots on a canvas (`renderer={canvasRenderer}`, pass.ts `data-bkm-cv-dim`): the bitmap is the dim layer.
  `[data-bkm-chart="scatter"] ${CLS.canvas}{transition:opacity ${HOVER_TRANSITION_CSS},filter ${HOVER_TRANSITION_CSS}}`,
  `${HOVERING}[data-bkm-cv-dim] ${CLS.canvas}{opacity:var(--bkm-inactive)}`,
  `${HOVERING}[data-bkm-cv-dim][data-bkm-dim-blur] ${CLS.canvas}{filter:blur(calc(var(--bkm-blur) * 1px))}`,
  // Their entrance: the canvas appears with the dots (the reveal pass) and sweeps in from the plot's left edge over the reveal, as the dots'
  // x-staggered fades do (styles/cartesian.css `bkm-wipe-cv`); it is done before the reveal timer raises `data-bkm-ready`.
  `[data-bkm-chart="scatter"][data-bkm-cv-in]:not([data-bkm-ready]) ${CLS.canvas}{animation:bkm-wipe-cv var(--bkm-enter-ms) cubic-bezier(0.85,0,0.15,1) backwards}`,
].join("");
