import type { EnterTransition } from "../motion/phase";
import { resumeEnter } from "../motion/resume-enter";
import { REST_GRANULAR, REST_NEVER, settleMs, springFrequency, springOf } from "../motion/spring-curve";
import { HOVER_TRANSITION_CSS } from "../motion/springs";
import type { Spring } from "../motion/springs";
import { barY, defineChart } from "@tanstack/charts";
import type { ChartMark, ChartMotionDefinition, ChartMotionTransition, ChartPoint, DomChartDefinition } from "@tanstack/charts";
import { focusNearestX } from "@tanstack/charts/focus";
import { decorative } from "@tanstack/charts/mark/decorative";
import { bklitTooltip } from "../tooltip/bklit-tooltip";
import { tooltipBoxMotion } from "../tooltip/box-motion";
import type { TooltipBoxMotionProps } from "../tooltip/box-motion";
import { scaleLinear, scaleTime, scaleUtc } from "../scales";
import { propsFor } from "../carriers/table";
import type { ChildTable } from "../carriers/table";
import { erase } from "../erased-types";
import { overlaysFor } from "../cartesian/features";
import { shortDateFmt } from "../format";
import { DEFAULT_Y_AXIS_ID, toDate } from "../cartesian/series";
import { dataTickValues } from "../cartesian/x-axis";
import { formatTick } from "../cartesian/y-axis";
import { niced } from "../cartesian/domains";
import { gridColumnGuides, gridHostAttrs, gridLineStyle, gridRowGuides } from "../cartesian/grid-guides";
import type { GridGuideProps as GridProps } from "../cartesian/grid-guides";
import { BKLIT_TOOLTIP_PLACEMENT, MS_PER_SECOND, X_TICK_PADDING, bklitTheme } from "../theme";
import type { ChartMargin } from "../theme";
import { pillLayout, withPillGeometry } from "../cartesian/date-pill";
import type { HoverOverlayModel } from "../cartesian/hover-overlay";
import type { CandlestickProps } from "../types/candlestick";
import { interactiveGateCss } from "../cartesian/gate-css";
import { userGradients } from "../gradients";
import { FOCUS_MARK } from "../hover/focus-marks";
import { NOT_MOTION, keyEnds, keyHas, keyIs } from "../renderer-dom";

export type Candle = Record<string, unknown>;

export interface CandlestickInput {
  readonly data: readonly Candle[];
  readonly xKey: string;
  readonly table: ChildTable;
  readonly margin: ChartMargin;
  readonly uid: string;
  readonly animationDuration: number;
  readonly enterTransition?: EnterTransition;
  readonly xDomain?: readonly [Date, Date];
  readonly xDomainSlotCount?: number;
  readonly candleWidth?: number;
  /** bklit's AnimatedCandle phase (before `isLoaded`): body and wick split at the centre into two bars growing outward (native `scaleY`); `isLoaded` swaps in static candles. */
  readonly entrance?: boolean;
}

interface XAxisProps {
  numTicks?: number;
  tickMode?: "domain" | "data";
  formatValue?: (value: Date) => string;
}
interface YAxisProps {
  numTicks?: number;
  formatLargeNumbers?: boolean;
  formatValue?: (value: number) => string;
}
interface TooltipProps extends TooltipBoxMotionProps {
  showDatePill?: boolean;
  showCrosshair?: boolean;
  showDots?: boolean;
  dotSize?: number;
  dotStrokeWidth?: number;
  indicatorColor?: string | ((point: Candle) => string);
  indicatorDasharray?: string;
  dotColor?: string | ((point: Candle, line: { dataKey: string }) => string);
}

const POSITIVE = "var(--chart-positive)";
const NEGATIVE = "var(--chart-negative)";
const DEFAULT_GRADIENT_FILLS = /* @__PURE__ */ new Set(["url(#candlestick-positive)", "url(#candlestick-negative)"]);
const WICK_WIDTH = 1.5;
const outsideSpan = (value: number, start: number, size: number): boolean => value < start || value > start + size;

// SAFETY: a candle x is a Date, ISO string or epoch number; any other value yields an Invalid Date, which every caller already filters.
// null / undefined are missing (Number(null) would be 0 and drag the y domain to zero); bklit draws such a candle as garbage at the top edge, here it is a gap.
const num = (v: unknown): number => (v === null || v === undefined ? Number.NaN : Number(v));
const isPositive = (d: Candle): boolean => num(d.close) >= num(d.open);

