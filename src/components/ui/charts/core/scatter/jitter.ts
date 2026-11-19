import type { ScatterJitter } from "../types/cartesian";

/** `jitter` resolved: `x` the spread as a fraction of the band step, `y` the most a point moves up or down in px, `seed` the pattern. */
export interface ResolvedScatterJitter {
  readonly x: number;
  readonly y: number;
  readonly seed: number;
}

/** bklit's default horizontal spread, in band steps. */
export const DEFAULT_SCATTER_JITTER_X = 0.35;

/** `jitter` as amounts, or null when it spreads nothing (off, `0`, or `{ x: 0, y: 0 }`). */
export const resolveScatterJitter = (jitter: ScatterJitter | undefined): ResolvedScatterJitter | null => {
  if (jitter === undefined || jitter === false) {
    return null;
  }
  if (jitter === true) {
    return { seed: 0, x: DEFAULT_SCATTER_JITTER_X, y: 0 };
  }
  if (typeof jitter === "number") {
    return jitter > 0 ? { seed: 0, x: jitter, y: 0 } : null;
  }
  const x = Math.max(0, jitter.x ?? DEFAULT_SCATTER_JITTER_X);
  const y = Math.max(0, jitter.y ?? 0);
  return x === 0 && y === 0 ? null : { seed: jitter.seed ?? 0, x, y };
};

/** The smallest gap between adjacent distinct x values (ms), and that gap as a fraction of the x span (0 under two distinct values). */
export const minDistinctStep = (times: readonly number[]): { readonly gap: number; readonly ratio: number } => {
  const distinct = [...new Set(times.filter(Number.isFinite))].toSorted((a, b) => a - b);
  const first = distinct.at(0);
  const last = distinct.at(-1);
  if (first === undefined || last === undefined || last <= first) {
    return { gap: 0, ratio: 0 };
  }
  let gap = Number.POSITIVE_INFINITY;
  for (let i = 1; i < distinct.length; i += 1) {
    gap = Math.min(gap, (distinct[i] ?? 0) - (distinct[i - 1] ?? 0));
  }
  return { gap, ratio: gap / (last - first) };
};

/** The x range's padding that keeps jittered edge points inside the plot: solves `P = base + (x / 2) * (width - 2P) * ratio` for `P`. */
export const jitterRangePadding = (basePadding: number, innerWidth: number, stepRatio: number, jitterX: number): number =>
  jitterX <= 0 || stepRatio <= 0 ? basePadding : (basePadding + (jitterX / 2) * innerWidth * stepRatio) / (1 + jitterX * stepRatio);

const HASH_MODULUS = 2_147_483_647;
const HASH_SPLIT = 65_536;
const HASH_ROUND_CONSTANT = 1_013_904_223;

/** `(a * b) mod HASH_MODULUS` for `a, b < 2^31`, `b` split into 16-bit halves so every step stays exact in a float64. */
const mulMod = (a: number, b: number): number => {
  const high = Math.floor(b / HASH_SPLIT);
  const low = b % HASH_SPLIT;
  return (((a * high) % HASH_MODULUS) * HASH_SPLIT + a * low) % HASH_MODULUS;
};

/** bklit's deterministic value in [-1, 1] for a point's axis (0: x, 1: y): integer math only, the same on every engine. */
export const jitterUnit = (seed: number, index: number, seriesIndex: number, axis: 0 | 1): number => {
  let state = (Math.abs(Math.trunc(seed)) * 7919 + index * 104_729 + seriesIndex * 1_299_709 + axis * 15_485_863 + 1) % HASH_MODULUS;
  // Modular squaring is non-linear, so neighbouring indices don't step evenly (no diagonal stripes).
  for (let round = 0; round < 4; round += 1) {
    state = (mulMod(state, state) + HASH_ROUND_CONSTANT) % HASH_MODULUS;
    state = mulMod(state, 48_271);
  }
  return (state / (HASH_MODULUS - 1)) * 2 - 1;
};

/**
 * Row `index`'s offset in series `seriesIndex`: `x` in ms (the spread is a fraction of the smallest step `gapMs`, so it holds at any
 * width), `y` in px.
 */
export const jitterOffset = (jitter: ResolvedScatterJitter, gapMs: number, index: number, seriesIndex: number): { readonly x: number; readonly y: number } => ({
  x: jitter.x > 0 && gapMs > 0 ? jitterUnit(jitter.seed, index, seriesIndex, 0) * (jitter.x / 2) * gapMs : 0,
  y: jitter.y > 0 ? jitterUnit(jitter.seed, index, seriesIndex, 1) * jitter.y : 0,
});
