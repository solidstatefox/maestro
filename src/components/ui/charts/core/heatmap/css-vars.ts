import type { HeatmapLevelColors, HeatmapLevelStyles } from "./colors";
import { HEATMAP_DEFAULT_LEVEL_COLORS } from "./colors";

/** @internal */
export const heatmapCssVars = /* @__PURE__ */ (() => ({
  empty: HEATMAP_DEFAULT_LEVEL_COLORS[0],
  level1: HEATMAP_DEFAULT_LEVEL_COLORS[1],
  level2: HEATMAP_DEFAULT_LEVEL_COLORS[2],
  level3: HEATMAP_DEFAULT_LEVEL_COLORS[3],
  level4: HEATMAP_DEFAULT_LEVEL_COLORS[4],
} as const))();

/** @internal */
export function levelColorsFromStyles(levelStyles: HeatmapLevelStyles): HeatmapLevelColors {
  return [
    levelStyles[0].color,
    levelStyles[1].color,
    levelStyles[2].color,
    levelStyles[3].color,
    levelStyles[4].color,
  ];
}
