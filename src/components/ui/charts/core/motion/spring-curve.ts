import { createChartSpring } from "@tanstack/charts/spring";
import type { ChartSpring, ChartSpringState } from "@tanstack/charts/spring";
import type { Spring } from "./springs";

export interface SpringRest { readonly delta: number; readonly speed: number }

const GRANULAR_TRAVEL = 5;
/** motion's rest thresholds for a pixel-sized value (motion-dom 12.27.0 animation/generators/spring/defaults.mjs). */
export const REST_PX: SpringRest = { delta: 0.5, speed: 2 };
/** motion's granular thresholds: scales, opacities and unit spans. */
export const REST_GRANULAR: SpringRest = { delta: 0.005, speed: 0.01 };
/** Thresholds too small for `done` to fire inside any curve here: a closed-form sample that never snaps to its target. */
export const REST_NEVER: SpringRest = { delta: 1e-9, speed: 1e-9 };

/** motion picks its thresholds per value from the starting travel: under 5 units is granular, otherwise pixel-sized. */
export const restOf = (travel: number): SpringRest => (Math.abs(travel) < GRANULAR_TRAVEL ? REST_GRANULAR : REST_PX);

const springs = /* @__PURE__ */ new Map<string, ChartSpring>();

/** The native spring for `spring` with `rest` thresholds (cached: the constants repeat across every hover). */
export const springOf = (spring: Spring, rest: SpringRest): ChartSpring => {
  const key = `${spring.stiffness}/${spring.damping}/${spring.mass}/${rest.delta}/${rest.speed}`;
  let made = springs.get(key);
  if (made === undefined) {
    made = createChartSpring({ damping: spring.damping, mass: spring.mass, restDelta: rest.delta, restSpeed: rest.speed, stiffness: spring.stiffness });
    springs.set(key, made);
  }
  return made;
};

/** Milliseconds (a multiple of `stepMs`) at which the spring first meets its rest thresholds from `state`; `limitMs` when it never does. */
export const settleMs = (spring: ChartSpring, state: ChartSpringState, stepMs: number, limitMs: number): number => {
  for (let ms = stepMs; ms < limitMs; ms += stepMs) {
    if (spring.sample(ms, state).done) { return ms; }
  }
  return limitMs;
};

export type SpringCurveOptions = {
  /** Thresholds the sampled value snaps to its target on. */
  readonly rest: SpringRest;
  /** `linear()` stops after the first. */
  readonly samples: number;
  /** Decimal places of each stop. */
  readonly decimals: number;
} & (
  /** The easing runs over this duration. */
  | { readonly durationMs: number }
  /** The easing runs over the settle time, searched every `stepMs` up to `limitMs`. */
  | { readonly stepMs: number; readonly limitMs: number }
);

export interface SpringCurve { readonly durationMs: number; readonly ease: string }

/** A spring (0 -> 1, overshoots) as a CSS `linear()` easing over its settle time. */
export const springCurve = (spring: Spring, options: SpringCurveOptions): SpringCurve => {
  const native = springOf(spring, options.rest);
  const state: ChartSpringState = { from: 0, to: 1, velocity: 0 };
  const durationMs = "durationMs" in options ? options.durationMs : settleMs(native, state, options.stepMs, options.limitMs);
  const scale = 10 ** options.decimals;
  const stops: string[] = [];
  for (let step = 0; step <= options.samples; step += 1) {
    // The last stop is the target: a fixed `durationMs` can end before the spring has settled, and the easing must land on 1.
    const { value } = native.sample((step / options.samples) * durationMs, state);
    stops.push(step === options.samples ? "1" : String(Math.round(value * scale) / scale));
  }
  return { durationMs, ease: `linear(${stops.join(",")})` };
};

/** motion's `findSpring` (ported): the undamped frequency (rad/s) for which a spring of `duration` s and `bounce` has decayed to 0.001 at `duration`;
 * motion ends a duration-defined spring exactly there. */
export function springFrequency(duration: number, bounce: number): number {
  const damping = Math.min(1, Math.max(0.05, 1 - bounce));
  const d = Math.min(10, Math.max(0.01, duration));
  const safeMin = 0.001;
  const envelope = (w: number): number => {
    const decay = w * damping;
    const a = decay;
    const b = w * Math.sqrt(1 - damping * damping);
    return safeMin - (a / b) * Math.exp(-decay * d);
  };
  const derivative = (w: number): number => {
    const decay = w * damping;
    const e = damping * damping * w * w * d;
    const f = Math.exp(-decay * d);
    const g = w * w * Math.sqrt(1 - damping * damping);
    const factor = -envelope(w) + safeMin > 0 ? -1 : 1;
    return (factor * (-e * f)) / g;
  };
  let w = 5 / d;
  for (let i = 1; i < 12; i += 1) {
    w -= envelope(w) / derivative(w);
  }
  return w;
}
