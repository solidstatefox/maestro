import type { ResolvedScale, SceneNode } from "@tanstack/charts";

/** The class of the skeleton's group: the shimmer's target (css.ts) and the conceal's (conceal.ts). */
export const SKELETON_CLASS = "bkm-d-sk";

/** The skeleton's ink: shadcn's muted foreground toward the background (styles.css `--chart-foreground-muted`). */
export const SKELETON_INK = "var(--chart-foreground-muted)";

/** A pale tint of the ink, opaque: shapes that overlap (ridges) hide the ones behind as the chart's own fills do. */
export const SKELETON_TINT = "color-mix(in oklab, var(--chart-foreground-muted) 34%, var(--chart-background))";

/** Where a pass stands in the loading sequence. */
export interface DistributionPhase {
  /** `status="loading"`: the mark draws the family's skeleton and no interaction points (no focus, no tooltip). */
  readonly loading: boolean;
  /**
   * The status changed since the previous pass: the mark's shapes come and go without the renderer's tween (the entrance is the CSS one,
   * the conceal the controller's), so loading -> ready plays the family's own entrance.
   */
  readonly flip: boolean;
}

/** What a family's skeleton draws: its shapes (inked and shimmered) and the chrome it keeps while loading (a ridgeline's row labels). */
export interface SkeletonLayout {
  readonly shapes: readonly SceneNode[];
  readonly chrome?: readonly SceneNode[];
}

/** A shape in the skeleton's ink: filled shapes take it as their fill, strokes as their stroke; the family's own style wins. */
const inked = (node: SceneNode): SceneNode => {
  if (node.kind === "group") {
    return { ...node, children: node.children.map(inked) };
  }
  if (node.kind === "rule" || node.kind === "polyline") {
    return { ...node, style: { stroke: SKELETON_INK, fill: "none", ...node.style } };
  }
  if (node.kind === "label") {
    return node;
  }
  return { ...node, style: { fill: SKELETON_INK, ...node.style } };
};

/**
 * The skeleton's scene nodes: the chrome, then the inked shapes in the shimmering group, keyed under the mark's id (`<id>:skeleton`) so
 * the renderer's motion reads the mark's own (marks.ts: no tween on a status flip).
 */
export const skeletonNodes = (markId: string, layout: SkeletonLayout): SceneNode[] => [
  ...(layout.chrome ?? []),
  { kind: "group", key: `${markId}:skeleton`, className: SKELETON_CLASS, children: layout.shapes.map(inked) },
];

/** A seeded generator in [0, 1) (mulberry32): the skeleton's shapes are the same on every render, server and client. */
export const seeded = (seed: number): (() => number) => {
  let state = Math.trunc(seed) >>> 0;
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
};

/** A seeded normal deviate generator (Box-Muller over `seeded`). */
export const seededNormal = (seed: number): (() => number) => {
  const random = seeded(seed);
  return () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
};

/** A bell at `mean` with spread `sd` (both shares of the axis), 1 at its peak. */
export const bell = (t: number, mean: number, sd: number): number => Math.exp(-((t - mean) ** 2) / (2 * sd * sd));

/** One band of a category axis: its start and width in pixels. */
export interface SkeletonBand {
  readonly start: number;
  readonly width: number;
}

/**
 * The bands the skeleton fills: the chart's own categories when it has some (the axis already shows them), else `fallback` bands spread
 * over `span` with the band scale's paddings, as `scaleBand` would lay them out.
 */
export function skeletonBands(scale: ResolvedScale, categories: readonly string[], span: readonly [number, number], fallback: number, paddingInner: number, paddingOuter: number): SkeletonBand[] {
  if (categories.length > 0) {
    // The resolved band scale maps a category to its band's centre (marks.ts `bandOf`).
    return categories.map((category) => ({ start: scale.map(category) - scale.bandwidth / 2, width: scale.bandwidth }));
  }
  const [lo, hi] = span;
  const step = (hi - lo) / Math.max(1, fallback - paddingInner + paddingOuter * 2);
  const width = step * (1 - paddingInner);
  return Array.from({ length: fallback }, (_unused, i) => ({ start: lo + step * paddingOuter + i * step, width }));
}

/** One point of a skeleton density profile: `t` along the value axis (a share of it), `h` its height (0 to 1). */
export interface SkeletonProfilePoint {
  readonly t: number;
  readonly h: number;
}

/**
 * A seeded density profile for a violin's body or a ridge: two humps of random weight and spread between random ends, tapering to zero at
 * both, `samples` points, scaled to 1 at its peak.
 */
export function skeletonProfile(random: () => number, samples = 28): SkeletonProfilePoint[] {
  const lo = 0.06 + random() * 0.12;
  const hi = 0.72 + random() * 0.22;
  const first = 0.28 + random() * 0.16;
  const second = 0.55 + random() * 0.2;
  const spreadA = 0.07 + random() * 0.05;
  const spreadB = 0.09 + random() * 0.07;
  const weight = 0.35 + random() * 0.6;
  const raw = Array.from({ length: samples }, (_unused, i) => {
    const u = i / (samples - 1);
    const t = lo + u * (hi - lo);
    return { t, h: (bell(t, first, spreadA) + weight * bell(t, second, spreadB)) * Math.sin(Math.PI * u) ** 0.7 };
  });
  const peak = Math.max(...raw.map((p) => p.h)) || 1;
  return raw.map((p) => ({ t: p.t, h: p.h / peak }));
}

/** The rows a ready-made loading placeholder (`HistogramChartLoading`…) hands its chart: none. */
export const NO_ROWS: readonly Readonly<Record<string, unknown>>[] = [];