/** Maps bklit's motion-style `Transition` to a native tween; every spring runs as an analytic curve (`resolveEnterCurve`) on a tween. */
function resolveEnterTransition(t: EnterTransition | undefined): ChartMotionTransition {
  return { type: "tween", duration: (t?.duration ?? 0.8) * MS_PER_SECOND, easing: "ease-out" };
}

interface EnterCurve {
  /** Total run time (ms): motion ends the spring here. */
  readonly durationMs: number;
  /** Position at time t (ms, 0..durationMs) for a 0 -> 1 move, overshoot included. */
  readonly at: (tMs: number) => number;
}

const SETTLE_STEP_MS = 8;
const SETTLE_LIMIT_MS = 10_000;
// bklit animates `scaleY` 0 -> 1 about the candle centre: a span under 5, so motion's granular rest thresholds (REST_GRANULAR).
const UNIT_MOVE = { from: 0, to: 1, velocity: 0 };

/** The analytic 0 -> 1 curve of a physics spring (motion's defaults 100 / 10 / 1), ended where motion's granular rest thresholds are met. */
function physicsCurve(spring: Spring, capMs: number): EnterCurve {
  const native = springOf(spring, REST_GRANULAR);
  return { durationMs: settleMs(native, UNIT_MOVE, SETTLE_STEP_MS, Math.min(capMs, SETTLE_LIMIT_MS)), at: (tMs) => native.sample(tMs, UNIT_MOVE).value };
}

/** The analytic curve of bklit's spring enter (duration/bounce, or stiffness/damping), or null for a tween. Runs on a tween so the reveal timer's cut (below)
 * lands on it like bklit's; rest is on the `scaleY` span, not the native px geometry of the two half bars. */
function resolveEnterCurve(t: EnterTransition | undefined): EnterCurve | null {
  if (t?.type === "tween") {
    return null;
  }
  if (t?.stiffness !== undefined || t?.damping !== undefined) {
    return physicsCurve({ damping: t.damping ?? 10, mass: t.mass ?? 1, stiffness: t.stiffness ?? 100 }, SETTLE_LIMIT_MS);
  }
  const duration = t?.duration ?? 0.8;
  const bounce = t?.bounce ?? 0.15;
  if (bounce <= 0 || bounce >= 0.95) {
    const omega = (2 * Math.PI) / duration;
    return physicsCurve({ damping: 2 * (1 - bounce) * omega, mass: 1, stiffness: omega * omega }, duration * MS_PER_SECOND);
  }
  const w0 = springFrequency(duration, bounce);
  // motion ends this spring at `duration`, not where it rests: sampled without a snap to the target.
  const native = springOf({ damping: 2 * (1 - bounce) * w0, mass: 1, stiffness: w0 * w0 }, REST_NEVER);
  return { durationMs: duration * MS_PER_SECOND, at: (tMs) => native.sample(tMs, UNIT_MOVE).value };
}

/** y domain: low/high padded 5%, niced (bklit). */
function yExtent(rows: readonly Candle[]): [number, number] {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const r of rows) {
    const low = num(r.low);
    const high = num(r.high);
    if (Number.isFinite(low)) { lo = Math.min(lo, low); }
    if (Number.isFinite(high)) { hi = Math.max(hi, high); }
  }
  if (lo === Number.POSITIVE_INFINITY) { lo = 0; }
  if (hi === Number.NEGATIVE_INFINITY) { hi = 100; }
  const pad = (hi - lo) * 0.05 || 1;
  return [lo - pad, hi + pad];
}

/** The rows inside an `xDomain` window (all of them without one): bklit's zoomed chart plots only these (docs: "The chart plots only this range of data"),
 * so the candles, the y extent, the data ticks and the hover rows all follow the window. */
export function windowRows(rows: readonly Candle[], xKey: string, xDomain?: readonly [Date, Date]): readonly Candle[] {
  if (!xDomain) {
    return rows;
  }
  const lo = xDomain[0].getTime();
  const hi = xDomain[1].getTime();
  return rows.filter((row) => {
    const t = toDate(row[xKey]).getTime();
    return t >= lo && t <= hi;
  });
}

