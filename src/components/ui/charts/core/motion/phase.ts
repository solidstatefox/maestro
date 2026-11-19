import { REVEAL_BEZIER } from "./easing";

type TransitionEasing = readonly number[] | string | ((progress: number) => number);

/** Structural supertype of motion's `Transition` (seconds), so bklit consumers' values assign without a motion dependency. */
export interface Transition {
  readonly type?: unknown;
  readonly duration?: number;
  readonly delay?: number;
  readonly ease?: TransitionEasing | readonly TransitionEasing[];
  readonly stiffness?: number;
  readonly damping?: number;
  readonly mass?: number;
  readonly bounce?: number;
}

/** Data state of a chart: `"loading"` shows the loading placeholder, `"ready"` shows the data. */
export type ChartStatus = "loading" | "ready";

/** Loading animation style: the travelling pulse or the diagonal sweep. */
export type LoadingStyle = "pulse" | "sweep";

/** Pulse phase: steady loop, loading -> ready exit, or ready -> loading enter. */
export type LineLoadingPulseMode = "loop" | "exit" | "enter";

/** Where a chart is in its loading and reveal sequence. `"loading"` and `"ready"` are the resting phases; the others are transitions between them. */
export type ChartPhase =
  | "loading"
  | "exiting"
  | "gridTweenReady"
  | "revealing"
  | "ready"
  | "exitingReady"
  | "gridTweenLoading"
  | "revealingLoading";

export type EnterTransition = Transition;

export const DEFAULT_ANIMATION_DURATION_MS = 1100;
export const DEFAULT_ANIMATION_EASING = `cubic-bezier(${/* @__PURE__ */ REVEAL_BEZIER.join(", ")})`;
export const DEFAULT_CHART_ENTER_TRANSITION: Transition = {
  duration: DEFAULT_ANIMATION_DURATION_MS / 1000,
  ease: REVEAL_BEZIER,
  type: "tween",
};

export const DEFAULT_CHART_STATUS: ChartStatus = "ready";
/** @internal */
export const DEFAULT_Y_DOMAIN_TWEEN_MS = 500;

/** @internal */
export const resolveRestingChartPhase = (status: ChartStatus): ChartPhase => (status === "loading" ? "loading" : "ready");
/** @internal */
export const isChartInteractionPhase = (phase: ChartPhase): boolean => phase === "ready";

/** @internal */
export const Y_AXIS_DEFAULT_TICK_COUNT = 5;
/** @internal */
export const Y_AXIS_MIN_TICK_COUNT = 1;
/** @internal */
export const Y_AXIS_MAX_TICK_COUNT = 10;

/** @internal */
export const resolveYAxisTickCount = (numTicks?: number): number => {
  if (numTicks === undefined || !Number.isFinite(numTicks)) {
    return Y_AXIS_DEFAULT_TICK_COUNT;
  }
  return Math.min(Y_AXIS_MAX_TICK_COUNT, Math.max(Y_AXIS_MIN_TICK_COUNT, Math.round(numTicks)));
};

export type YAxisOrientation = "left" | "right";
