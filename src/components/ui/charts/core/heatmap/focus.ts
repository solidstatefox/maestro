import type { ChartFocusStrategy, ChartScene } from "@tanstack/charts";
import { findNearestPoint } from "@tanstack/charts/scene";

type HeatmapScene = ChartScene<never, never, never>;

/** Containment focus that hit-tests the last scene's final cell geometry: the default strategy gets presented points, which omit entering cells until their motion ends (`interactionPoints()`),
 * so `findNearestPoint` without a points argument lets cells hover from their first commit as bklit's do. `navigation` and `group` stay the plain point list / hovered point. */
const createHeatmapFocus = (getScene: () => HeatmapScene | null): ChartFocusStrategy<never, never, never> => ({
  group: (_points, context) => [context.point],
  navigation: (points) => points,
  resolve: (_points, { x, y }) => {
    const scene = getScene();
    const point = scene === null ? null : findNearestPoint(scene, x, y, 0);
    return point === null ? [] : [point];
  },
});

export { createHeatmapFocus };
export type { HeatmapScene };