/** x domain padded by half a slot each side, so edge candles sit inside the plot like bklit's range inset. */
function xExtent(rows: readonly Candle[], xKey: string, xDomain?: readonly [Date, Date], slots?: number): [Date, Date] {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  if (xDomain) {
    lo = xDomain[0].getTime();
    hi = xDomain[1].getTime();
  } else {
    for (const r of rows) {
      const t = toDate(r[xKey]).getTime();
      lo = Math.min(lo, t);
      hi = Math.max(hi, t);
    }
  }
  if (!Number.isFinite(lo)) { return [new Date(0), new Date(1)]; }
  const count = slots ?? rows.length;
  const pad = count > 1 && hi > lo ? (hi - lo) / (count - 1) / 2 : 43_200_000;
  return [new Date(lo - pad), new Date(hi + pad)];
}

export interface CandlestickDomains {
  x: [Date, Date];
  y: [number, number];
}

/** Resolved plot domains (x padded by half a slot, y padded and niced), for the public chart context. */
export function candlestickDomains(
  rows: readonly Candle[],
  xKey: string,
  xDomain?: readonly [Date, Date],
  slots?: number,
): CandlestickDomains {
  const visible = windowRows(rows, xKey, xDomain);
  return { x: xExtent(visible, xKey, xDomain, slots), y: niced(yExtent(visible)) };
}

export interface CandlestickBuild {
  definition: DomChartDefinition<Candle, Date, number>;
  /** x tick values (ms), the plot-wide x span (ms) and the pill reach (px): scoped tick-blanking CSS. */
  pillTicks: { readonly times: readonly number[]; readonly spanMs: number; readonly reachPx: number; readonly active: boolean };
  /** Chart-hover dim opacity (null when `showHoverFade` is off): the `--bkm-faded` host var. */
  readonly hoverFadeOpacity: number | null;
  readonly fadedOpacity: number;
  /** The hover indicator (null without a Tooltip) and the domains it places by. */
  readonly overlay: HoverOverlayModel | null;
  readonly plotDomains: { readonly x: readonly [number, number]; readonly y: readonly [number, number] };
  /** Host attributes for the static grid edge-fade rules (styles.css). */
  readonly gridAttrs: Record<string, string | undefined>;
}

type CandleMark = ChartMark<Candle, Date, number>;

/** A candle as one line of text: the tooltip's accessible label. */
const candleText = (d: Candle, xKey: string): string =>
  `${shortDateFmt.format(toDate(d[xKey]))}: open ${num(d.open)}, high ${num(d.high)}, low ${num(d.low)}, close ${num(d.close)}`;

const wickMid = (d: Candle): number => (num(d.high) + num(d.low)) / 2;

const solid = (fill: string | undefined, fallback: string): string => (fill === undefined || DEFAULT_GRADIENT_FILLS.has(fill) ? fallback : fill);

// A per-point colour function has no single paint here, so it falls back like an unset value.
// oxlint-disable-next-line anti-slop/no-runtime-typeof -- the carrier prop is bklit's public `string | function` union, discriminated at its only boundary.
const colorOr = (value: string | ((...args: never[]) => string) | undefined, fallback: string): string => (typeof value === "function" ? fallback : (value ?? fallback));

/** A per-row colour function as the overlay reads it (rows are the chart's candles), or undefined for a fixed colour. */
// oxlint-disable-next-line anti-slop/no-runtime-typeof -- the carrier prop is bklit's public `string | function` union, discriminated at its only boundary.
const rowColor = (value: string | ((point: Candle) => string) | undefined): ((row: Candle) => string) | undefined => (typeof value === "function" ? (row) => value(row) : undefined);

/** A function `dotColor` per focused candle (bklit calls it with the point and the close series). */
// oxlint-disable-next-line anti-slop/no-runtime-typeof -- the carrier prop is bklit's public `string | function` union, discriminated at its only boundary.
const dotColorOf = (value: TooltipProps["dotColor"]): ((row: Candle) => string) | undefined => (typeof value === "function" ? (row) => value(row, { dataKey: "close" }) : undefined);

const curveEasing = (curve: EnterCurve, run: number) => (u: number): number => (u >= 1 ? 1 : curve.at(u * run));

