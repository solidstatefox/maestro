import type { ChartMotionTransition } from "@tanstack/charts";

type Ease = (t: number) => number;

/** A render forced mid-entrance: the remaining `delay` and the continued tween; `false` once the entrance is over. */
export type ResumedEnter = false | { readonly delay: number; readonly transition: ChartMotionTransition };

export interface EnterPlan {
  readonly delay: number;
  readonly duration: number;
  readonly easing: Ease;
}

/** Motion for a render forced mid-entrance (web-font swap after a hydrated SSR mount, resize), which reaches `motion` as phase "update" and would cancel the enter tracks:
 * resumes the original schedule from `enterAt` (remaining delay, or remaining span with the easing continued); `false` once over, so a later data update snaps like bklit. */
export function resumeEnter(plan: EnterPlan, enterAt: number | null): ResumedEnter {
  if (enterAt === null) {
    return false;
  }
  const local = performance.now() - enterAt - plan.delay;
  if (local >= plan.duration) {
    return false;
  }
  if (local <= 0) {
    return { delay: -local, transition: { type: "tween", duration: plan.duration, easing: plan.easing } };
  }
  const done = local / plan.duration;
  const from = plan.easing(done);
  const rest = 1 - from;
  return {
    delay: 0,
    transition: {
      type: "tween",
      duration: plan.duration - local,
      easing: (t: number) => (rest < 1e-6 ? t : (plan.easing(done + (1 - done) * t) - from) / rest),
    },
  };
}
