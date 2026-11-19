import { rect } from "@tanstack/charts";
import type { ChartMark, ChartMotionContext, ChartMotionTiming } from "@tanstack/charts";
import { cubicBezier } from "../motion/easing";
import { resumeEnter } from "../motion/resume-enter";
import { yScaleForAxis } from "../cartesian/build-state";
import { erase } from "../erased-types";
import type { OverlayDot } from "../cartesian/hover-overlay";
import { Y_DOMAIN_GLIDE } from "../cartesian/definition";
import { dateValue, numberValue } from "./narrow";

// bklit's bar easing, cubic-bezier(0.85, 0, 0.15, 1).
const barEasing = /* @__PURE__ */ cubicBezier(0.85, 0, 0.15, 1);

export interface SeriesBarSpec {
  readonly dataKey: string;
  /** SeriesBar `yAxisId`: the y scale the bars stand on (bars stack only with the bars of their axis). */
  readonly yAxisId: string;
  /** SeriesBar `label`: the tooltip row's name (`seriesLabels`). */
  readonly label?: string;
  readonly fill: string;
  readonly dotColor: string;
  readonly radius: number;
  readonly animate: boolean;
  readonly fadedOpacity: number;
}

export interface BarLayoutInput {
  readonly data: readonly Record<string, unknown>[];
  readonly xKey: string;
  readonly bars: readonly SeriesBarSpec[];
  readonly innerWidth: number;
  readonly innerHeight: number;
  /** Time covered by the x scale, in ms. */
  readonly xSpanMs: number;
  /** The y domains the build resolved, by axis id (a bar stands on its axis' floor). */
  readonly yDomains: ReadonlyMap<string, readonly [number, number]>;
  readonly barSize?: number;
  readonly maxBarSize?: number;
  readonly barGap: number;
  readonly stacked: boolean;
  readonly stackGap: number;
  readonly animationDuration: number;
  /** The y-domain glide step of a data update (core/cartesian/data-update-step.ts): bars tween with the domain. */
  glide?: boolean;
  /** false = paint the first scene with zero-height bar seeds; the build that follows (true) grows them as a keyed update. */
  readonly entered: boolean;
  /** The reveal arm's `performance.now()` during the render that flips `entered` (bar updates then run the staggered grow), else null. */
  readonly growingSince: () => number | null;
  readonly dots: false | { readonly radius: number; readonly strokeWidth: number; readonly color?: string };
}

interface BarRow {
  /** Row index in `data`: the bar's node key, so the hover dim selectors are fixed text. */
  readonly i: number;
  /** The data row: the rect's datum, so a focused bar hands `<ChartTooltip rows content>` the row like a line point does. */
  readonly source: Record<string, unknown>;
  readonly t: Date;
  readonly x1: Date;
  readonly x2: Date;
  readonly y1: number;
  readonly y2: number;
  readonly value: number;
  /** Visual top of the bar (stacked top when stacked). */
  readonly top: number;
}

type BarMark = ChartMark<Record<string, unknown>, Date, number>;

/** Half the spacing of the rows, in ms (0 for fewer than two rows): the x domain is padded by it each side when bars are drawn (`barXPadding`). */
export function halfSlotMs(times: readonly number[]): number {
  if (times.length < 2) {
    return 0;
  }
  const spread = Math.max(...times) - Math.min(...times);
  return spread > 0 ? spread / (times.length - 1) / 2 : 0;
}

/** bklit's bar width: 88% of the slot (or barSize), capped by maxBarSize, shrunk to fit groups. The x domain carries half a slot each side (`halfSlotMs`),
 * so n rows span n slots: `innerWidth / n`. */
export function seriesBarWidth(input: {
  innerWidth: number;
  dataLength: number;
  seriesCount: number;
  barSize?: number;
  maxBarSize?: number;
  gap: number;
  stacked: boolean;
}): number {
  const { innerWidth, dataLength, seriesCount, barSize, maxBarSize, gap, stacked } = input;
  const groupCount = stacked ? 1 : Math.max(1, seriesCount);
  const slot = innerWidth / Math.max(1, dataLength);
  let width = barSize ?? Math.min(slot * 0.88, maxBarSize ?? Number.POSITIVE_INFINITY);
  if (maxBarSize !== undefined) {
    width = Math.min(width, maxBarSize);
  }
  if (groupCount > 1) {
    const maxGroup = slot * 0.92;
    const needed = groupCount * width + (groupCount - 1) * gap;
    if (needed > maxGroup && maxGroup > 0) {
      width = Math.max(4, (maxGroup - (groupCount - 1) * gap) / groupCount);
    }
  }
  return Math.max(2, width);
}

