import { cubicBezier, REVEAL_BEZIER } from "../motion/easing";
import { DEFAULT_ANIMATION_DURATION_MS } from "../motion/phase";
import type { EnterTransition } from "../motion/phase";
import { MS_PER_SECOND } from "../theme";

/* bklit's heatmap motion (heatmap-animation.ts, heatmap-cells.tsx) as pure arithmetic: the column wave's per-cell delays and the loading
 * shimmer's per-cell keyframes. cell-layer.ts plays them as Web Animations on the cells the renderer drew (no per-frame JS). */

type HeatmapRevealMode = "enter" | "fromLoading" | null;

/** Enter transition. `duration` is in seconds (bklit/motion convention); `ease` is a cubic-bezier tuple or `"linear"`. */
type HeatmapEnterTransition = EnterTransition;

/** Default column-wave sweep (ms): the line chart's clip-reveal duration (heatmap-animation.ts:14). */
const HEATMAP_DEFAULT_ENTER_DURATION_MS = DEFAULT_ANIMATION_DURATION_MS;
const HEATMAP_LOADING_CHART_OPACITY = 1;
const HEATMAP_DEFAULT_LOADING_CELL_MAX_OPACITY = 0.85;
const HEATMAP_DEFAULT_LOADING_CELL_RANDOMNESS = 1;
/** Ready -> loading: the cells fade out over this before the shimmer resumes (heatmap-animation.ts:43). */
const HEATMAP_LOADING_CONCEAL_MS = 450;
const HEATMAP_CONCEAL_EASING = `cubic-bezier(${REVEAL_BEZIER.join(", ")})`;
/** Per-cell enter: a 450 ms strong ease-out (heatmap-animation.ts:22-25) from slightly small and 3px low (heatmap-cells.tsx:39). */
const HEATMAP_ENTER_FADE_MS = 450;
const HEATMAP_ENTER_FADE_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
const HEATMAP_ENTER_FROM_TRANSFORM = "translateY(3px) scale(0.86)";
/** Extra delay per row (ms): leans the wavefront into a slight diagonal. */
const HEATMAP_WAVE_ROW_LEAN_MS = 12;

// Lehmer / Park-Miller PRNG (modulus 2^31-1, multiplier 7^5).
const PARK_MILLER_MODULUS = 2_147_483_647;
const PARK_MILLER_MODULUS_MINUS_ONE = 2_147_483_646;
const PARK_MILLER_MULTIPLIER = 16_807;
const seededRandom = (seed: number): (() => number) => {
  let state = seed % PARK_MILLER_MODULUS;
  if (state <= 0) {state += PARK_MILLER_MODULUS_MINUS_ONE;}
  return () => {
    state = (state * PARK_MILLER_MULTIPLIER) % PARK_MILLER_MODULUS;
    return (state - 1) / PARK_MILLER_MODULUS_MINUS_ONE;
  };
};

const HEATMAP_SEED_COLUMN_FACTOR = 1009;
const HEATMAP_SEED_ROW_FACTOR = 9176;
const heatmapCellSeed = (column: number, row: number): number => column * HEATMAP_SEED_COLUMN_FACTOR + row * HEATMAP_SEED_ROW_FACTOR;

type Bezier = readonly [number, number, number, number];
const isBezierTuple = (ease: unknown): ease is Bezier => Array.isArray(ease) && ease.length === 4 && ease.every((point) => Number.isFinite(point));

/** The column delay curve for a reveal ease: column `c` starts when the line reveal's edge, moving along `ease(time)`, reaches it, at
 * `ease⁻¹(c)`; the inverse of cubic-bezier(x1, y1, x2, y2) is cubic-bezier(y1, x1, y2, x2) (heatmap-animation.ts:117-123). */
const inverseBezier = ([x1, y1, x2, y2]: Bezier): ((t: number) => number) => cubicBezier(y1, x1, y2, x2);
const defaultSweepEase = /* @__PURE__ */ inverseBezier(REVEAL_BEZIER);
const sweepEaseCache = /* @__PURE__ */ new Map<string, (t: number) => number>();
const resolveSweepEase = (transition: Readonly<HeatmapEnterTransition> | undefined): ((t: number) => number) => {
  // clipRevealTransition: a tween keeps its ease, anything else takes the reveal ease.
  const ease = transition?.type === "tween" ? transition.ease : undefined;
  if (ease === "linear") {return (t) => t;}
  if (!isBezierTuple(ease)) {return defaultSweepEase;}
  const key = ease.join(",");
  let fn = sweepEaseCache.get(key);
  if (fn === undefined) {
    fn = inverseBezier(ease);
    sweepEaseCache.set(key, fn);
  }
  return fn;
};

interface HeatmapWaveTiming {
  /** Delay of the last column relative to the first (ms). */
  readonly sweepMs: number;
  /** Column position (0-1) -> share of the sweep elapsed before it starts. */
  readonly sweepEase: (t: number) => number;
  /** Extra delay per row (ms). */
  readonly rowLeanMs: number;
  readonly columnCount: number;
}

