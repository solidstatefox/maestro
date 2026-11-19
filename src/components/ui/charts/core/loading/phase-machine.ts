import { REVEAL_EASING } from "../motion/easing";
import { clearAttribute, raiseAttribute, writeVar } from "../host-write";
import type { ChartStatus } from "../motion/phase";
import { shouldTweenYDomain } from "../cartesian/y-domain-utils";

export type LoadingPhase = "loading" | "exiting" | "swap" | "tween" | "ready" | "concealing" | "tweenLoading";

/** bklit line-loading-timing.ts: 2.2s pulse cycle (the CSS loop adds the 280ms pause, styles.css `bkm-loading-pulse`). */
const PULSE_CYCLE_MS = 2200;
/** bklit line-loading-timing.ts LOADING_LABEL_EXIT_S: the sweep style fades out over 0.45s (loading-sweep.tsx:395-409) instead of finishing a cycle. */
const SWEEP_EXIT_MS = 450;
/** bklit chart-phase.ts DEFAULT_Y_DOMAIN_TWEEN_MS (use-animated-y-domains.ts:96-111). */
const Y_TWEEN_MS = 500;
/** bklit line-loading-pulse.tsx:90-93: a shrink never runs shorter than 10ms. */
const MIN_SHRINK_MS = 10;

const easeReveal = REVEAL_EASING;

type YDomains = Readonly<Record<string, readonly [number, number]>>;

/** bklit use-animated-y-domains.ts:50-79: the y domains tween only when some axis moves by at least the skip threshold (else onSettled fires at once). */
export const yDomainsTween = (from: YDomains, to: YDomains): boolean =>
  Object.entries(to).some(([id, b]) => shouldTweenYDomain(Object.hasOwn(from, id) ? from[id] : b, b));

/** The phase a status change lands on (orchestrator :52-77): to ready, a loading pulse exits (also from a half-made conceal); to loading, the series conceals first. */
const phaseAfterStatus = (status: ChartStatus, phase: LoadingPhase): LoadingPhase => {
  if (status === "loading") {
    return phase === "loading" ? phase : "concealing";
  }
  return phase === "loading" || phase === "concealing" || phase === "tweenLoading" ? "exiting" : phase;
};

/** The pulse exit that bklit's `LineLoadingPulseStroke` (line-loading-pulse.tsx:99-130) runs from the clip progress it finds. */
interface PulseExit {
  /** Progress the exit starts from, the progress the grow half ends on (equal when there is no grow), and the two durations. */
  readonly from: number;
  readonly mid: number;
  readonly growMs: number;
  readonly shrinkMs: number;
}

/** line-loading-pulse.tsx:99-111,112-130: one eased progress 0 -> 1 over 2.2s (<= 0.5 grows the clip, above shrinks it). Exit below 0.5 grows to 0.5 over `half * (0.5 - p) / 0.5`
 * then shrinks over a full half; at or above 0.5 it shrinks over `half * (1 - p) / 0.5` (10ms min). `elapsedMs` is the time into the cycle, undefined when no pulse runs. */
const pulseExitFrom = (elapsedMs: number | undefined): PulseExit => {
  const half = PULSE_CYCLE_MS / 2;
  const progress = elapsedMs === undefined ? 0 : easeReveal(Math.min(1, elapsedMs / PULSE_CYCLE_MS));
  if (progress < 0.5) {
    return { from: progress, mid: 0.5, growMs: Math.max(MIN_SHRINK_MS, (half * (0.5 - progress)) / 0.5), shrinkMs: half };
  }
  return { from: progress, mid: progress, growMs: 0, shrinkMs: Math.max(MIN_SHRINK_MS, (half * (1 - progress)) / 0.5) };
};

const EXIT_ATTR = "data-bkm-exit";

/** The exit as host vars + attribute for loading-css.ts (`--bkm-x-*`); returns the undo. Host attributes and vars are allowed. */
const writeExit = (host: HTMLElement, exit: PulseExit): (() => void) => {
  writeVar(host, "--bkm-x-from", String(exit.from));
  writeVar(host, "--bkm-x-mid", String(exit.mid));
  writeVar(host, "--bkm-x-grow", `${exit.growMs}ms`);
  writeVar(host, "--bkm-x-shrink", `${exit.shrinkMs}ms`);
  raiseAttribute(host, EXIT_ATTR);
  return (): void => { clearAttribute(host, EXIT_ATTR); };
};

interface Pending {
  readonly delay: number;
  readonly next: LoadingPhase;
  /** Advance on the next animation frame, not a timer: the wipe's instant snap is applied by the renderer's frame tick. */
  readonly onFrame?: boolean;
  /** Pulse exit to play on the host while waiting. */
  readonly exit?: PulseExit;
}

/** What a timed step reads when its phase is entered. */
export interface PhaseStepInput {
  /** Whether a series uses the sweep style (read when the exit starts). */
  readonly sweep: boolean;
  /** Whether the y domains of the latest build move enough to tween (`yDomainsTween`) and the chart tweens them. */
  readonly yTweens: boolean;
  readonly animationDuration: number;
}

/** The timed advance out of a phase, or null for the phases that wait on a status change. */
const nextStep = (phase: LoadingPhase, { sweep, yTweens, animationDuration }: PhaseStepInput, elapsed: number | undefined): Pending | null => {
  const yMs = yTweens ? Y_TWEEN_MS : 0;
  if (phase === "swap") {
    // The swap commit changes the series / chrome (a plain rebuild); the next commit lands the data so it is a data step.
    return { delay: 0, next: "tween", onFrame: true };
  }
  if (phase === "exiting") {
    if (sweep) {
      return { delay: SWEEP_EXIT_MS, next: "swap" };
    }
    const exit = pulseExitFrom(elapsed);
    return { delay: exit.growMs + exit.shrinkMs, next: "swap", exit };
  }
  if (phase === "tween") {
    return { delay: yMs, next: "ready" };
  }
  if (phase === "concealing") {
    // bklit chart-reveal-clip.tsx:67-78: the conceal clip runs `animationDuration`, then onComplete advances (orchestrator :136-142).
    return { delay: Math.max(0, animationDuration), next: "tweenLoading" };
  }
  return phase === "tweenLoading" ? { delay: yMs, next: "loading" } : null;
};