/** bklit swaps to static candles when its reveal timer ends (`animationDuration` after mount), cutting any spring in flight; replay the same cut on the analytic curve. */
function candleMotion(input: CandlestickInput, stagger: number): ChartMotionDefinition<Candle> {
  const curve = resolveEnterCurve(input.enterTransition);
  const transition = resolveEnterTransition(input.enterTransition);
  // Clock of the first enter call: a render forced mid-entrance (web-font swap) is an update and resumes this schedule.
  let enterAt: number | null = null;
  // bklit swaps to static candles `animationDuration` after its mount effect; the native enter starts in that same commit.
  const endAt = (): number => input.animationDuration;
  return (ctx) => {
    const delay = ctx.datumIndex * stagger;
    if (ctx.phase === "update") {
      if (!curve) {
        return undefined;
      }
      const run = Math.max(1, Math.min(curve.durationMs, endAt() - delay));
      return resumeEnter({ delay: Math.min(delay, endAt()), duration: run, easing: curveEasing(curve, run) }, enterAt);
    }
    if (ctx.phase === "exit") {
      // bklit unmounts a candle instantly (also the entrance's lower body half at the `isLoaded` swap).
      return false;
    }
    enterAt ??= performance.now();
    if (!curve) {
      return { delay, transition };
    }
    const run = Math.max(1, Math.min(curve.durationMs, endAt() - delay));
    return { delay: Math.min(delay, endAt()), transition: { type: "tween", duration: run, easing: curveEasing(curve, run) } };
  };
}

interface CandleMarkInput {
  readonly rows: readonly Candle[];
  readonly xKey: string;
  readonly motion: ChartMotionDefinition<Candle>;
  readonly positiveFill: string;
  readonly negativeFill: string;
  /** bklit `bodyPatternPositive` / `bodyPatternNegative`: a fill (`url(#…)`) laid over the solid body of that direction. */
  readonly patterns: { readonly positive: string | undefined; readonly negative: string | undefined };
  /** bklit `insideStrokeWidth`: a frame of that width drawn inside each body, in its solid colour. */
  readonly insideStroke: number;
  readonly candleWidth: number | undefined;
  readonly entrance: boolean;
  /** Data units per pixel, read per call (the `chart` callback writes the plot height before any mark renders). */
  readonly onePx: () => number;
}

function candleMarks({ rows, xKey, motion, positiveFill, negativeFill, patterns, insideStroke, candleWidth, entrance, onePx }: CandleMarkInput): CandleMark[] {
  const keyOf = (d: Candle): string => `${isPositive(d) ? "pos" : "neg"}:${toDate(d[xKey]).getTime()}`;
  const patternOf = (d: Candle): string | undefined => (isPositive(d) ? patterns.positive : patterns.negative);
  // bklit: a body with a pattern overlay is drawn in the direction's solid colour (its fill is ignored), and so is its wick.
  const fillOf = (d: Candle): string => {
    if (patternOf(d) !== undefined) {
      return isPositive(d) ? POSITIVE : NEGATIVE;
    }
    return isPositive(d) ? positiveFill : negativeFill;
  };
  const common = { x: (d: Candle): Date => toDate(d[xKey]), key: keyOf, fill: fillOf, motion };
  // bklit's body: open..close, with `|close - open| || 1` px height (a zero-height rect paints nothing, so add that pixel in data units).
  const bodyClose = (d: Candle): number => (num(d.open) === num(d.close) ? num(d.close) - onePx() : num(d.close));
  const bodyHi = (d: Candle): number => Math.max(num(d.open), bodyClose(d));
  const bodyLo = (d: Candle): number => Math.min(num(d.open), bodyClose(d));
  // bklit scales body and wick about their centres (candlestick.tsx AnimatedCandle `bodyOrigin`, `wickCenterY`): during the
  // entrance each is two bars growing from its centre, sharing the candle's delay and curve.
  const bodyMid = (d: Candle): number => (bodyHi(d) + bodyLo(d)) / 2;
  const bodyBase = { stroke: fillOf, strokeWidth: 1, radius: 1, z: (): string => "close" };
  const bodyStyle = candleWidth === undefined ? bodyBase : { ...bodyBase, maxThickness: candleWidth };
  // Each wick covers only the part outside the body at rest (bklit's dimmed candle `g` hides the wick under the body).
  const wick = (id: string, y1: (d: Candle) => number, y2: (d: Candle) => number): CandleMark =>
    decorative(barY(rows, { ...common, id, y1, y2, maxThickness: WICK_WIDTH }));
  const marks: CandleMark[] = [
    wick("wick", entrance ? wickMid : bodyHi, (d) => num(d.high)),
    wick("wick-lo", entrance ? wickMid : bodyLo, (d) => num(d.low)),
    barY(rows, { ...common, ...bodyStyle, id: "body", y1: entrance ? bodyMid : (d: Candle): number => num(d.open), y2: entrance ? bodyHi : bodyClose }),
    // The emptied lower half stays a mark after the swap so its candles exit through this motion (instant), not the default tween.
    decorative(barY(entrance ? rows : [], { ...common, ...bodyStyle, id: "body-lo", y1: bodyMid, y2: bodyLo })),
  ];
  // The pattern overlay and the inside frame follow the body, halves included, so they grow with it.
  const patterned = rows.filter((d) => patternOf(d) !== undefined);
  if (patterned.length > 0) {
    const pattern = { ...common, ...bodyStyle, stroke: "none", strokeWidth: 0, fill: (d: Candle): string => patternOf(d) ?? "none" };
    marks.push(
      decorative(barY(patterned, { ...pattern, id: "body-pat", y1: entrance ? bodyMid : bodyLo, y2: bodyHi })),
      decorative(barY(entrance ? patterned : [], { ...pattern, id: "body-pat-lo", y1: bodyMid, y2: bodyLo })),
    );
  }
  if (insideStroke > 0) {
    // bklit's frame: a `fill="none"` rect inset by half its stroke on every side, so the stroke sits inside the body's edge.
    const half = insideStroke / 2;
    const inHi = (d: Candle): number => Math.max(bodyLo(d) + half * onePx(), bodyHi(d) - half * onePx());
    const inLo = (d: Candle): number => Math.min(bodyHi(d) - half * onePx(), bodyLo(d) + half * onePx());
    const inMid = (d: Candle): number => (inHi(d) + inLo(d)) / 2;
    const frame = { ...common, ...bodyStyle, inset: half, fill: "none", strokeWidth: insideStroke };
    marks.push(
      decorative(barY(rows, { ...frame, id: "body-in", y1: entrance ? inMid : inLo, y2: inHi })),
      decorative(barY(entrance ? rows : [], { ...frame, id: "body-in-lo", y1: inMid, y2: inLo })),
    );
  }
  return marks;
}

