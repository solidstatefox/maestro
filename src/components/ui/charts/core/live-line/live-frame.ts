import { scaleLinear } from "@tanstack/charts/scales/linear";
import type { LiveRow } from "./definition";
import type { Momentum } from "./momentum";
import { pickNiceInterval } from "./live-yaxis";

/** A streamed sample: bklit's LiveLinePoint, with the optional extra field the chart's dataKey reads. */
export type LiveSample = {
  readonly time: number;
  readonly value: number;
};

export interface Frame {
  readonly rows: readonly LiveRow[];
  readonly xDomain: readonly [number, number];
  readonly yDomain: readonly [number, number];
  readonly areaFloor: number;
  readonly tip: { readonly t: number; readonly v: number } | undefined;
  readonly momentum: Momentum;
  readonly rollMs: number;
  /** The unrolled first frame: the data minus its newest row, so the first update is a real roll (x shift + y reprojection). */
  readonly seed: boolean;
  /** The first roll, which carries bklit's y ease. */
  readonly intro: boolean;
  /** The lerped display value when the newest row arrived (where the dot started this tick). */
  readonly disp0: number;
  /** Flips with every new row: restarts the tip's label animations. */
  readonly parity: number;
  /** This roll's start transform (x' = x + x0, y' = s*y + t in svg px): the keyed plan (motion-path.ts fitAffine; the intro's from the seed's scales) composed with what is left of the previous roll
   * (motion.ts:1918-1923 composeRollingTransform, :2041-2050). Tail and tip ride it (live-css.ts). `d` tip y offset, `ak` A's x stretch (live-tail.ts), `xa` A's left end, `b0` B's start scale. */
  readonly roll: { readonly x: number; readonly s: number; readonly t: number; readonly d: number; readonly ak: number; readonly xa: number; readonly b0: number };
  /** The drawn y domain jumped this tick (an expanding edge, or a nice() step): the path snaps instead of reprojecting. */
  readonly jump: boolean;
  /** Where bklit's lerped display value stands relative to the target (px, + is below), in this tick's scale. */
  readonly dy: number;
  /** Height of the block under the tail's sloped end at rest over its height at the start of the tick (live-tail.ts). */
  readonly k: number;
  /** The raw y domain bklit's lerp chases (computeTargetRange, live-line-chart.tsx:80-110); the label step is picked on it (stepRaw). */
  readonly yTarget: readonly [number, number];
  /** bklit's y label step when this frame is built (the last pick); a roll re-picks it per commit (LiveYLabels). */
  readonly interval: number;
}

/** A roll's start transform and clock (the renderer's tween: from `x,s,t` to identity over `dur` on `ease`, from `at`). */
export interface RollClock {
  readonly x: number;
  readonly s: number;
  readonly t: number;
  readonly dur: number;
  readonly ease: (p: number) => number;
  /** The frame time the roll's tween started on; null until that frame (see the layout effect that stamps it). */
  at: number | null;
}

export interface FrameState {
  slots: number;
  interval: number;
  windowSecs: number;
  y: [number, number] | null;
  /** The previous tick's drawn (nice) domain, and whether the latest tick jumped it. */
  drawn: [number, number] | null;
  /** The seed frame's drawn domain: the intro roll starts from it. */
  seedY: [number, number] | null;
  jump: boolean;
  ry: { s: number; t: number };
  /** The previous frame's x domain start (the path's x shift is its change), and the roll the path is running. */
  x0: number | null;
  roll: RollClock | null;
  floor: number | null;
  stamp: number;
  introData: unknown;
  last: Frame | null;
  /** bklit's display lerp, tracked in closed form (no loop): value shown at `dispStamp`, and what it chases. */
  newest: string | null;
  disp: number;
  target: number;
  dispStamp: number;
  arrival: number;
  parity: number;
  /** The dot's time at rest (wall clock, ms): bklit's `now` when this frame's roll ends. */
  tipAt: number | null;
}

/** d3 `nice()` (default 10 ticks), as bklit's yScale applies to the eased domain. */
export function niceDomain(domain: readonly [number, number]): [number, number] {
  const [lo, hi] = scaleLinear().domain(domain).nice().domain();
  return [lo, hi];
}

/** bklit's y label step: its axis re-picks the interval, with hysteresis, whenever the committed frame's nice y range changes (live-y-axis.tsx:117-132), and its loop commits every
 * LIVE_FRAME_COMMIT_MS (COMMIT_MS; live-line-chart.tsx:275-284, 400-425) from a raw domain lerped once per rAF frame from 0..100 (stepRaw), so the latched step depends on which frames a commit lands on.
 * The loop starts on the seed frame, as bklit's first tick steps and picks on mount. */
export interface StepPick {
  range: number;
  interval: number;
  /** performance.now() of the last commit-cadence pick (bklit's lastFrameCommitRef, live-line-chart.tsx:373, starts at 0). */
  commit: number;
  /** bklit's raw y domain (animRef yMin/yMax), stepped per rAF tick; null before the first step. */
  raw: [number, number] | null;
}
export interface RollY {
  readonly s: number;
  readonly t: number;
}
/** How far the roll has eased at frame time `time`: 1 with no roll, 0 before its start is stamped. */
export function rollEase(r: RollClock | null, time: number): number {
  if (!r) {
    return 1;
  }
  return r.at === null ? 0 : r.ease(Math.min(1, Math.max(0, (time - r.at) / r.dur)));
}
/** The roll's y transform at frame time `time`: from its start (`s`,`t`) to identity on its own easing, from the stamped start. */
export function rollYAt(r: RollClock | null, time: number): RollY {
  if (!r) {
    return { s: 1, t: 0 };
  }
  const e = rollEase(r, time);
  return { s: 1 + (r.s - 1) * (1 - e), t: r.t * (1 - e) };
}
export function shownDomain(y: readonly [number, number], roll: RollY, top: number, height: number): [number, number] {
  const s = roll.s > 0 ? roll.s : 1;
  const at = (screen: number): number => y[1] - (((screen - roll.t) / s - top) * (y[1] - y[0])) / (height || 1);
  return [at(top + height), at(top)];
}
/** Steps bklit's raw y domain one rAF tick (nextAnimFrame, live-line-chart.tsx:105-127, :383-431), from 0..100 (:349-355):
 * an edge moving outward jumps to its target, one moving inward closes `lerp` of the gap. */
export function stepRaw(p: StepPick, target: readonly [number, number], lerp: number): [number, number] {
  const raw = p.raw ?? [0, 100];
  raw[0] = target[0] < raw[0] ? target[0] : target[0] + (raw[0] - target[0]) * (1 - lerp);
  raw[1] = target[1] > raw[1] ? target[1] : target[1] + (raw[1] - target[1]) * (1 - lerp);
  p.raw = raw;
  return raw;
}
export function pickStep(p: StepPick, domain: readonly [number, number], height: number, minGap: number): number {
  const [lo, hi] = niceDomain(domain);
  if (hi - lo !== p.range) {
    p.range = hi - lo;
    p.interval = pickNiceInterval(p.range, height, minGap, p.interval);
  }
  return p.interval;
}

/** The focused row's plot geometry: the left margin, the x domain's start (ms) and px per ms. */
export interface RowLayout {
  readonly left: number;
  readonly x0: number;
  readonly pxPerMs: number;
}