export interface LoadingFlags {
  readonly chartLoading: boolean;
  readonly skeletonRows: boolean;
  readonly gridLoading: boolean;
}

/** The series / skeleton / grid flags of a phase (orchestrator isLoadingGridChromePhase): skeleton rows stay through swap and land after the conceal. */
export const loadingFlags = (phase: LoadingPhase): LoadingFlags => {
  const chartLoading = phase === "loading" || phase === "exiting";
  return { chartLoading, skeletonRows: chartLoading || phase === "swap" || phase === "tweenLoading", gridLoading: chartLoading || phase === "tweenLoading" };
};

interface Wipe {
  readonly p: number;
  readonly ms: number;
  /** The wipe runs to the conceal window past the plot (its width depends on the plot, so the draw resolves it); `p` is then unused. */
  readonly conceal: boolean;
}

/** Wipe progress and duration per phase: loading / exiting show the pulse under an open wipe; swap / tween hold it closed until the ready reveal; concealing runs the wipe
 * past open to the conceal window (bklit's conceal clip, chart-reveal-clip.tsx:67-78), where tweenLoading holds it. */
export const loadingWipe = (phase: LoadingPhase, readyProgress: number, animationDuration: number): Wipe => {
  if (phase === "loading" || phase === "exiting") {
    return { p: 1, ms: 0, conceal: false };
  }
  if (phase === "swap") {
    return { p: 0, ms: 0, conceal: false };
  }
  if (phase === "tween") {
    return { p: 0, ms: animationDuration, conceal: false };
  }
  if (phase === "concealing") {
    return { p: 0, ms: animationDuration, conceal: true };
  }
  return phase === "tweenLoading" ? { p: 0, ms: 0, conceal: true } : { p: readyProgress, ms: animationDuration, conceal: false };
};

interface AnimationEvent {
  readonly animationName: string;
  readonly timeStamp: number;
}

export interface LoadingPhaseMachine {
  /** Render input: a status change adjusts the phase at once, so no stale phase is drawn. Returns the phase to render. */
  update(status: ChartStatus): LoadingPhase;
  /** Host `animationstart` / `animationiteration` handler: tracks where the pulse loop is. */
  readonly onAnimationEvent: (event: AnimationEvent) => void;
  /** The committed `phase`, entered after paint (React: an effect): starts its timed advance. Returns the cancel, undefined for a phase that waits on the status. */
  enter(phase: LoadingPhase, input: PhaseStepInput): (() => void) | undefined;
  /** The committed `phase`, after its entry: true once when the chart reaches ready from a concealed (swap / tween) phase (bklit isLoaded, use-chart-phase-orchestrator.ts:164-169). */
  readonly revealed: (phase: LoadingPhase) => boolean;
}

/** The machine over `host`, starting at `status`'s rest phase; `onAdvance` is called after a timed step moves the phase (the owner re-renders). */
export function createLoadingPhase(status: ChartStatus, host: () => HTMLElement | null, onAdvance: () => void): LoadingPhaseMachine {
  let tracked = status;
  let current: LoadingPhase = status === "loading" ? "loading" : "ready";
  let cycleStart: number | undefined;
  let wasConcealed = false;
  return {
    update(next) {
      if (next !== tracked) {
        current = phaseAfterStatus(next, current);
        tracked = next;
      }
      return current;
    },
    onAnimationEvent: (event) => {
      if (event.animationName === "bkm-loading-pulse") {
        cycleStart = event.timeStamp;
      }
    },
    enter(phase, input) {
      if (phase === "concealing" || phase === "tweenLoading" || phase === "swap") {
        // No pulse runs: a later exit finds a fresh stroke (progress 0), as bklit mounts it in the exiting phase.
        cycleStart = undefined;
      }
      const elapsed = cycleStart === undefined ? undefined : performance.now() - cycleStart;
      const step = nextStep(phase, input, elapsed);
      if (step === null) {
        return undefined;
      }
      const { delay, next, exit } = step;
      const onFrame = step.onFrame === true;
      const hostEl = host();
      const undoExit = exit && hostEl ? writeExit(hostEl, exit) : undefined;
      // bklit use-chart-phase-orchestrator.ts:128-152 (pulse-exit / conceal / y-tween completion advance the phase).
      const advance = (): void => {
        if (current === phase) {
          current = next;
          onAdvance();
        }
      };
      // A swap waits one frame: motion applies the 0 ms wipe snap in its rAF tick, and a commit before it cancels the snap (tween then starts from p=1).
      // bklit advances out of its y tween from motion's completion callback, i.e. a frame (use-chart-phase-orchestrator.ts:145-152).
      let cancel: () => void;
      if (onFrame) {
        const frame = requestAnimationFrame(advance);
        cancel = (): void => { cancelAnimationFrame(frame); };
      } else {
        const timer = setTimeout(advance, delay);
        cancel = (): void => { clearTimeout(timer); };
      }
      return (): void => {
        cancel();
        undoExit?.();
      };
    },
    revealed: (phase) => {
      const fire = phase === "ready" && wasConcealed;
      wasConcealed = phase === "swap" || phase === "tween";
      return fire;
    },
  };
}
