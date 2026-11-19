import { CROSSHAIR_SPRING, HIGHLIGHT_SPRING, TOOLTIP_BOX_SPRING } from "../motion/springs";
import type { ChartConfigValue } from "../types/context";

/** The default `ChartConfigValue`. */
export const DEFAULT_CHART_CONFIG: ChartConfigValue = {
  tooltipSpring: CROSSHAIR_SPRING,
  tooltipBoxSpring: TOOLTIP_BOX_SPRING,
  highlightSpring: HIGHLIGHT_SPRING,
};
