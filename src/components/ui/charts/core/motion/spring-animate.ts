import type { ChartSpringState } from "@tanstack/charts/spring";
import { restOf, springOf } from "./spring-curve";
import type { Spring } from "./springs";

const FRAME_MS = 1000 / 120;
const MAX_MS = 20_000;

interface LiveSample {
  readonly value: number;
  readonly velocity: number;
}

interface SpringState {
  readonly spring: Spring;
  readonly target: number;
  readonly x0: number;
  readonly v0: number;
  /** Milliseconds the animation waits (holding its first frame) before the spring starts. */
  readonly delay: number;
  readonly animation: SpringClock | null;
}

/** What `live` needs of a running spring: a clock and a way to stop it (a WAAPI `Animation` fits, so does a frame-driven one). */
interface SpringClock {
  readonly playState: AnimationPlayState;
  readonly currentTime: CSSNumberish | null;
  readonly cancel: () => void;
}

interface SpringJob {
  readonly el: Element;
  readonly spring: Spring;
  /** Value the element settles on (its static CSS rule holds the same value). */
  readonly target: number;
  /** Value the element was resting at before this change; used when it has no spring state yet. */
  readonly rest: number;
  /** Start from this value at zero velocity instead of the live state (the element was just remounted at rest). */
  readonly from?: number;
  /** The keyframe that paints `value` (the scalar the spring runs on: px, scale delta, radius ...). */
  readonly frame: (value: number) => Keyframe;
  /** The keyframe is affine in the value (a scale, a translate, a colour mix): the animation then runs two keyframes under the spring as a `linear()` easing, not one keyframe per frame. */
  readonly affine?: boolean;
  /** motion's `transition.delay`: the element holds its current value for this many ms, then springs. A retarget during the delay restarts it. */
  readonly delay?: number;
  /** Write the spring to inline style once per animation frame instead of running a WAAPI animation. Main-thread-painted SVG nodes (the pie slice `<g>`) repaint on every WAAPI tick through the animation
   * pipeline, which costs about 1.4 ms of main thread per hover move; plain style writes cost less. Ignored with a `delay`. */
  readonly frames?: boolean;
}

interface SpringDriver {
  readonly play: (job: Readonly<SpringJob>) => void;
  /** Live value of an element the driver has played (analytic, no DOM read); undefined when it has never been driven. */
  readonly value: (el: Element) => number | undefined;
}

/** One rAF loop for every frame-driven spring: each step returns false once its spring has ended. */
const createFrameLoop = (): ((step: () => boolean) => void) => {
  const steps = new Set<() => boolean>();
  let pending = 0;
  const tick = (): void => {
    pending = 0;
    for (const step of [...steps]) { if (!step()) { steps.delete(step); } }
    if (steps.size > 0) { pending = requestAnimationFrame(tick); }
  };
  return (step) => {
    steps.add(step);
    if (pending === 0) { pending = requestAnimationFrame(tick); }
  };
};

const toKebab = (name: string): string => name.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

const createSpringDriver = (): SpringDriver => {
  const states = new WeakMap<Element, SpringState>();
  const runFrames = createFrameLoop();

  /** A spring played as inline style, one write per animation frame, sampling the precomputed curve (`values`, one per FRAME_MS). Reproduces motion's frame-driven x/y spring on bklit's pie slice (repos/bklit-ui/packages/ui/src/charts/pie-slice.tsx:150-157, stiffness 400 / damping 25). */
  const playFrames = (el: Element, values: readonly number[], duration: number, target: number, frame: SpringJob["frame"]): SpringClock => {
    const style = (el as HTMLElement | SVGElement).style;
    const keys = Object.keys(frame(target)).map(toKebab);
    const start = performance.now();
    let playState: AnimationPlayState = "running";
    const clear = (): void => { for (const key of keys) { style.removeProperty(key); } };
    const write = (value: number): void => {
      for (const [key, css] of Object.entries(frame(value))) { style.setProperty(toKebab(key), String(css)); }
    };
    const clock: SpringClock = {
      cancel: () => { if (playState === "running") { playState = "idle"; clear(); } },
      get currentTime() { return performance.now() - start; },
      get playState() { return playState; },
    };
    const step = (): boolean => {
      if (playState !== "running") { return false; }
      const ms = performance.now() - start;
      if (ms >= duration) { playState = "finished"; clear(); return false; }
      const at = ms / FRAME_MS;
      const index = Math.floor(at);
      const from = values[index] ?? 0;
      const to = values[index + 1] ?? 0;
      write(target + from + (to - from) * (at - index));
      return true;
    };
    step();
    runFrames(step);
    return clock;
  };

  /** Live value and velocity of an element: from its running animation's clock, or at rest on its last target when none is running. */
  const live = (el: Element, rest: number): LiveSample => {
    const state = states.get(el);
    const animation = state?.animation;
    if (state === undefined || animation === null || animation === undefined || animation.playState !== "running") {
      return { value: state === undefined ? rest : state.target, velocity: 0 };
    }
    const seconds = (Number(animation.currentTime ?? 0) - state.delay) / 1000;
    // Still inside the delay: the element holds the state the spring will start from.
    if (seconds <= 0) { return { value: state.target + state.x0, velocity: state.v0 }; }
    const sample = springOf(state.spring, restOf(state.x0)).sample(seconds * 1000, { from: state.x0, to: 0, velocity: state.v0 });
    return { value: state.target + sample.value, velocity: sample.velocity };
  };

  return {
    value: (el) => (states.has(el) ? live(el, 0).value : undefined),
    play: ({ el, spring, target, rest, from, frame, affine = false, delay = 0, frames = false }) => {
      const start = from === undefined ? live(el, rest) : { value: from, velocity: 0 };
      states.get(el)?.animation?.cancel();
      const x0 = start.value - target;
      const thresholds = restOf(x0);
      if (Math.abs(x0) <= thresholds.delta && Math.abs(start.velocity) <= thresholds.speed) {
        states.set(el, { animation: null, delay: 0, spring, target, v0: 0, x0: 0 });
        return;
      }
      const native = springOf(spring, thresholds);
      const state: ChartSpringState = { from: x0, to: 0, velocity: start.velocity };
      // One pass samples the curve and finds its settle time (the first frame at rest).
      const values: number[] = [];
      let duration = MAX_MS;
      for (let ms = 0; ms < MAX_MS; ms += FRAME_MS) {
        if (ms > 0 && native.sample(ms, state).done) { duration = ms; break; }
        values.push(native.sample(ms, state).value);
      }
      if (frames && delay === 0) {
        states.set(el, { animation: playFrames(el, values, duration, target, frame), delay: 0, spring, target, v0: start.velocity, x0 });
        return;
      }
      const motion = affine && Math.abs(x0) > thresholds.delta
        ? { easing: `linear(${values.map((value) => Math.round((1 - value / x0) * 1e4) / 1e4).join(",")},1)`, frames: [frame(start.value), frame(target)] }
        : { easing: "linear", frames: [...values.map((value) => frame(target + value)), frame(target)] };
      const animation = el.animate(motion.frames, { delay, duration, easing: motion.easing, fill: delay > 0 ? "backwards" : "none" });
      // After the last keyframe the element falls back to the static CSS rule, which holds the same target.
      states.set(el, { animation, delay, spring, target, v0: start.velocity, x0 });
    },
  };
};

/** One driver for every chart on the page: its state is keyed by element, so a handler that is rebuilt (new rows, new size) still finds the running animation. */
const springDriver = /* @__PURE__ */ createSpringDriver();

export { springDriver };
