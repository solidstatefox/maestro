import type { ChartMotionTiming } from "@tanstack/charts";
import { resumeEnter } from "../motion/resume-enter";
import type { EnterPlan } from "../motion/resume-enter";

export type EnterTiming = false | ChartMotionTiming;

/** The first build (or any "enter") starts the clock and runs the full tween; a forced mid-entrance update resumes it. */
export function enterOrResume(clock: { at: number | null }, phase: string, plan: EnterPlan): EnterTiming {
  if (clock.at === null || phase === "enter") {
    clock.at ??= performance.now();
    return { delay: plan.delay, transition: { type: "tween", duration: plan.duration, easing: plan.easing } };
  }
  return resumeEnter(plan, clock.at);
}
