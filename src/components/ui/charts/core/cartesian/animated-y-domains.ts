import { prefersReducedMotion } from "../loading/reduced-motion";
import { REVEAL_EASING } from "../motion/easing";
import type { ChartPhase } from "../motion/phase";
import { isYDomainTweenPhase, shouldTweenYDomain } from "./y-domain-utils";
import type { YDomain } from "./y-domain-utils";

export type YDomainsByAxis = Readonly<Record<string, YDomain>>;

export interface UseAnimatedYDomainsOptions {
  /** Tween at all (`false` snaps every change). */
  readonly enabled: boolean;
  /** Tween length in ms. */
  readonly durationMs: number;
  readonly chartPhase: ChartPhase;
  /** The loading skeleton's domains, the destination while loading. */
  readonly skeletonByAxis: YDomainsByAxis;
  /** The data's domains, the destination once ready. */
  readonly targetByAxis: YDomainsByAxis;
  /** Called when a phase tween lands (or snaps). */
  readonly onSettled?: () => void;
  /** Tween target changes while the chart is ready (a brush zoom), instead of snapping them. Default: false. */
  readonly tweenOnTargetChange?: boolean;
}

export interface AnimatedYDomains {
  /** The tweened domains (what to draw with is `animatedYDomainsFor(options, get())`). */
  readonly get: () => YDomainsByAxis;
  readonly subscribe: (listener: () => void) => () => void;
  /** Feeds a render's options; a phase or target change starts (or snaps) the tween. */
  readonly update: (options: UseAnimatedYDomainsOptions) => void;
  /** Stops a tween in flight (unmount). */
  readonly destroy: () => void;
}

const FALLBACK: YDomain = [0, 100];

/** bklit resolveAnimatedYDestinationDomains: the skeleton's domains while loading or leaving for it, the target's otherwise. */
export const animatedYDestination = (phase: ChartPhase, skeleton: YDomainsByAxis, target: YDomainsByAxis): YDomainsByAxis =>
  phase === "loading" || phase === "exiting" || phase === "gridTweenLoading" ? skeleton : target;

export function domainsEqual(a: YDomainsByAxis, b: YDomainsByAxis): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) {
    return false;
  }
  return keys.every((id) => {
    const x = a[id];
    const y = b[id];
    return x !== undefined && y !== undefined && x[0] === y[0] && x[1] === y[1];
  });
}

const signatureOf = (domains: YDomainsByAxis): string =>
  Object.keys(domains)
    .sort()
    .map((id) => `${id}:${domains[id]?.[0]},${domains[id]?.[1]}`)
    .join("|");

/** Outside a tween phase (or an opted-in ready tween) a chart draws straight at its destination: bklit resolves it during render. */
const mayTween = (o: UseAnimatedYDomainsOptions): boolean =>
  isYDomainTweenPhase(o.chartPhase) || (o.tweenOnTargetChange === true && o.chartPhase === "ready" && o.enabled && !prefersReducedMotion());

/** The domains a render draws with: the store's tween while one may run, else the options' destination (read with the render's own options). */
export const animatedYDomainsFor = (options: UseAnimatedYDomainsOptions, animated: YDomainsByAxis): YDomainsByAxis =>
  mayTween(options) ? animated : animatedYDestination(options.chartPhase, options.skeletonByAxis, options.targetByAxis);

export function createAnimatedYDomains(initial: UseAnimatedYDomainsOptions): AnimatedYDomains {
  let options = initial;
  let animated: YDomainsByAxis = animatedYDestination(initial.chartPhase, initial.skeletonByAxis, initial.targetByAxis);
  let phase = initial.chartPhase;
  let targetSig = signatureOf(initial.targetByAxis);
  let frame = 0;
  const listeners = new Set<() => void>();
  const emit = (): void => {
    for (const listener of listeners) {
      listener();
    }
  };
  const stop = (): void => {
    if (frame !== 0) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  };
  const snap = (to: YDomainsByAxis): void => {
    stop();
    if (!domainsEqual(animated, to)) {
      animated = to;
      emit();
    }
  };
  const tween = (to: YDomainsByAxis, settle: boolean): void => {
    stop();
    const done = (): void => {
      snap(to);
      if (settle) {
        options.onSettled?.();
      }
    };
    if (domainsEqual(animated, to) || !options.enabled || options.durationMs <= 0 || prefersReducedMotion() || typeof requestAnimationFrame !== "function") {
      done();
      return;
    }
    const from = animated;
    const ids = Object.keys(to);
    if (!ids.some((id) => shouldTweenYDomain(from[id] ?? to[id] ?? FALLBACK, to[id] ?? FALLBACK))) {
      done();
      return;
    }
    const start = performance.now();
    const step = (now: number): void => {
      const t = Math.min(1, (now - start) / options.durationMs);
      const k = REVEAL_EASING(t);
      const next: Record<string, YDomain> = {};
      for (const id of ids) {
        const a = from[id] ?? to[id] ?? FALLBACK;
        const b = to[id] ?? a;
        next[id] = shouldTweenYDomain(a, b) ? [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k] : b;
      }
      animated = next;
      if (t >= 1) {
        frame = 0;
        done();
        return;
      }
      emit();
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  };
  return {
    get: () => animated,
    subscribe: (listener) => {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },
    update: (next) => {
      const prevPhase = phase;
      options = next;
      phase = next.chartPhase;
      const sig = signatureOf(next.targetByAxis);
      const targetChanged = sig !== targetSig;
      targetSig = sig;
      if (phase !== prevPhase) {
        if (phase === "exiting" || phase === "loading") {
          snap(next.skeletonByAxis);
        } else if (phase === "exitingReady" || phase === "revealing" || phase === "ready") {
          snap(next.targetByAxis);
        } else if (isYDomainTweenPhase(phase)) {
          tween(animatedYDestination(phase, next.skeletonByAxis, next.targetByAxis), true);
        }
        return;
      }
      if (targetChanged && (phase === "ready" || phase === "revealing")) {
        if (next.tweenOnTargetChange === true && phase === "ready") {
          tween(next.targetByAxis, true);
        } else {
          snap(next.targetByAxis);
        }
      }
    },
    destroy: stop,
  };
}
