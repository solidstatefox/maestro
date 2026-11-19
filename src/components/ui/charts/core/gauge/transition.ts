import { cubicBezier } from "../motion/easing";
import type { Transition } from "../motion/phase";
import { springFrequency } from "../motion/spring-curve";

/** Structural twin of motion's `Transition` for the sweep (seconds). */
export interface GaugeEnterTransition extends Transition {
  /** motion's visual duration of a spring, in seconds (the time it takes to visibly reach the target). */
  readonly visualDuration?: number;
  readonly restDelta?: number;
  readonly restSpeed?: number;
}

/** A spring in motion's terms (stiffness, damping, mass), with its rest thresholds when the reader sets them. */
export interface SweepSpring {
  readonly kind: "spring";
  readonly stiffness: number;
  readonly damping: number;
  readonly mass: number;
  readonly restDelta: number | undefined;
  readonly restSpeed: number | undefined;
}

/** A tween: `duration` in ms on `ease` (0 → 1). */
export interface SweepTween {
  readonly kind: "tween";
  readonly durationMs: number;
  readonly ease: (t: number) => number;
}

export type SweepMotion = SweepSpring | SweepTween;

/** bklit's track (and ruler, ring, needle…) fade-in: 0.45 s on `[0.23, 1, 0.32, 1]`. */
export const TRACK_FADE_MS = 450;
export const TRACK_FADE_EASE = "cubic-bezier(0.23,1,0.32,1)";
/** The fill starts sweeping this long after mount (× the stagger scale, clamped 0.25–2.5). */
export const FILL_ENTER_DELAY_MS = 120;

const SECONDS = 1000;
// motion's physics defaults (motion-dom spring/defaults.mjs) and its default tween (300 ms, easeInOut: animation/generators/keyframes.mjs).
const STIFFNESS = 100;
const DAMPING = 10;
const MASS = 1;
const TWEEN_S = 0.3;
const EASE_IN_OUT = /* @__PURE__ */ cubicBezier(0.42, 0, 0.58, 1);
const NAMED_EASES: Readonly<Record<string, readonly [number, number, number, number]>> = {
  backIn: [0.31, 0.01, 0.66, -0.59], backInOut: [0.68, -0.6, 0.32, 1.6], backOut: [0.33, 1.53, 0.69, 0.99],
  circIn: [0.55, 0, 1, 0.45], circInOut: [0.85, 0, 0.15, 1], circOut: [0, 0.55, 0.45, 1],
  easeIn: [0.42, 0, 1, 1], easeInOut: [0.42, 0, 0.58, 1], easeOut: [0, 0, 0.58, 1],
};

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** A spring of motion's `visualDuration` (s) and `bounce` (motion-dom spring/index.mjs getSpringOptions). */
const visualSpring = (visualDuration: number, bounce: number, t: GaugeEnterTransition): SweepSpring => {
  const root = (2 * Math.PI) / (visualDuration * 1.2);
  const stiffness = root * root;
  return { damping: 2 * clamp(1 - bounce, 0.05, 1) * Math.sqrt(stiffness), kind: "spring", mass: 1, restDelta: t.restDelta, restSpeed: t.restSpeed, stiffness };
};

/** bklit's default sweep: `{ type: "spring", visualDuration: 0.9, bounce: 0 }`, critically damped. */
export const DEFAULT_SWEEP: SweepSpring = /* @__PURE__ */ visualSpring(0.9, 0, {});

const easeOf = (ease: GaugeEnterTransition["ease"]): ((t: number) => number) => {
  if (typeof ease === "function") { return ease; }
  if (Array.isArray(ease) && ease.length === 4 && ease.every((n) => typeof n === "number")) { return cubicBezier(ease[0] as number, ease[1] as number, ease[2] as number, ease[3] as number); }
  if (ease === "linear") { return (t) => t; }
  const named = typeof ease === "string" ? NAMED_EASES[ease] : undefined;
  return named === undefined ? EASE_IN_OUT : cubicBezier(...named);
};

const isSpringType = (t: GaugeEnterTransition): boolean =>
  t.type === "spring" || t.stiffness !== undefined || t.damping !== undefined || t.mass !== undefined || t.visualDuration !== undefined || t.bounce !== undefined;

/** The sweep a reader's `enterTransition` describes, as motion reads it. */
export const toSweepMotion = (t: GaugeEnterTransition | undefined): SweepMotion => {
  if (t === undefined) { return DEFAULT_SWEEP; }
  if (!isSpringType(t)) {
    return { durationMs: (t.duration ?? TWEEN_S) * SECONDS, ease: easeOf(t.ease), kind: "tween" };
  }
  // Physics keys win; otherwise a visual duration, then a duration (motion's findSpring), then motion's defaults.
  if (t.stiffness !== undefined || t.damping !== undefined || t.mass !== undefined) {
    return { damping: t.damping ?? DAMPING, kind: "spring", mass: t.mass ?? MASS, restDelta: t.restDelta, restSpeed: t.restSpeed, stiffness: t.stiffness ?? STIFFNESS };
  }
  if (t.visualDuration !== undefined) { return visualSpring(t.visualDuration, t.bounce ?? 0, t); }
  if (t.duration !== undefined) {
    const bounce = t.bounce ?? 0.3;
    const omega = springFrequency(t.duration, bounce);
    const ratio = clamp(1 - bounce, 0.05, 1);
    return { damping: ratio * 2 * omega, kind: "spring", mass: 1, restDelta: t.restDelta, restSpeed: t.restSpeed, stiffness: omega * omega };
  }
  return { damping: DAMPING, kind: "spring", mass: MASS, restDelta: t.restDelta, restSpeed: t.restSpeed, stiffness: STIFFNESS };
};

/** The key a transition's sweep is the same for (a fresh object of the same values keeps the running sweep). */
export const sweepKey = (t: GaugeEnterTransition | undefined): string =>
  (t === undefined ? "" : JSON.stringify(t, (_key, value: unknown) => (typeof value === "function" ? String(value) : value)));
