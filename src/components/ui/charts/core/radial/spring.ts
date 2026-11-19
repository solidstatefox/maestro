import { REST_GRANULAR, springOf } from "../motion/spring-curve";
import type { RadialAngleValue, RadialSpringOptions } from "../types/radial";
import { TAU } from "./geometry";

/** The crosshair's spring: `RadialScrubber`'s, and the hover dots locked to it. */
export const RADIAL_CROSSHAIR_SPRING: Readonly<RadialSpringOptions> = { stiffness: 420, damping: 42 };

/** The default spring of a hover dot with a spring of its own (`"spring"` motion). */
export const RADIAL_DOT_SPRING: Readonly<RadialSpringOptions> = { stiffness: 240, damping: 24 };

// --- One frame loop for every spring and entrance of every radial chart ------------------------------------------------------------

type FrameTask = (now: number) => boolean;
const tasks = /* @__PURE__ */ new Set<FrameTask>();
let frame = 0;

const tick = (now: number): void => {
  frame = 0;
  for (const task of [...tasks]) {
    if (!task(now)) {
      tasks.delete(task);
    }
  }
  if (tasks.size > 0) {
    frame = requestAnimationFrame(tick);
  }
};

/** Runs `task` every frame until it returns false; returns its cancel. */
export const onFrames = (task: FrameTask): (() => void) => {
  tasks.add(task);
  if (frame === 0 && typeof requestAnimationFrame === "function") {
    frame = requestAnimationFrame(tick);
  }
  return () => {
    tasks.delete(task);
  };
};

// --- The animated value ----------------------------------------------------------------------------------------------------------

/** An animated value: read it, follow it, and set or jump it. */
export interface RadialAnimatedValue extends RadialAngleValue {
  /** Springs toward `target` from the live value and velocity. */
  set(target: number): void;
  /** Jumps to `value` (no motion). */
  jump(value: number): void;
  /** The value it is heading to. */
  target(): number;
  /** Stops the motion and drops the listeners. */
  destroy(): void;
}

/** A value springing on `options` (motion's defaults: mass 1). */
export function createSpringValue(initial: number, options: Readonly<RadialSpringOptions> = RADIAL_CROSSHAIR_SPRING): RadialAnimatedValue {
  const spring = springOf({ damping: options.damping ?? 10, mass: options.mass ?? 1, stiffness: options.stiffness ?? 100 }, REST_GRANULAR);
  const listeners = new Set<(value: number) => void>();
  let value = initial;
  let to = initial;
  let from = initial;
  let velocity = 0;
  let started = 0;
  let stop: (() => void) | null = null;
  const emit = (): void => {
    for (const listener of listeners) {
      listener(value);
    }
  };
  const step = (now: number): boolean => {
    const sample = spring.sample(Math.max(0, now - started), { from, to, velocity });
    if (sample.done) {
      value = to;
      velocity = 0;
      stop = null;
      emit();
      return false;
    }
    value = sample.value;
    emit();
    return true;
  };
  const halt = (): void => {
    stop?.();
    stop = null;
  };
  return {
    get: () => value,
    target: () => to,
    on(_event, listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(target) {
      if (target === to && stop !== null) {
        return;
      }
      const now = typeof performance === "undefined" ? 0 : performance.now();
      if (stop !== null) {
        // Retarget from where the spring is now, keeping its velocity.
        const sample = spring.sample(Math.max(0, now - started), { from, to, velocity });
        value = sample.value;
        velocity = sample.velocity;
      }
      from = value;
      to = target;
      started = now;
      if (from === to && velocity === 0) {
        halt();
        return;
      }
      stop ??= onFrames(step);
    },
    jump(next) {
      halt();
      value = next;
      from = next;
      to = next;
      velocity = 0;
      emit();
    },
    destroy() {
      halt();
      listeners.clear();
    },
  };
}

/** What an angle spring follows (bklit-ui's `useRadialAngleSpring` arguments). */
export interface RadialAngleSpringInput {
  readonly angle: number;
  /** Held still while hidden; leaving hidden jumps straight to the target. */
  readonly hidden: boolean;
  /** Takes the short way round. */
  readonly isFullCircle: boolean;
  /** Jumps on every change (reduced motion). */
  readonly snap: boolean;
}

/** An angle spring: `follow` is bklit-ui's layout effect, run on every change of its input. */
export interface RadialAngleSpring {
  readonly value: RadialAnimatedValue;
  follow(input: Readonly<RadialAngleSpringInput>): void;
}

export function createRadialAngleSpring(initial: Readonly<RadialAngleSpringInput>, options: Readonly<RadialSpringOptions> = RADIAL_CROSSHAIR_SPRING): RadialAngleSpring {
  const value = createSpringValue(initial.angle, options);
  let wasHidden = initial.hidden;
  let targetAngle = initial.angle;
  return {
    value,
    follow({ angle, hidden, isFullCircle, snap }) {
      const previouslyHidden = wasHidden;
      wasHidden = hidden;
      if (hidden) {
        return;
      }
      if (previouslyHidden) {
        targetAngle = angle;
        value.jump(angle);
        return;
      }
      let next = angle;
      if (isFullCircle) {
        let delta = (angle - targetAngle) % TAU;
        if (delta > Math.PI) {
          delta -= TAU;
        } else if (delta < -Math.PI) {
          delta += TAU;
        }
        next = targetAngle + delta;
      }
      targetAngle = next;
      if (snap) {
        value.jump(next);
      } else {
        value.set(next);
      }
    },
  };
}
