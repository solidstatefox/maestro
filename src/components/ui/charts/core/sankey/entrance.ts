import type { ChartMotionTransition } from "@tanstack/charts";
import { toMotionTransition } from "../motion/enter-transition";
import type { Transition } from "../motion/phase";
import type { EntranceOrigin } from "../entrance/entrance-origin";

/** bklit: the node and label opacities are WAAPI (motion.rect / motion.g), the node scaleY and label slide are JS-driven (motion clock) (see alignEntranceStart). */
export const SANKEY_ENTRANCE_ORIGINS = { "bkm-sankey-label-in": "frame", "bkm-sankey-node-grow": "motion", "bkm-sankey-label-in-left": "motion", "bkm-sankey-label-in-right": "motion" } as const satisfies Readonly<Record<string, EntranceOrigin>>;

// bklit enter transition prop -> native motion transition (default: 1100ms cubic-bezier tween; springs use motion's rest thresholds).
const MOTION_REST = { restDelta: 0.5, restSpeed: 2 } as const;
export const toNativeTransition = (transition: Transition | undefined, durationMs: number): ChartMotionTransition => {
  const native = toMotionTransition({ duration: durationMs / 1000, ...transition });
  return native.type === "spring" ? { ...native, ...MOTION_REST } : native;
};
