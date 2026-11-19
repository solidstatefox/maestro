import type { SparklineSpringConfig } from "../types/sparkline";

type FrameStep = (now: number) => boolean;

const steps = new Set<FrameStep>();
let frame = 0;

const tick = (now: number): void => {
  frame = 0;
  for (const step of steps) {
    if (!step(now)) {
      steps.delete(step);
    }
  }
  if (steps.size > 0) {
    frame = requestAnimationFrame(tick);
  }
};

/** Runs `step` every animation frame until it returns false (or the returned stop is called). */
export const onFrames = (step: FrameStep): (() => void) => {
  steps.add(step);
  if (frame === 0) {
    frame = requestAnimationFrame(tick);
  }
  return () => {
    steps.delete(step);
  };
};

/** A value on a damped spring (mass 1), retargeted without losing its velocity. Sampled by time; it never touches the DOM. */
export interface SparkSpring {
  /** The value it rests on. */
  target: number;
  /** Moves it to `target`: springs from where it is now (with its velocity), or jumps there with `config` `null`. */
  to(target: number, config: SparklineSpringConfig | null, now: number): void;
  /** The value at `now`; `done` once it has settled on its target. */
  at(now: number): number;
  readonly done: boolean;
}

/** Below these (px and px/s) a spring has settled: a hundredth of a pixel, invisible. */
const REST_DELTA = 0.01;
const REST_SPEED = 0.5;

export const createSpring = (initial: number): SparkSpring => {
  let start = 0;
  // Displacement from the target and velocity at `start`.
  let d0 = 0;
  let v0 = 0;
  let k = 1;
  let c = 0;
  let done = true;
  let value = initial;

  /** Displacement and velocity `t` seconds after `start`: the closed-form damped oscillator. */
  const solve = (t: number): [number, number] => {
    const w0 = Math.sqrt(k);
    const zeta = c / (2 * w0);
    if (zeta < 1) {
      const wd = w0 * Math.sqrt(1 - zeta * zeta);
      const a = zeta * w0;
      const b = (v0 + a * d0) / wd;
      const e = Math.exp(-a * t);
      const cos = Math.cos(wd * t);
      const sin = Math.sin(wd * t);
      return [e * (d0 * cos + b * sin), e * (v0 * cos - (a * b + d0 * wd) * sin)];
    }
    if (zeta === 1) {
      const b = v0 + w0 * d0;
      const e = Math.exp(-w0 * t);
      return [e * (d0 + b * t), e * (v0 - w0 * b * t)];
    }
    const root = w0 * Math.sqrt(zeta * zeta - 1);
    const r1 = -zeta * w0 + root;
    const r2 = -zeta * w0 - root;
    const c2 = (v0 - r1 * d0) / (r2 - r1);
    const c1 = d0 - c2;
    const e1 = Math.exp(r1 * t);
    const e2 = Math.exp(r2 * t);
    return [c1 * e1 + c2 * e2, c1 * r1 * e1 + c2 * r2 * e2];
  };

  const spring: SparkSpring = {
    target: initial,
    get done() {
      return done;
    },
    at(now) {
      if (done) {
        return value;
      }
      const [d, v] = solve(Math.max(0, now - start) / 1000);
      if (Math.abs(d) < REST_DELTA && Math.abs(v) < REST_SPEED) {
        done = true;
        value = spring.target;
        return value;
      }
      value = spring.target + d;
      return value;
    },
    to(target, config, now) {
      if (config === null) {
        done = true;
        value = target;
        spring.target = target;
        return;
      }
      // Where it is and how fast it moves now: the new spring starts from there.
      let velocity = 0;
      if (!done) {
        const [d, v] = solve(Math.max(0, now - start) / 1000);
        value = spring.target + d;
        velocity = v;
      }
      spring.target = target;
      start = now;
      d0 = value - target;
      v0 = velocity;
      k = config.stiffness;
      c = config.damping;
      done = Math.abs(d0) < REST_DELTA && Math.abs(v0) < REST_SPEED;
      if (done) {
        value = target;
      }
    },
  };
  return spring;
};

// --- Width ----------------------------------------------------------------------------------------------------------------------------

/** The content box's width, and where it starts inside the padding edge (the padding-left). */
type WidthListener = (width: number, left: number) => void;
let observer: ResizeObserver | null = null;
const widthListeners = new WeakMap<Element, WidthListener>();

/** Calls `listener` with `element`'s content width once laid out (before that frame paints) and on every resize; one observer for every sparkline. */
export const observeWidth = (element: Element, listener: WidthListener): (() => void) => {
  if (typeof ResizeObserver === "undefined") {
    listener(element.getBoundingClientRect().width, 0);
    return () => undefined;
  }
  observer ??= new ResizeObserver((entries) => {
    for (const entry of entries) {
      widthListeners.get(entry.target)?.(entry.contentRect.width, entry.contentRect.left);
    }
  });
  widthListeners.set(element, listener);
  observer.observe(element);
  return () => {
    widthListeners.delete(element);
    observer?.unobserve(element);
  };
};
