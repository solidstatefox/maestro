import type { HeatmapLevelStyles } from "./colors";

const LEGEND_GRADIENT_MAX_PERCENT = 100;

/**
 * CSS `linear-gradient` for a continuous legend bar from level styles.
 * @internal
 */
export const buildHeatmapLegendGradient = (levelStyles: HeatmapLevelStyles): string => {
  const lastIndex = levelStyles.length - 1;
  const stops = levelStyles.map((style, index) => {
    const offset = lastIndex === 0 ? 0 : (index / lastIndex) * LEGEND_GRADIENT_MAX_PERCENT;
    return `${style.color} ${offset}%`;
  });
  return `linear-gradient(to right, ${stops.join(", ")})`;
}
