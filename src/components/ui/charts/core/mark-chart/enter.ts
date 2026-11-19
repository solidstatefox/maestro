import { DEFAULT_ENTER_SPRING } from "../motion/enter-transition";
import { REST_GRANULAR, springCurve } from "../motion/spring-curve";
import type { MarkEnter } from "./types";

/** The enter spring as an easing over its settle time. */
export const ENTER_SPRING = /* @__PURE__ */ springCurve(DEFAULT_ENTER_SPRING, { decimals: 3, limitMs: 2400, rest: REST_GRANULAR, samples: 40, stepMs: 8 });

/** A critically damped settle for what must not overshoot (a line drawing in, a fade). */
const SETTLE_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

/** Scales up from `from` (about the node's own origin) while fading in. */
export const popIn = (delay: number, from = 0.6): MarkEnter => ({
  delay,
  duration: ENTER_SPRING.durationMs,
  easing: ENTER_SPRING.ease,
  keyframes: [{ opacity: 0, transform: `scale(${from})` }, { opacity: 1, transform: "none" }],
});

/** Grows along one axis from its origin (a bar, a band). */
export const growIn = (delay: number, axis: "x" | "y"): MarkEnter => ({
  delay,
  duration: ENTER_SPRING.durationMs,
  easing: ENTER_SPRING.ease,
  keyframes: [{ transform: axis === "x" ? "scaleX(0)" : "scaleY(0)" }, { transform: "none" }],
});

/** Fades in over `duration` ms. */
export const fadeIn = (delay: number, duration = 450): MarkEnter => ({
  delay,
  duration,
  easing: SETTLE_EASE,
  keyframes: [{ opacity: 0 }, { opacity: 1 }],
});

/** Draws a stroked path in: `element` is the drawn path (its length is read once, at the entrance). */
export const drawIn = (element: Element, delay: number, duration = 700): MarkEnter | undefined => {
  const length = "getTotalLength" in element && typeof element.getTotalLength === "function" ? Number(element.getTotalLength()) : 0;
  if (!(length > 0)) {
    return fadeIn(delay, duration);
  }
  return {
    delay,
    duration,
    easing: SETTLE_EASE,
    keyframes: [{ strokeDasharray: `${length} ${length}`, strokeDashoffset: length }, { strokeDasharray: `${length} ${length}`, strokeDashoffset: 0 }],
  };
};
