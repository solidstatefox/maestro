import type { ChartMotionTransition } from "@tanstack/charts";
import { isFunction, isString } from "../guards";
import { REVEAL_CSS_EASE, REVEAL_EASING, cubicBezier } from "./easing";
import type { EnterTransition } from "./phase";
import { REST_GRANULAR, REST_NEVER, springCurve, springFrequency } from "./spring-curve";

export interface EnterSpring {
  readonly stiffness: number;
  readonly damping: number;
  readonly mass: number;
}

export const DEFAULT_ENTER_SPRING: EnterSpring = { damping: 15, mass: 1, stiffness: 100 };
export const DEFAULT_ENTER_MS = 1100;

interface MotionTransitionOptions {
  /** Spring values for a `type: "spring"` transition that leaves some unset. */
  readonly spring?: EnterSpring;
  readonly durationMs?: number;
  /** Pass CSS keyword eases ("ease-in", ...) through to the tween instead of the reveal curve. */
  readonly keywordEases?: boolean;
}

type KeywordEase = Extract<Extract<ChartMotionTransition, { type: "tween" }>["easing"], string>;

const KEYWORD_EASES: ReadonlySet<string> = /* @__PURE__ */ new Set(["linear", "ease", "ease-in", "ease-out", "ease-in-out"]);

const isKeywordEase = (ease: unknown): ease is KeywordEase => isString(ease) && KEYWORD_EASES.has(ease);

const isEaseFn = (ease: EnterTransition["ease"]): ease is (progress: number) => number => isFunction(ease);

const isBezier = (ease: EnterTransition["ease"]): ease is readonly [number, number, number, number] => Array.isArray(ease) && ease.length === 4;

/** The tween easing function of an enter `ease` (a 4-number bezier or an easing function; anything else is the reveal curve). */
export const toEaseFn = (ease: EnterTransition["ease"]): ((t: number) => number) => {
  if (isEaseFn(ease)) {
    return ease;
  }
  return isBezier(ease) ? cubicBezier(...ease) : REVEAL_EASING;
};

/** The CSS easing of an enter `ease` (a 4-number bezier; anything else is `fallback`). */
export const toCssEase = (ease: EnterTransition["ease"], fallback: string = REVEAL_CSS_EASE): string =>
  isBezier(ease) ? `cubic-bezier(${ease.join(",")})` : fallback;

export const toMotionTransition = (transition: Readonly<EnterTransition> | undefined, options: Readonly<MotionTransitionOptions> = {}): ChartMotionTransition => {
  const { spring = DEFAULT_ENTER_SPRING, durationMs = DEFAULT_ENTER_MS, keywordEases = false } = options;
  if (transition?.type === "spring") {
    return { damping: transition.damping ?? spring.damping, mass: transition.mass ?? spring.mass, stiffness: transition.stiffness ?? spring.stiffness, type: "spring" };
  }
  const duration = transition?.duration === undefined ? durationMs : transition.duration * 1000;
  const ease = transition?.ease;
  if (keywordEases && isKeywordEase(ease)) {
    return { duration, easing: ease, type: "tween" };
  }
  return { duration, easing: toEaseFn(ease), type: "tween" };
};

/** motion's spring defaults (motion-dom animation/generators/spring.mjs `springDefaults`): a `type: "spring"` that names no physics. */
const MOTION_SPRING_DEFAULTS: EnterSpring = { damping: 10, mass: 1, stiffness: 100 };
const CSS_SPRING_SAMPLES = 48;
const CSS_SPRING_STEP_MS = 8;
/** motion's `maxDuration` (10 s). */
const CSS_SPRING_LIMIT_MS = 10_000;

/** motion's named eases as CSS: its WAAPI table (motion-dom animation/waapi/easing/supported.mjs). */
const MOTION_NAMED_EASES: Readonly<Record<string, string>> = {
  backIn: "cubic-bezier(0.31,0.01,0.66,-0.59)",
  backOut: "cubic-bezier(0.33,1.53,0.69,0.99)",
  circIn: "cubic-bezier(0,0.65,0.55,1)",
  circOut: "cubic-bezier(0.55,0,1,0.45)",
  ease: "ease",
  easeIn: "ease-in",
  easeInOut: "ease-in-out",
  easeOut: "ease-out",
  linear: "linear",
};

/** A CSS entrance's duration and easing for bklit's enter transition on a 0 -> 1 progress (bklit `useMountProgress`: `animate(progress, 1,
 * transition)`). A tween keeps its `duration` (default `fallbackMs`) and its ease (a bezier or one of motion's named eases; otherwise the reveal
 * curve). A spring is sampled as a CSS `linear()` easing: a physics spring (`stiffness` / `damping` / `mass`, motion's defaults for the rest)
 * over its settle time on motion's granular rest thresholds, a `duration` / `bounce` spring over its duration (motion ends it there), a
 * `visualDuration` one over its settle time. */
export const enterCssCurve = (transition: Readonly<EnterTransition> | undefined, fallbackMs: number = DEFAULT_ENTER_MS): { readonly durationMs: number; readonly ease: string } => {
  if (transition?.type === "spring") {
    const { stiffness, damping, mass, duration, bounce } = transition;
    const physics = stiffness !== undefined || damping !== undefined || mass !== undefined;
    const sampled = { decimals: 4, samples: CSS_SPRING_SAMPLES };
    if (!physics && duration !== undefined) {
      const w = springFrequency(duration, bounce ?? 0.3);
      const ratio = Math.min(1, Math.max(0.05, 1 - (bounce ?? 0.3)));
      return springCurve({ damping: ratio * 2 * w, mass: 1, stiffness: w * w }, { ...sampled, durationMs: Math.min(10, Math.max(0.01, duration)) * 1000, rest: REST_NEVER });
    }
    const visual = (transition as { readonly visualDuration?: number }).visualDuration;
    if (!physics && visual !== undefined) {
      const root = (2 * Math.PI) / (visual * 1.2);
      const ratio = Math.min(1, Math.max(0.05, 1 - (bounce ?? 0.3)));
      return springCurve({ damping: 2 * ratio * root, mass: 1, stiffness: root * root }, { ...sampled, limitMs: CSS_SPRING_LIMIT_MS, rest: REST_GRANULAR, stepMs: CSS_SPRING_STEP_MS });
    }
    const spring: EnterSpring = { damping: damping ?? MOTION_SPRING_DEFAULTS.damping, mass: mass ?? MOTION_SPRING_DEFAULTS.mass, stiffness: stiffness ?? MOTION_SPRING_DEFAULTS.stiffness };
    return springCurve(spring, { ...sampled, limitMs: CSS_SPRING_LIMIT_MS, rest: REST_GRANULAR, stepMs: CSS_SPRING_STEP_MS });
  }
  const durationMs = transition?.duration === undefined ? fallbackMs : transition.duration * 1000;
  const named = isString(transition?.ease) ? MOTION_NAMED_EASES[transition.ease] : undefined;
  return { durationMs, ease: named ?? toCssEase(transition?.ease) };
};
