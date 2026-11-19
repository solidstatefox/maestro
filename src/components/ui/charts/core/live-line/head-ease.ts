export const FRAME_MS = 1000 / 60;
/** bklit's React commit interval for the live loop (LIVE_FRAME_COMMIT_MS, live-line-chart.tsx:80); also when its axis re-picks the label step. */
export const COMMIT_MS = 32;
/** The curve is run until it is within this fraction of the target, then normalised to land exactly. */
const SETTLE = 1e-3;

/** Frames the lerp needs to settle within SETTLE of its target. */
export const settleFrames = (lerp: number): number => Math.min(600, Math.max(36, Math.log(SETTLE) / Math.log(1 - lerp)));

/** Progress of bklit's per-frame lerp, as an easing over `settleFrames(lerp)` frames (progress 0..1). */
export function headEasing(lerp: number): (progress: number) => number {
  const frames = settleFrames(lerp);
  const end = 1 - (1 - lerp) ** frames;
  return (p: number): number => (1 - (1 - lerp) ** (p * frames)) / end;
}

/** Points of the sampled `linear()` easing: the chord error against the exponential is below a pixel. */
const EASE_POINTS = 24;

/** An easing (progress 0..1) as a CSS `linear()` timing function. */
export const sampledEasing = (ease: (progress: number) => number): string =>
  `linear(${Array.from({ length: EASE_POINTS + 1 }, (_, i) => Number(ease(i / EASE_POINTS).toFixed(4))).join(",")})`;

/** Steps of a CSS clock quantised to bklit's commit interval. On this grid: the roll (path easing, tail, label slides), the head settle. bklit repaints those only on its COMMIT_MS commits,
 * so a smoother clock buys style and paint passes it never does; with them all stepped the page makes fewer frames (idle share, METRICS.md). Not on it: the pulse ring, which is SMIL
 * in bklit (live-line.tsx `<animate>`) and runs at the display rate, so it stays a continuous linear animation (live-pulse.tsx). */
export const commitSteps = (ms: number): number => Math.max(1, Math.round(ms / COMMIT_MS));
/** `steps()` over `ms`: a linear clock held for each commit interval. */
export const stepEase = (ms: number): string => `steps(${commitSteps(ms)},jump-end)`;
/** An easing held for each commit interval, as a `linear()` (plateaus are repeated positions). */
export const stairEasing = (ease: (progress: number) => number, ms: number): string => {
  const n = commitSteps(ms);
  const stops: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const v = Number(ease(i / n).toFixed(4));
    stops.push(`${v} ${((i / n) * 100).toFixed(3)}%`, `${v} ${(((i + 1) / n) * 100).toFixed(3)}%`);
  }
  stops.push("1 100%");
  return `linear(${stops.join(",")})`;
};

/** Commit steps the badge text can walk through one tick (the lerp has settled by then: 0.92 ** 84 < 1e-3). */
const LABEL_STEPS = 44;
/** Commit steps a label's walk spans (live-steps.ts): the badge's steps, plus the final text. */
export const LABEL_POOL = LABEL_STEPS + 1;

export interface HeadLabel {
  readonly text: string;
  /** The commit step (COMMIT_MS each) this text first shows at. */
  readonly step: number;
}

/** The badge text over one tick. bklit commits `format(display)` about every 32ms while display chases the target at `lerp` per frame; that walk is computed once per tick
 * (display at the first step is `from`) and its distinct texts are written into the badge at their steps (live-steps.ts). */
export function headLabels(from: number, target: number, lerp: number, format: (v: number) => string): HeadLabel[] {
  const final = format(target);
  const out: HeadLabel[] = [];
  let step = 0;
  for (; step < LABEL_STEPS; step += 1) {
    const text = format(target + (from - target) * (1 - lerp) ** ((step * COMMIT_MS) / FRAME_MS));
    if (text === final) {
      break;
    }
    if (out.at(-1)?.text !== text) {
      out.push({ text, step });
    }
  }
  out.push({ text: final, step });
  return out;
}

/** bklit seeds the y domain at 0..100 then eases onto the data (live-line-chart.tsx:376-431; LIVE_FRAME_COMMIT_MS passes on the first tick); here: seed that domain, then one eased roll.
 * The roll's first sample lands a frame after its commit (charts-core motion.ts:3986-3988, `start ??= time`), so it is committed in the seed's mount effect to start the frame after bklit's first step. */
/** bklit's y domain chases the data with a per-frame lerp (lerpSpeed at 60fps): an expanding edge jumps, the others decay exponentially; this is that decay, normalised over the first roll.
 * The x shift rides the same easing (charts-core motion.ts apply(values) / motion-path.ts transform) but bklit's x is linear, so it is blended with a linear ramp (start x within ~3px, mean ~1px). */
const INTRO_Y_WEIGHT = 0.4;
export const linearEase = (p: number): number => p;
export const introEasing = (lerp: number, durationMs: number) => {
  const k = durationMs / FRAME_MS;
  const end = 1 - (1 - lerp) ** k;
  return (p: number): number => INTRO_Y_WEIGHT * ((1 - (1 - lerp) ** (p * k)) / end) + (1 - INTRO_Y_WEIGHT) * p;
};