interface TooltipModelInput {
  readonly tt: TooltipProps;
  readonly rows: readonly Candle[];
  readonly xKey: string;
}

/** The hover indicator (crosshair rule, close dot, date pill) for the HoverOverlay the host owns (core/cartesian/hover-overlay.ts). */
function tooltipOverlay({ tt, rows, xKey }: TooltipModelInput): HoverOverlayModel {
  const labelIndex = new Map<number, number>();
  const labels = rows.map((row, i) => {
    labelIndex.set(toDate(row[xKey]).getTime(), i);
    return shortDateFmt.format(toDate(row[xKey]));
  });
  return {
    // A function `indicatorColor` colours the rule per focused candle (bklit's "tooltip line matches candle").
    crosshair: tt.showCrosshair !== false ? { color: colorOr(tt.indicatorColor, "var(--chart-crosshair)"), dash: tt.indicatorDasharray, width: 1, colorOf: rowColor(tt.indicatorColor) } : null,
    dots:
      tt.showDots !== false
        ? [{ yAxis: DEFAULT_Y_AXIS_ID, valueOf: (row) => num(row.close), glide: true, shapes: [{ r: tt.dotSize ?? 5, fill: colorOr(tt.dotColor, "var(--chart-line-primary)"), fillOf: dotColorOf(tt.dotColor), stroke: "var(--chart-background)", strokeWidth: tt.dotStrokeWidth ?? 2 }] }]
        : [],
    indexOf: (time) => labelIndex.get(time) ?? 0,
    pill: tt.showDatePill !== false ? { labels, layout: pillLayout(labels) } : null,
  };
}

