import type { EntranceOrigin } from "../entrance/entrance-origin";
import { memoCell } from "../memo";
import { buildEnterDelays } from "./arcs";
import type { ArcDatum, SunburstEnterDelays } from "./arcs";
import { LABEL_START_RATIO } from "./labels";
import { DEFAULT_ENTER_SPRING, toCssEase, toEaseFn } from "../motion/enter-transition";
import type { EnterTransition } from "../motion/phase";
import { REST_GRANULAR, settleMs, springCurve, springOf } from "../motion/spring-curve";

const SWEEP_MS = 1100;
/** The default curve's CSS easing: styles.css writes it as the fallback, so the host carries `--bkm-sb-ease` only for another. */
const REVEAL_CSS = /* @__PURE__ */ toCssEase(undefined);
const SECONDS_TO_MS = 1000;

// bklit's sector grow, sector path and label fade are all motion values (JS-driven), so the CSS ones take motion's `motion` origin.
export const SUNBURST_ENTRANCE_ORIGINS = { "bk-sb-grow": "motion", "bk-sb-label-in": "motion" } satisfies Readonly<Record<string, EntranceOrigin>>;

/** The sweep duration in ms from bklit's `Transition.duration` (seconds). */
export const sweepMsOf = (duration: number | undefined): number => (duration === undefined ? SWEEP_MS : duration * SECONDS_TO_MS);

/** The sweep from bklit's enter `Transition`: its length, and its curve as the JS tweens' function and the CSS grow's and label fade's easing. */
export interface Sweep {
  readonly ms: number;
  readonly fn: (t: number) => number;
  readonly css: string;
}

const SPRING_STEP_MS = 16;
const SPRING_LIMIT_MS = 4000;
const SPRING_SAMPLES = 48;
const SPRING_DECIMALS = 3;

/**
 * A tween's `duration` (seconds, default 1.1) and `ease` (a 4-number bezier or an easing function; default the reveal curve), or a
 * spring's `stiffness` / `damping` / `mass` (motion's defaults where unset) run to rest as its curve: bklit's `useMountProgress` plays the
 * sweep on the enter transition as it is, overshoot included.
 */
export const sweepOf = (transition: EnterTransition | undefined): Sweep => {
  if (transition?.type === "spring") {
    const spring = { damping: transition.damping ?? DEFAULT_ENTER_SPRING.damping, mass: transition.mass ?? DEFAULT_ENTER_SPRING.mass, stiffness: transition.stiffness ?? DEFAULT_ENTER_SPRING.stiffness };
    const native = springOf(spring, REST_GRANULAR);
    const ms = settleMs(native, { from: 0, to: 1, velocity: 0 }, SPRING_STEP_MS, SPRING_LIMIT_MS);
    const fn = (t: number): number => (t >= 1 ? 1 : native.sample(t * ms, { from: 0, to: 1, velocity: 0 }).value);
    return { css: springCurve(spring, { decimals: SPRING_DECIMALS, durationMs: ms, rest: REST_GRANULAR, samples: SPRING_SAMPLES }).ease, fn, ms };
  }
  return { css: toCssEase(transition?.ease), fn: toEaseFn(transition?.ease), ms: sweepMsOf(transition?.duration) };
};

interface IntroInput {
  readonly arcs: readonly ArcDatum[];
  readonly enterStaggerScale: number;
  readonly sweepMs: number;
  /** The sweep curve's CSS easing (`--bkm-sb-ease`). */
  readonly sweepCss: string;
  /** The play being shown (the chart's `playKey`): a new key replays the entrance. */
  readonly playKey: number;
}

export interface SunburstIntroFrame {
  /** True once this play's entrance has played; the host drops its intro attribute and vars. */
  readonly settled: boolean;
  /** How long this play's entrance runs, for `play`. */
  readonly introMs: number;
  /** Host CSS vars the label fade and the sector grow read (sunburst.css) while `data-bk-intro` gates them; empty once settled. */
  readonly hostVars: Readonly<Record<string, string>>;
}

export interface SunburstIntro {
  /** Feeds the latest arcs, timing and play (each controller pass). */
  update(input: IntroInput): SunburstIntroFrame;
  /** True while the entrance of the play last fed to `update` runs. Read lazily by the motion callback so the end of the entrance does not
   * rebuild the definition (a rebuild re-runs an 850ms no-op update tween). */
  readonly isIntro: () => boolean;
  /** Starts the settle timer of the committed play (the controller's passive work, on the play and its length); returns the cancel. */
  play(playKey: number, introMs: number): () => void;
}

/** The entrance over `onSettle`, called once a play's entrance has played (its owner re-renders: `update` then reports it settled). */
export const createSunburstIntro = (onSettle: () => void): SunburstIntro => {
  let settledKey: number | null = null;
  let intro = true;
  const delaysCell = memoCell<SunburstEnterDelays>();
  return {
    update({ arcs, enterStaggerScale, sweepMs, sweepCss, playKey }) {
      const enterDelays = delaysCell([arcs, enterStaggerScale], () => buildEnterDelays(arcs, enterStaggerScale));
      const labelDelayMs = enterDelays.maxDelay + sweepMs * LABEL_START_RATIO;
      const settled = settledKey === playKey;
      intro = !settled;
      const hostVars: Readonly<Record<string, string>> = settled ? {} : { "--bkm-sb-label-delay": `${labelDelayMs}ms`, "--bkm-sb-label-dur": `${sweepMs}ms`, ...(sweepCss === REVEAL_CSS ? undefined : { "--bkm-sb-ease": sweepCss }) };
      return {
        hostVars,
        introMs: enterDelays.maxDelay + sweepMs + sweepMs * LABEL_START_RATIO,
        settled,
      };
    },
    isIntro: () => intro,
    play(playKey, introMs) {
      // No bklit timer: bklit flips each segment at delay+duration (useEnterComplete, use-enter-complete.ts:11-26); the labels end at maxDelay + 0.85*sweep + sweep (sunburst-labels.tsx:51-53).
      const settle = setTimeout(() => {
        if (settledKey !== playKey) {
          settledKey = playKey;
          onSettle();
        }
      }, introMs);
      return (): void => {
        clearTimeout(settle);
      };
    },
  };
};
