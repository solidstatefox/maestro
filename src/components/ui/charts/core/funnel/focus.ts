import type { ChartFocusStrategy, ChartPoint } from "@tanstack/charts";

interface FunnelDatum {
  readonly stage: number;
  readonly layer?: number;
}

const FUNNEL_FOCUS_LAYER = 0;

const createFunnelFocus = (horizontal: boolean): ChartFocusStrategy<FunnelDatum, number, number> => {
  const axis = (point: ChartPoint<FunnelDatum, number, number>): number => (horizontal ? point.x : point.y);
  const outer = (points: readonly ChartPoint<FunnelDatum, number, number>[]): ChartPoint<FunnelDatum, number, number>[] =>
    points.filter((point) => point.datum.layer === FUNNEL_FOCUS_LAYER);
  return {
    group: (_points, context) => [context.point],
    navigation: (points) => outer(points).filter((point, index, all) => all.findIndex((other) => other.datum.stage === point.datum.stage) === index),
    resolve: (points, { x, y }) => {
      const pointer = horizontal ? x : y;
      const spans = new Map<number, { lo: number; hi: number; point: ChartPoint<FunnelDatum, number, number> }>();
      for (const point of outer(points)) {
        const span = spans.get(point.datum.stage);
        const position = axis(point);
        if (span) {
          span.lo = Math.min(span.lo, position);
          span.hi = Math.max(span.hi, position);
        } else {
          spans.set(point.datum.stage, { hi: position, lo: position, point });
        }
      }
      // bklit's hover target is the cell element itself, so the gap between two cells hovers nothing.
      for (const span of spans.values()) {
        if (pointer >= span.lo && pointer <= span.hi) {return [span.point];}
      }
      return [];
    },
  };
};

export { createFunnelFocus, FUNNEL_FOCUS_LAYER };
export type { FunnelDatum };
