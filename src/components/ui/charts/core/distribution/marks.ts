import { createMark } from "@tanstack/charts";
import type { ChartBounds, ChartMark, ChartMotionContext, ChartMotionDefinition, ChartPoint, MarkRenderContext, ResolvedScale, SceneNode } from "@tanstack/charts";
import { erase } from "../erased-types";
import type { DistributionLive } from "./frame";
import { skeletonNodes } from "./skeleton";
import type { DistributionPhase, SkeletonLayout } from "./skeleton";

/** One item's point: a bin, a category, an observation. `x`/`y` place the tooltip (it pins to the plot top beside `x`). */
export interface ItemPoint<Datum> {
  readonly key: string;
  readonly datum: Datum;
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly xValue: number | string;
  readonly yValue: number | string;
  readonly color: string;
  readonly label?: string;
}

/** What a family's mark draws at the resolved scales. */
export interface MarkLayout<Datum> {
  readonly nodes: readonly SceneNode[];
  readonly points: readonly ItemPoint<Datum>[];
}

/** The scales a mark reads (the chart's `x` and `y`). */
export interface MarkScales {
  readonly x: ResolvedScale;
  readonly y: ResolvedScale;
  readonly chart: ChartBounds;
}

/**
 * On a status flip the shapes come and go at once (the CSS entrance and the controller's conceal animate them); updates still glide. The
 * renderer finds a shape's mark by its point's key or by a top-level key under the mark's id (`<id>:…`): a family keys its groups so.
 */
const FLIP_MOTION: ChartMotionDefinition = (context: ChartMotionContext) => (context.phase === "update" ? undefined : false);

/**
 * The chart's one mark: `channels` give the scales their domains (a value scale's extent, a band scale's categories), `layout` draws at the
 * resolved scales, `skeleton` while loading (`phase`). The plot box goes to `live` first (the focus keeps the pointer inside it).
 */
export function distributionMark<Datum>(input: {
  readonly id: string;
  readonly live: DistributionLive;
  readonly phase: DistributionPhase;
  readonly x: readonly unknown[];
  readonly y: readonly unknown[];
  readonly layout: (scales: MarkScales) => MarkLayout<Datum>;
  /** The loading state's shapes at the same scales: plain geometry, which skeleton.ts inks and shimmers. */
  readonly skeleton: (scales: MarkScales) => SkeletonLayout;
}): ChartMark<Datum, number | string, number | string> {
  const { id, live, layout, phase, skeleton } = input;
  return erase(
    createMark<Datum, number | string, number | string>(
      () => ({
        id,
        channels: { x: { scale: "x", values: input.x }, y: { scale: "y", values: input.y } },
        render: ({ chart, scales }: MarkRenderContext) => {
          live.chart = chart;
          const x = scales.x;
          const y = scales.y;
          if (x === undefined || y === undefined) {
            return { nodes: [] };
          }
          if (phase.loading) {
            return { nodes: skeletonNodes(id, skeleton({ x, y, chart })), points: [] };
          }
          const drawn = layout({ x, y, chart });
          const points: ChartPoint<Datum, number | string, number | string>[] = drawn.points.map((p) => ({
            key: p.key,
            markId: id,
            group: null,
            groupLabel: p.label ?? "",
            datum: p.datum,
            datumIndex: p.index,
            xValue: p.xValue,
            yValue: p.yValue,
            x: p.x,
            y: p.y,
            color: p.color,
          }));
          return { nodes: drawn.nodes, points };
        },
      }),
      phase.flip ? FLIP_MOTION : undefined,
    ),
  );
}

/** A band scale's band for a category: its start and width (the resolved scale maps a category to its band's centre). */
export const bandOf = (scale: ResolvedScale, category: string): { readonly start: number; readonly width: number } => {
  const width = scale.bandwidth;
  return { start: scale.map(category) - width / 2, width };
};

/** Rounds a pixel coordinate to a tenth (shorter markup, no visible change). */
export const px = (value: number): number => Math.round(value * 10) / 10;

/** Shapes laid along a value axis at a category's position, for either orientation (`horizontal`: values along x). */
export interface Oriented {
  /** A rect spanning `[c0, c1]` across the categories and `[v0, v1]` (pixels) along the values. */
  rect(c0: number, c1: number, v0: number, v1: number): { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  /** A rule along the values at category position `c`, from `v0` to `v1` (pixels). */
  along(c: number, v0: number, v1: number): { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number };
  /** A rule across the categories from `c0` to `c1` at value position `v` (pixels). */
  across(c0: number, c1: number, v: number): { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number };
  /** The point at category position `c` and value position `v`. */
  at(c: number, v: number): { readonly x: number; readonly y: number };
}

export const oriented = (horizontal: boolean): Oriented => ({
  rect: (c0, c1, v0, v1) => {
    const lo = Math.min(v0, v1);
    const size = Math.abs(v1 - v0);
    return horizontal ? { x: px(lo), y: px(c0), width: px(size), height: px(c1 - c0) } : { x: px(c0), y: px(lo), width: px(c1 - c0), height: px(size) };
  },
  along: (c, v0, v1) => (horizontal ? { x1: px(v0), y1: px(c), x2: px(v1), y2: px(c) } : { x1: px(c), y1: px(v0), x2: px(c), y2: px(v1) }),
  across: (c0, c1, v) => (horizontal ? { x1: px(v), y1: px(c0), x2: px(v), y2: px(c1) } : { x1: px(c0), y1: px(v), x2: px(c1), y2: px(v) }),
  at: (c, v) => (horizontal ? { x: v, y: c } : { x: c, y: v }),
});