/** The bars' values by axis, for the y domains: each bar's value (grouped), or every running total of a row's stack (stacked: bklit's
 * `collectBarValueExtents`, so the domain reaches every segment end, negatives too); a stack holds the bars of one axis. */
export function barYValuesByAxis(data: readonly Record<string, unknown>[], bars: readonly SeriesBarSpec[], stacked: boolean): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const bar of bars) {
    if (!out.has(bar.yAxisId)) {
      out.set(bar.yAxisId, []);
    }
  }
  for (const [axis, values] of out) {
    const keys = bars.filter((b) => b.yAxisId === axis).map((b) => b.dataKey);
    for (const row of data) {
      let sum = 0;
      for (const key of keys) {
        const v = numberValue(row[key]);
        if (v !== undefined) {
          sum += v;
          values.push(stacked ? sum : v);
        }
      }
    }
  }
  return out;
}

interface BarGeometry {
  readonly msPerPx: number;
  readonly barWidth: number;
  readonly groupWidth: number;
  /** An axis' units per px and floor (the bars' base), by axis id. */
  readonly axis: (id: string) => { readonly unitsPerPx: number; readonly baseline: number };
}

/** Per-axis geometry of a plot `innerHeight` tall. */
const axisGeometry = (yDomains: BarLayoutInput["yDomains"], innerHeight: number): BarGeometry["axis"] => (id) => {
  const domain = yDomains.get(id) ?? [0, 100];
  return { unitsPerPx: (domain[1] - domain[0]) / Math.max(1, innerHeight), baseline: domain[0] };
};

/** The bars of one series as time intervals; stacked bars sit on the series below them, raised by the stack gap. */
function barRowsOf(input: BarLayoutInput, geo: BarGeometry, bar: SeriesBarSpec, seriesIndex: number): BarRow[] {
  const { bars, stacked, stackGap, barGap } = input;
  return input.data.flatMap((row, rowIndex) => {
    const value = numberValue(row[bar.dataKey]);
    if (value === undefined) {
      return [];
    }
    const t = dateValue(row[input.xKey]);
    const leftPx = stacked ? -geo.barWidth / 2 : -geo.groupWidth / 2 + seriesIndex * (geo.barWidth + barGap);
    const x1 = new Date(t.getTime() + leftPx * geo.msPerPx);
    const x2 = new Date(x1.getTime() + geo.barWidth * geo.msPerPx);
    const { unitsPerPx, baseline } = geo.axis(bar.yAxisId);
    let y1 = baseline;
    let y2 = value;
    if (stacked) {
      // A stack holds the bars of this one's axis, in tree order.
      const below = bars.slice(0, seriesIndex).filter((b) => b.yAxisId === bar.yAxisId);
      const offset = below.reduce((sum, b) => sum + (numberValue(row[b.dataKey]) ?? 0), 0);
      const level = below.length;
      const top = bars.slice(seriesIndex + 1).every((b) => b.yAxisId !== bar.yAxisId);
      const raise = level * stackGap;
      y1 = offset + (raise + (top ? 0 : stackGap)) * unitsPerPx;
      y2 = offset + value + raise * unitsPerPx;
    }
    return [{ i: rowIndex, source: row, t, x1, x2, y1, y2, value, top: y2 }];
  });
}

/** One tween spanning the reveal: 0 for the stagger delay, bklit's easing, then the final height when the reveal ends (bklit swaps to static rects). `clock` is the first entrance. */
export function growMotionOf(input: BarLayoutInput, stagger: number, clock: { at: number | null }): (context: ChartMotionContext<Record<string, unknown>>) => false | ChartMotionTiming<Record<string, unknown>> | undefined {
  return (context) => {
    // The y-domain glide step (bklit tweens every element drawn with the y scale) outranks the settled-snap below.
    if (input.glide === true && context.phase === "update") {
      return Y_DOMAIN_GLIDE;
    }
    const delay = context.datumIndex * stagger;
    const total = input.animationDuration;
    const plan = { delay: 0, duration: total, easing: (t: number): number => (t >= 1 ? 1 : barEasing((t * total - delay) / total)) };
    const since = input.growingSince();
    if (context.phase === "enter" || (context.phase === "update" && since !== null)) {
      // bklit's grow starts in the arming effect (chart-reveal-clip.tsx:81-85); ours a commit later, so it resumes from the arm.
      clock.at ??= since ?? performance.now();
      return resumeEnter(plan, clock.at) || { delay: 0, transition: { type: "tween", duration: plan.duration, easing: plan.easing } };
    }
    if (context.phase !== "update") {
      return undefined;
    }
    // A render forced mid-entrance (web-font swap after a hydrated mount) resumes the schedule; any other update snaps like bklit.
    return resumeEnter(plan, clock.at);
  };
}

