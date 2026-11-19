import { leadingFloat } from "../guards";

// CSS cubic-bezier(x1, y1, x2, y2) as a native tween easing function `(t) => number`. Like CSS (and bklit's motion eases),
// the output is not clamped: y control points outside [0, 1] overshoot.
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const ax = 3 * x1 - 3 * x2 + 1;
  const bx = 3 * x2 - 6 * x1;
  const cx = 3 * x1;
  const ay = 3 * y1 - 3 * y2 + 1;
  const by = 3 * y2 - 6 * y1;
  const cy = 3 * y1;
  const sampleX = (t: number): number => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number): number => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number): number => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) {
      return 0;
    }
    if (x >= 1) {
      return 1;
    }
    let t = x;
    for (let i = 0; i < 8; i += 1) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-5) {
        return sampleY(t);
      }
      const d = slopeX(t);
      if (Math.abs(d) < 1e-6) {
        break;
      }
      t -= err / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 20; i += 1) {
      const v = sampleX(t);
      if (Math.abs(v - x) < 1e-5) {
        break;
      }
      if (v < x) {
        lo = t;
      } else {
        hi = t;
      }
      t = (lo + hi) / 2;
    }
    return sampleY(t);
  };
}

/** bklit's default enter curve, cubic-bezier(0.85, 0, 0.15, 1): the one source for every tween, CSS string and bezier solve. */
export const REVEAL_BEZIER = [0.85, 0, 0.15, 1] as const;
export const REVEAL_EASING = /* @__PURE__ */ (() => cubicBezier(...REVEAL_BEZIER))();
export const REVEAL_CSS_EASE = `cubic-bezier(${/* @__PURE__ */ REVEAL_BEZIER.join(",")})`;

const isQuad = (nums: readonly number[] | undefined): nums is [number, number, number, number] =>
  nums?.length === 4 && nums.every(Number.isFinite);

/** CSS's named easings as their cubic-bezier control points. */
const CSS_EASES: Readonly<Record<string, readonly [number, number, number, number]>> = { ease: [0.25, 0.1, 0.25, 1], "ease-in": [0.42, 0, 1, 1], "ease-out": [0, 0, 0.58, 1], "ease-in-out": [0.42, 0, 0.58, 1] };

/** `animationEasing` is a CSS easing string ("cubic-bezier(...)", "linear", "ease-in-out"…); anything else keeps the reveal curve. */
export function parseEasing(value: string | undefined): (t: number) => number {
  const name = value?.trim();
  if (name === "linear") {
    return (t) => t;
  }
  const named = name === undefined ? undefined : CSS_EASES[name];
  if (named) {
    return cubicBezier(...named);
  }
  const match = /cubic-bezier\(([^)]+)\)/u.exec(value ?? "");
  const nums = match?.[1]?.split(",").map((n) => leadingFloat(n.trim()));
  return isQuad(nums) ? cubicBezier(...nums) : REVEAL_EASING;
}
