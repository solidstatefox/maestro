import type { EntranceOrigin } from "../entrance/entrance-origin";

/** The carrier roles of `RingGrid` and `RingLabels` (React reads them from its children, a port registers each). */
export const RING_GRID_CARRIER = "ringGrid";
export const RING_LABELS_CARRIER = "ringLabels";
/** RingChart's default `padding` with a `RingGrid` (room for its labels); 8 without. */
export const RING_GRID_PADDING = 32;
export const RING_PADDING = 8;

/** Origins of the decor's CSS animations in bklit's motion terms (entrance-origin.ts): the spokes, the glide and the ring labels' fade are
 * JS-driven motion values; the tick labels' fade is WAAPI. */
export const RING_DECOR_ORIGINS = { "bkm-ring-label-in": "motion", "bkm-ring-spoke-in": "motion", "bkm-ring-tick-fade": "frame", "bkm-ring-tick-in": "motion" } as const satisfies Readonly<Record<string, EntranceOrigin>>;