export function buildCandlestickDefinition(input: CandlestickInput): CandlestickBuild {
  const { xKey, table, margin, animationDuration } = input;
  // A zoomed chart draws, scales and ticks the window's candles only: before, every row was drawn, so the candles left of the window spilled over the
  // y-axis labels and past the card, and the y range stayed the whole dataset's.
  const data = windowRows(input.data, xKey, input.xDomain);
  const candle: CandlestickProps = propsFor<CandlestickProps>(table, "candlestick").at(0) ?? {};
  const grid = propsFor<GridProps>(table, "grid").at(0);
  const xAxis = propsFor<XAxisProps>(table, "xAxis").at(0);
  const yAxis = propsFor<YAxisProps>(table, "yAxis").at(0);
  const tt = propsFor<TooltipProps>(table, "tooltip").at(0);

  const fadedOpacity = candle.fadedOpacity ?? 0.3;
  const animate = candle.animate !== false;
  const xDomain = xExtent(data, xKey, input.xDomain, input.xDomainSlotCount);
  const yDomain = yExtent(data);
  const overlays = overlaysFor(table, data, xKey, input.uid);

  const stagger = data.length > 0 ? (animationDuration * 0.6) / data.length : 0;
  // Plot size, written by the `chart` callback (runs before any focus resolve) for the plot-rect hover gate.
  const plot = { width: 0, height: 0 };
  const [yNiceLo, yNiceHi] = niced(yDomain);
  const onePx = (): number => (yNiceHi - yNiceLo) / Math.max(1, plot.height);
  // bklit's Grid ticks are independent of the axis labels' and can drop edge lines: those rows / columns are marks under the candles.
  const rowGuides = gridRowGuides(grid, scaleLinear().domain(yDomain).nice(), yAxis !== undefined, yAxis?.numTicks);
  const columnMarks = gridColumnGuides(grid, scaleTime().domain(xDomain));
  const overlay = tt === undefined ? null : tooltipOverlay({ tt, rows: data, xKey });
  const marks: CandleMark[] = [
    ...rowGuides.marks,
    ...columnMarks,
    ...candleMarks({
      rows: data,
      xKey,
      motion: animate ? candleMotion(input, stagger) : false,
      positiveFill: solid(candle.positiveFill, POSITIVE),
      negativeFill: solid(candle.negativeFill, NEGATIVE),
      patterns: { positive: candle.bodyPatternPositive || undefined, negative: candle.bodyPatternNegative || undefined },
      insideStroke: Math.max(0, candle.insideStrokeWidth ?? 0),
      candleWidth: input.candleWidth,
      entrance: input.entrance === true && animate,
      onePx,
    }),
    ...overlays.marks(yDomain, xDomain),
  ];

  const tickCount = xAxis?.numTicks ?? 5;
  const xTicks = xAxis?.tickMode === "domain" ? { count: tickCount } : { values: dataTickValues(data, xKey, tickCount) };
  const baseFormatX = xAxis?.formatValue ?? ((d: Date): string => shortDateFmt.format(d));
  const formatY = (v: number): string => {
    if (yAxis?.formatValue) {
      return yAxis.formatValue(v);
    }
    return formatTick(v, yAxis?.formatLargeNumbers !== false);
  };
  // nearest-x, but only inside the inner plot (bklit's inner-sized hit rect): no tooltip or pill over the margins and axes.
  const outsidePlot = ({ x, y }: { x: number; y: number }): boolean =>
    plot.width > 0 && plot.height > 0 && (outsideSpan(x, margin.left, plot.width) || outsideSpan(y, margin.top, plot.height));
  const boxMotion = tooltipBoxMotion(tt);
  const definition: DomChartDefinition<Candle, Date, number> = erase(defineChart(erase({
    chart: ({ width, height }: { width: number; height: number }) => {
      plot.width = width - margin.left - margin.right;
      plot.height = height - margin.top - margin.bottom;
      return {
        marks,
        scales: {
          x: {
            scale: scaleUtc().domain(xDomain),
            grid: false,
            // bklit x-axis.tsx:397-430 builds every tick with no collision test.
            axis: xAxis
              ? { line: false, ticks: { ...xTicks, size: 0, padding: X_TICK_PADDING, format: baseFormatX }, tickLabels: { fontSize: 12, opacity: 1, thin: false } }
              : false,
          },
          y: {
            scale: scaleLinear().domain(yDomain).nice(),
            grid: rowGuides.native && grid ? gridLineStyle(grid) : false,
            // bklit y-axis.tsx:106-142 draws every scale tick, no collision test.
            axis: yAxis
              ? { line: false, ticks: { count: rowGuides.count, size: 0, format: formatY }, tickLabels: { fontSize: 12, opacity: 1, thin: false } }
              : false,
          },
        },
        margin,
        theme: bklitTheme,
        // A `LinearGradient` / `RadialGradient` child is a fill the candles can name (`positiveFill="url(#…)"`).
        gradients: [...overlays.gradients, ...userGradients(table)],
      };
    },
    focus:
      tt === undefined
        ? undefined
        : {
            ...focusNearestX,
            resolve: (points: readonly ChartPoint<Candle, Date, number>[], context: { x: number; y: number; maxDistance: number }) =>
              outsidePlot(context) ? [] : focusNearestX.resolve(points, context),
          },
    maxFocusDistance: Number.POSITIVE_INFINITY,
    focusRing: false,
    // `format`: the tooltip's accessible text (the body is ours); without it TanStack formats its default rows with `toLocaleString` on every move.
    tooltip: tt === undefined ? false : { use: bklitTooltip, ...BKLIT_TOOLTIP_PLACEMENT, sticky: false, motion: boxMotion, format: (point: ChartPoint<Candle, Date, number>) => candleText(point.datum, xKey) },
  })));
  const pillActive = tt !== undefined && tt.showDatePill !== false;
  const tickTimes = pillActive ? (xTicks.values ?? scaleUtc().domain(xDomain).ticks(tickCount)).map((d) => d.getTime()) : [];
  if (pillActive) {
    // The pill geometry rides on the tick array for the static CSS distance ramp.
    withPillGeometry(tickTimes, { plotLeft: margin.left, domainStart: xDomain[0].getTime() });
  }
  return {
    definition,
    hoverFadeOpacity: candle.showHoverFade === false ? null : fadedOpacity,
    fadedOpacity,
    overlay,
    plotDomains: { x: [xDomain[0].getTime(), xDomain[1].getTime()], y: [yNiceLo, yNiceHi] },
    gridAttrs: gridHostAttrs(grid),
    pillTicks: { times: tickTimes, spanMs: xDomain[1].getTime() - xDomain[0].getTime(), reachPx: 62, active: pillActive },
  };
}

