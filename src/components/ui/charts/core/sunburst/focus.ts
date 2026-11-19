import { findNearestPoint } from "@tanstack/charts";
import type { ChartFocusStrategy, ChartPoint, ChartScene } from "@tanstack/charts";

interface SunburstFocusOptions<TDatum> {
  /** Last rendered scene (read at pointer time; the strategy is built with the definition). */
  readonly scene: () => ChartScene<TDatum, number, number> | null;
  /** Navigation rank of a point's datum; undefined leaves it out of keyboard order. */
  readonly orderOf: (datum: TDatum) => number | undefined;
  /** False while the point's sector has not yet started its entrance (its stagger delay); once on screen it takes the pointer on its final arc. */
  readonly entered: (datum: TDatum) => boolean;
  /** The sector whose exact arc contains the point. The native hit polygon cuts each arc edge with a few chords, leaving a sub-pixel sliver along the outer edge that bklit's SVG arc path covers (UPSTREAM-GAPS #67). */
  readonly exactAt: (x: number, y: number) => ChartPoint<TDatum, number, number> | null;
  /** The point kept hovered when a pointer move lands off every sector (hub, gaps, corners): bklit's sectors only set the hover on pointerenter. Null for a click, a re-resolve or a pointer on a sector. */
  readonly heldAt: (x: number, y: number) => ChartPoint<TDatum, number, number> | null | undefined;
}

const createSunburstFocus = <TDatum>(options: Readonly<SunburstFocusOptions<TDatum>>): ChartFocusStrategy<TDatum, number, number> => {
  // Hit-testable points per scene: the sectors drawn in this view, and the hub only when it is drawn (drilled in). At the root the hub
  // is a hair-thin disc at the centre whose point would win the nearest-point race over the ring-1 sector the centre belongs to (bklit has no disc there).
  const hittable = new WeakMap<object, readonly ChartPoint<TDatum, number, number>[]>();
  return {
    group: (_points, context) => [context.point],
    navigation: (points) =>
      points
        .flatMap((point) => {
          const rank = options.orderOf(point.datum);
          return rank === undefined ? [] : [{ point, rank }];
        })
        .toSorted((left, right) => left.rank - right.rank)
        .map(({ point }) => point),
    // Hit-tests the latest scene without the presented `points`: findNearestPoint's `allowed` set would reject the tween-time points, so the
    // renderer's own re-resolve after each render/publish (and its clear on leave) works natively through a zoom.
    resolve: (_points, { x, y, maxDistance }) => {
      const scene = options.scene();
      if (scene === null) {
        return [];
      }
      const held = options.heldAt(x, y);
      if (held !== undefined) {
        return held === null ? [] : [held];
      }
      let allowed = hittable.get(scene);
      if (allowed === undefined) {
        allowed = scene.points.filter((point) => options.orderOf(point.datum) !== undefined);
        hittable.set(scene, allowed);
      }
      const point = findNearestPoint(scene, x, y, maxDistance, allowed) ?? options.exactAt(x, y);
      return point === null || !options.entered(point.datum) ? [] : [point];
    },
  };
};

export { createSunburstFocus };