export function buildBarMarks(input: BarLayoutInput): BarMark[] {
  const { data, bars, innerWidth, innerHeight, xSpanMs, yDomains, barGap, stacked, stackGap } = input;
  const n = bars.length;
  if (n === 0 || innerWidth <= 0 || innerHeight <= 0 || data.length === 0) {
    return [];
  }
  const barWidth = seriesBarWidth({ innerWidth, dataLength: data.length, seriesCount: n, barSize: input.barSize, maxBarSize: input.maxBarSize, gap: barGap, stacked });
  const geo: BarGeometry = {
    msPerPx: xSpanMs / innerWidth,
    barWidth,
    groupWidth: n * barWidth + (n > 1 ? (n - 1) * barGap : 0),
    axis: axisGeometry(yDomains, innerHeight),
  };
  // bklit: each bar tweens for the full reveal duration, delayed by index * (40% of it / n) (ends at ~1.4x).
  const stagger = data.length > 1 ? (input.animationDuration * 0.4) / data.length : 0;
  const growMotion = growMotionOf(input, stagger, { at: null });
  const marks: BarMark[] = [];

  for (const [seriesIndex, bar] of bars.entries()) {
    const rows = barRowsOf(input, geo, bar, seriesIndex);
    const isTop = bars.slice(seriesIndex + 1).every((b) => b.yAxisId !== bar.yAxisId);
    // First paint: zero-height seeds (y2 at the bar's base); the entrance is the UPDATE of these keyed bars, since a rect
    // enters natively only into a painted scene and the initial pass animates barY alone.
    const eps = 0.01 * geo.axis(bar.yAxisId).unitsPerPx;
    const seeded = input.entered || !bar.animate ? rows : rows.map((row): BarRow => ({ ...row, y2: row.y1 + eps }));
    const rounded = stacked ? stackGap > 0 || isTop : true;
    // The rect's datum is the data row; its geometry is the parallel BarRow (accessors get the datum's index).
    const at = (index: number): BarRow => seeded[index];
    marks.push(
      erase(rect(seeded.map((row) => row.source), {
        id: `bar:${bar.dataKey}`,
        x: (_d, { index }) => at(index).t,
        x1: (_d, { index }) => at(index).x1,
        x2: (_d, { index }) => at(index).x2,
        y: (_d, { index }) => at(index).value,
        y1: (_d, { index }) => at(index).y1,
        y2: (_d, { index }) => at(index).y2,
        z: () => bar.dataKey,
        key: (_d, { index }) => at(index).i,
        ...yScaleForAxis(bar.yAxisId),
        fill: bar.fill,
        inset: 0,
        // bklit's rect rx = ry = radius (series-bar.tsx:312-313), clamped per axis by the browser: the scalar radius is the
        // native <rect rx>; a corner-radii path would scale both radii together instead.
        radius: rounded ? bar.radius : 0,
        // The hover fade and legend dim are fixed CSS on host attributes (composed/static-css.ts; no native `states`).
        motion: bar.animate ? growMotion : false,
      })),
    );
  }
  return marks;
}

/** One hover dot per bar series, at the visual top of the focused row's bar (the hover overlay's dots, core/cartesian/hover-overlay.ts; bklit TooltipDot per series). */
export function buildBarDots(input: BarLayoutInput): OverlayDot[] {
  const { bars, dots, innerWidth, innerHeight, xSpanMs, yDomains, barGap, stacked, data } = input;
  if (dots === false || bars.length === 0 || innerWidth <= 0 || innerHeight <= 0 || data.length === 0) {
    return [];
  }
  const barWidth = seriesBarWidth({ innerWidth, dataLength: data.length, seriesCount: bars.length, barSize: input.barSize, maxBarSize: input.maxBarSize, gap: barGap, stacked });
  const geo: BarGeometry = {
    msPerPx: xSpanMs / innerWidth,
    barWidth,
    groupWidth: bars.length * barWidth + (bars.length > 1 ? (bars.length - 1) * barGap : 0),
    axis: axisGeometry(yDomains, innerHeight),
  };
  return bars.map((bar, seriesIndex): OverlayDot => {
    const topAt = new Map<number, number>(barRowsOf(input, geo, bar, seriesIndex).map((d) => [d.t.getTime(), d.top]));
    return {
      yAxis: bar.yAxisId,
      valueOf: (row) => topAt.get(dateValue(row[input.xKey]).getTime()),
      shapes: [{ r: dots.radius, fill: dots.color ?? bar.dotColor, stroke: "var(--chart-background)", strokeWidth: dots.strokeWidth }],
      glide: true,
    };
  });
}
