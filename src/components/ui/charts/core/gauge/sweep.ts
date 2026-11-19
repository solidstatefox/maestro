import type { SweepMotion } from "./transition";

const GRANULAR_TRAVEL = 5;
const REST = { granular: { delta: 0.005, speed: 0.01 }, px: { delta: 0.5, speed: 2 } } as const;
const SECONDS = 1000;

interface Segment {
  readonly from: number;
  /** Velocity at the start, units per second. */
  readonly velocity: number;
  readonly target: number;
  /** When it starts moving (performance.now() ms). */
  readonly startMs: number;
  readonly motion: SweepMotion;
}

interface Sample {
  readonly x: number;
  readonly v: number;
  readonly done: boolean;
}

/** A damped spring from `u0` (displacement from the target) and `v0`, `t` seconds in: displacement and velocity. */
const springAt = (k: number, c: number, m: number, u0: number, v0: number, t: number): { readonly u: number; readonly v: number } => {
  const w0 = Math.sqrt(k / m);
  const zeta = c / (2 * Math.sqrt(k * m));
  if (Math.abs(zeta - 1) < 1e-6) {
    const b = v0 + w0 * u0;
    const e = Math.exp(-w0 * t);
    return { u: e * (u0 + b * t), v: e * (b - w0 * (u0 + b * t)) };
  }
  if (zeta < 1) {
    const a = zeta * w0;
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    const b = (v0 + a * u0) / wd;
    const e = Math.exp(-a * t);
    const cos = Math.cos(wd * t);
    const sin = Math.sin(wd * t);
    return { u: e * (u0 * cos + b * sin), v: e * ((-a * u0 + wd * b) * cos + (-a * b - wd * u0) * sin) };
  }
  const s = w0 * Math.sqrt(zeta * zeta - 1);
  const r1 = -zeta * w0 + s;
  const r2 = -zeta * w0 - s;
  const c1 = (v0 - r2 * u0) / (r1 - r2);
  const c2 = u0 - c1;
  return { u: c1 * Math.exp(r1 * t) + c2 * Math.exp(r2 * t), v: c1 * r1 * Math.exp(r1 * t) + c2 * r2 * Math.exp(r2 * t) };
};

const sample = (seg: Segment, nowMs: number): Sample => {
  const elapsed = nowMs - seg.startMs;
  if (elapsed <= 0) { return { done: false, v: 0, x: seg.from }; }
  const { motion } = seg;
  if (motion.kind === "tween") {
    if (elapsed >= motion.durationMs) { return { done: true, v: 0, x: seg.target }; }
    const p = elapsed / motion.durationMs;
    const x = seg.from + (seg.target - seg.from) * motion.ease(p);
    const ahead = seg.from + (seg.target - seg.from) * motion.ease(Math.min(1, p + 0.001));
    return { done: false, v: ((ahead - x) / (motion.durationMs * 0.001)) * SECONDS, x };
  }
  const granular = Math.abs(seg.target - seg.from) < GRANULAR_TRAVEL;
  const restDelta = motion.restDelta ?? (granular ? REST.granular.delta : REST.px.delta);
  const restSpeed = motion.restSpeed ?? (granular ? REST.granular.speed : REST.px.speed);
  const { u, v } = springAt(motion.stiffness, motion.damping, motion.mass, seg.from - seg.target, seg.velocity, elapsed / SECONDS);
  if (Math.abs(u) <= restDelta && Math.abs(v) <= restSpeed) { return { done: true, v: 0, x: seg.target }; }
  return { done: false, v, x: seg.target + u };
};

/** One channel: at rest on `x`, or moving along a segment. */
class Channel {
  private seg: Segment | null = null;
  private x: number;
  constructor(x: number) { this.x = x; }
  get moving(): boolean { return this.seg !== null; }
  get target(): number { return this.seg?.target ?? this.x; }
  /** Where it is at `nowMs` (and settles there when the segment is done). */
  at(nowMs: number): number {
    if (this.seg === null) { return this.x; }
    const s = sample(this.seg, nowMs);
    if (s.done) { this.seg = null; }
    this.x = s.x;
    return s.x;
  }
  to(target: number, nowMs: number, delayMs: number, motion: SweepMotion): void {
    const live = this.seg === null ? { v: 0, x: this.x } : sample(this.seg, nowMs);
    this.x = live.x;
    this.seg = live.x === target && live.v === 0 ? null : { from: live.x, motion, startMs: nowMs + delayMs, target, velocity: live.v };
  }
  jump(target: number): void {
    this.seg = null;
    this.x = target;
  }
}

export interface Sweep {
  /** The lit notch count and the value (0–1) now. */
  readonly fill: () => number;
  readonly value: () => number;
  /** Sweeps both channels to their targets (`delayMs` before moving); `instant` jumps there. Repeated targets keep the running sweep. */
  readonly to: (fill: number, value: number, options: { readonly delayMs: number; readonly instant: boolean; readonly motion: SweepMotion }) => void;
  /** Starts the frame loop again after `pause` (a no-op at rest). */
  readonly resume: () => void;
  /** Stops the frame loop (the state is kept: `resume` carries on from it). */
  readonly pause: () => void;
}

/** A sweep starting at (`fill`, `value`); `onFrame` is called on every frame it moves, and once at rest. */
export function createSweep(fill: number, value: number, onFrame: (fill: number, value: number) => void): Sweep {
  const lit = new Channel(fill);
  const val = new Channel(value);
  let frame = 0;
  let paused = true;
  const tick = (): void => {
    frame = 0;
    const now = performance.now();
    const f = lit.at(now);
    const v = val.at(now);
    onFrame(f, v);
    if (lit.moving || val.moving) { frame = requestAnimationFrame(tick); }
  };
  const run = (): void => {
    if (!paused && frame === 0 && (lit.moving || val.moving)) { frame = requestAnimationFrame(tick); }
  };
  return {
    fill: () => lit.at(performance.now()),
    pause: () => {
      paused = true;
      cancelAnimationFrame(frame);
      frame = 0;
    },
    resume: () => {
      paused = false;
      run();
    },
    to: (nextFill, nextValue, { delayMs, instant, motion }) => {
      if (instant) {
        lit.jump(nextFill);
        val.jump(nextValue);
        onFrame(nextFill, nextValue);
        return;
      }
      const now = performance.now();
      if (lit.target !== nextFill) { lit.to(nextFill, now, delayMs, motion); }
      if (val.target !== nextValue) { val.to(nextValue, now, delayMs, motion); }
      run();
    },
    value: () => val.at(performance.now()),
  };
}