/** bklit's resolveHeatmapWaveTiming: the sweep is the line reveal's (`enterTransition`'s duration, else `animationDuration`) scaled by
 * `enterStaggerScale`. */
const resolveHeatmapWaveTiming = (params: Readonly<{
  animationDurationMs: number;
  enterTransition: Readonly<HeatmapEnterTransition> | undefined;
  enterStaggerScale: number;
  columnCount: number;
}>): HeatmapWaveTiming => {
  const { enterTransition } = params;
  const durationMs = enterTransition === undefined ? params.animationDurationMs : (enterTransition.duration ?? DEFAULT_ANIMATION_DURATION_MS / MS_PER_SECOND) * MS_PER_SECOND;
  const scale = Math.max(0, params.enterStaggerScale);
  return { columnCount: params.columnCount, rowLeanMs: HEATMAP_WAVE_ROW_LEAN_MS * scale, sweepEase: resolveSweepEase(enterTransition), sweepMs: Math.max(0, durationMs) * scale };
};

/** Enter delay (ms) of a cell: its eased column position plus a small row lean. */
const heatmapWaveDelayMs = (column: number, row: number, timing: Readonly<HeatmapWaveTiming>): number => {
  const t = timing.columnCount > 1 ? Math.min(1, Math.max(0, column / (timing.columnCount - 1))) : 0;
  return timing.sweepEase(t) * timing.sweepMs + row * timing.rowLeanMs;
};

// bklit's shimmer loop per cell (heatmap-cells.tsx:313-348): tween to a random share of the max over 0.35-1.2 s on (0.45, 0, 0.55, 1),
// hold 80-500 ms, repeat. Here one cycle of those pulses, closed by a pulse back to 0, loops natively.
const SHIMMER_PULSES = 6;
const SHIMMER_RAMP_MIN_MS = 350;
const SHIMMER_RAMP_SPAN_MS = 850;
const SHIMMER_HOLD_MIN_MS = 80;
const SHIMMER_HOLD_SPAN_MS = 420;
const SHIMMER_EASING = "cubic-bezier(0.45, 0, 0.55, 1)";
const SHIMMER_SEED_SALT = 271_829;
// Neighbouring Park-Miller seeds draw correlated first values (a visible lattice across the grid): the index goes through an integer
// hash (murmur3's finaliser) first, standing in for bklit's Math.random.
const MIX_A = 0x85_eb_ca_6b;
const MIX_B = 0xc2_b2_ae_35;
const shimmerSeed = (index: number): number => {
  let hash = Math.imul(index + SHIMMER_SEED_SALT, MIX_A);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, MIX_B);
  hash ^= hash >>> 16;
  return hash >>> 0;
};

interface ShimmerLoop {
  readonly keyframes: Keyframe[];
  readonly duration: number;
}

/** One cell's shimmer cycle from 0 (the loading state starts dark, as bklit's fresh pulse does) and back, seeded by its index. */
const heatmapShimmerLoop = (index: number, maxOpacity: number): ShimmerLoop => {
  const random = seededRandom(shimmerSeed(index));
  const stops: { at: number; value: number; ramp: boolean }[] = [{ at: 0, ramp: true, value: 0 }];
  let at = 0;
  for (let pulse = 0; pulse <= SHIMMER_PULSES; pulse += 1) {
    const value = pulse === SHIMMER_PULSES ? 0 : random() * maxOpacity;
    at += SHIMMER_RAMP_MIN_MS + random() * SHIMMER_RAMP_SPAN_MS;
    stops.push({ at, ramp: false, value });
    at += SHIMMER_HOLD_MIN_MS + random() * SHIMMER_HOLD_SPAN_MS;
    stops.push({ at, ramp: true, value });
  }
  return {
    duration: at,
    keyframes: stops.map((stop) => ({ easing: stop.ramp ? SHIMMER_EASING : "linear", offset: stop.at / at, opacity: stop.value })),
  };
};

export {
  HEATMAP_CONCEAL_EASING,
  HEATMAP_DEFAULT_ENTER_DURATION_MS,
  HEATMAP_DEFAULT_LOADING_CELL_MAX_OPACITY,
  HEATMAP_DEFAULT_LOADING_CELL_RANDOMNESS,
  HEATMAP_ENTER_FADE_EASING,
  HEATMAP_ENTER_FADE_MS,
  HEATMAP_ENTER_FROM_TRANSFORM,
  HEATMAP_LOADING_CHART_OPACITY,
  HEATMAP_LOADING_CONCEAL_MS,
  heatmapCellSeed,
  heatmapShimmerLoop,
  heatmapWaveDelayMs,
  resolveHeatmapWaveTiming,
  seededRandom,
};
export type { HeatmapEnterTransition, HeatmapRevealMode, HeatmapWaveTiming };