/** Fixed rules; the host carries state: `data-bkm-hover` dims every candle but the focused one (its rects carry the focus mark, hover/focus-marks.ts)
 * to `--bkm-faded`; `data-bkm-legend=0|1` dims the other direction and wins over hover (after the reveal, as bklit). Guarded so it never lags the entrance tweens.
 * A focus change restyles the two candles whose mark changed: the old rule read the focused centre from an inherited host var, which restyled every candle
 * a move (10 ms at 4x CPU on 60 candles). */
const CANDLE_MARKS = ["wick", "wick-lo", "body", "body-lo", "body-pat", "body-pat-lo", "body-in", "body-in-lo"];
const CANDLE_GROUPS = /* @__PURE__ */ CANDLE_MARKS.map((id) => keyIs(id)).join(",");
const CANDLE_RECTS = /* @__PURE__ */ CANDLE_MARKS.map((id) => `g${keyIs(id)}>rect`).join(",");
/** The rects of the candle at `time` (each key ends `:<time>`). */
export const candleRectsAt = (time: number): string => `g:is(${CANDLE_GROUPS})>rect${keyEnds(`:${time}`)}`;
const hostSel = '[data-bkm-chart="candlestick"]';
const on = (state: string, tail = ""): string => CANDLE_RECTS.split(",").map((r) => `${hostSel}${state} ${r}${tail}`).join(",");
// Hover is live from the reveal's first frame (host `data-bkm-interactive`), not held to the reveal timer as bklit's `canInteract = isLoaded` is.
export const CANDLE_HOVER_CSS = /* @__PURE__ */ [
  /* @__PURE__ */ interactiveGateCss(hostSel),
  // The dim: bklit 150ms ease-in-out; the snappy variant: the hover profile.
  `${/* @__PURE__ */ on("", NOT_MOTION)}{transition:opacity ${HOVER_TRANSITION_CSS}}`,
  `${/* @__PURE__ */ on("[data-bkm-interactive][data-bkm-hover]", `:not([${FOCUS_MARK}])`)}{opacity:var(--bkm-faded)}`,
  `${/* @__PURE__ */ on('[data-bkm-interactive][data-bkm-legend="0"]', /* @__PURE__ */ keyHas(':neg:'))},${/* @__PURE__ */ on('[data-bkm-interactive][data-bkm-legend="1"]', /* @__PURE__ */ keyHas(':pos:'))}{opacity:var(--bkm-faded)}`,
  `${/* @__PURE__ */ on('[data-bkm-interactive][data-bkm-legend="0"]', `:not(${/* @__PURE__ */ keyHas(':neg:')})`)},${/* @__PURE__ */ on('[data-bkm-interactive][data-bkm-legend="1"]', `:not(${/* @__PURE__ */ keyHas(':pos:')})`)}{opacity:1}`,
].join("");
