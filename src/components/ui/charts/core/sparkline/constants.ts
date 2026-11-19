import type { SparklineSpringConfig } from "../types/sparkline";

/** Enter duration of a sparkline, in ms. */
export const DEFAULT_SPARKLINE_ANIMATION_DURATION_MS = 900;

/** How long a sparkline morphs to new data, in ms: the main charts' data-change tween (`DEFAULT_Y_DOMAIN_TWEEN_MS`). */
export const DEFAULT_SPARKLINE_DATA_TRANSITION_MS = 500;

/** The crosshair and dot's hover spring: the main charts' tooltip spring (`tooltipSpring`). */
export const DEFAULT_SPARKLINE_HOVER_SPRING: SparklineSpringConfig = { stiffness: 300, damping: 30 };
