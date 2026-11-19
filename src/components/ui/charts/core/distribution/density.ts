import { binX } from "@tanstack/charts/transform/bin";
import { normalize } from "@tanstack/charts/transform/normalize";

/** One group's profile: the bin centres and their heights, 0 to 1 (1 at the group's peak), zero at both ends. */
export interface DensityProfile {
  readonly at: readonly number[];
  readonly height: readonly number[];
}

/** A Gaussian kernel of `sigma` bins, three sigmas wide. */
const kernelOf = (sigma: number): number[] => {
  const reach = Math.max(1, Math.ceil(sigma * 3));
  const weights: number[] = [];
  for (let k = -reach; k <= reach; k += 1) {
    weights.push(Math.exp(-(k * k) / (2 * sigma * sigma)));
  }
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => w / total);
};

/**
 * Each group's profile over `[lo, hi]` padded so the tails reach zero: `bins` equal bins (binX, grouped), smoothed by `smooth` bins,
 * normalized to the group's peak (normalize, basis max).
 */
export function densityProfiles(groups: readonly (readonly number[])[], lo: number, hi: number, bins: number, smooth = 1.2): DensityProfile[] {
  const count = Math.max(4, Math.round(bins));
  const span = hi - lo || 1;
  const step = span / count;
  // Two empty bins past each end, so the smoothed outline closes on the axis.
  const start = lo - step * 2;
  const thresholds = Array.from({ length: count + 5 }, (_, i) => start + i * step);
  const rows = groups.flatMap((values, g) => values.map((v) => ({ g, v })));
  if (rows.length === 0) {
    return groups.map(() => ({ at: [], height: [] }));
  }
  const binned = binX(rows, { value: "v", by: "g", thresholds, domain: [thresholds[0], thresholds.at(-1) ?? hi], outputs: { count: { reduce: "count" } } });
  const kernel = kernelOf(smooth);
  const reach = (kernel.length - 1) / 2;
  const counts = groups.map((): number[] => []);
  const centres = groups.map((): number[] => []);
  for (const row of binned) {
    counts[row.g]?.push(row.count);
    centres[row.g]?.push(row.x);
  }
  const smoothed = counts.flatMap((list, g) =>
    list.map((_, i) => {
      let sum = 0;
      for (let k = -reach; k <= reach; k += 1) {
        sum += (list[i + k] ?? 0) * (kernel[k + reach] ?? 0);
      }
      return { g, i, s: sum };
    }),
  );
  const scaled = normalize(smoothed, { value: "s", by: "g", basis: "max", as: "h" });
  const heights = groups.map((): number[] => []);
  for (const row of scaled) {
    const h = row.h;
    heights[row.g]?.push(Number.isFinite(h) ? h : 0);
  }
  return groups.map((_, g) => ({ at: centres[g] ?? [], height: heights[g] ?? [] }));
}

/**
 * A profile cut to where it has height (above `floor` of its peak), one bin of zero either side, inside `[lo, hi]`: the outline starts and
 * ends on its baseline instead of a sheer edge, and leaves out the long empty run the shared bins give it.
 */
export const trimProfile = (profile: DensityProfile, lo: number, hi: number, floor = 0.02): readonly { readonly at: number; readonly h: number }[] => {
  const points = profile.at.map((at, i) => ({ at, h: profile.height[i] ?? 0 })).filter((p) => p.at >= lo && p.at <= hi);
  const first = points.findIndex((p) => p.h > floor);
  const last = points.findLastIndex((p) => p.h > floor);
  if (first === -1) {
    return [];
  }
  const kept = points.slice(Math.max(0, first - 1), last + 2);
  return kept.map((p, i) => (i === 0 || i === kept.length - 1 ? { at: p.at, h: 0 } : p));
};

/** The linearly interpolated quantile `p` (0 to 1) of ascending `sorted` (the type-7 rule boxRows uses). */
export const quantile = (sorted: readonly number[], p: number): number => {
  if (sorted.length === 0) {
    return Number.NaN;
  }
  const at = (sorted.length - 1) * p;
  const lo = Math.floor(at);
  const a = sorted[lo] ?? 0;
  const b = sorted[Math.min(sorted.length - 1, lo + 1)] ?? a;
  return a + (b - a) * (at - lo);
};

const r = (value: number): string => String(Math.round(value * 10) / 10);

/** A smooth SVG path through `points` (Catmull-Rom as cubic Béziers), closed with `Z` when `closed`. */
export function smoothPath(points: readonly (readonly [number, number])[], closed: boolean): string {
  const n = points.length;
  if (n === 0) {
    return "";
  }
  const first = points[0];
  let d = `M${r(first[0])},${r(first[1])}`;
  for (let i = 0; i < n - 1; i += 1) {
    const p0 = points[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[closed ? (i + 2) % n : Math.min(n - 1, i + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C${r(c1x)},${r(c1y)},${r(c2x)},${r(c2y)},${r(p2[0])},${r(p2[1])}`;
  }
  return closed ? `${d}Z` : d;
}
