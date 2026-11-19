import type { ChartMotionTransition } from "@tanstack/charts";
import { DEFAULT_CHART_CONFIG } from "../cartesian/chart-config";
import { resolveTooltipBoxMotion } from "../helpers";
import { TOOLTIP_MOTION } from "../theme";
import type { SpringConfig } from "../types/cartesian";

export interface TooltipBoxMotionProps {
  readonly springConfig?: SpringConfig;
  readonly matchCrosshair?: boolean;
  readonly damping?: number;
  readonly boxSpringConfig?: SpringConfig;
}

const spring = ({ stiffness, damping }: SpringConfig): ChartMotionTransition => ({ ...TOOLTIP_MOTION, stiffness, damping });

/** The panel glide in bklit's priority (chart-tooltip.tsx:161-181): `boxSpringConfig`, the crosshair spring, then `damping` (chart-config-context.tsx:59-90; 0 = instant),
 * on the snappy variant's slider (helpers.ts resolveTooltipBoxMotion: the default is TOOLTIP_MOTION). */
export function tooltipBoxMotion(props: TooltipBoxMotionProps | undefined): ChartMotionTransition {
  if (props?.boxSpringConfig) {
    return spring(props.boxSpringConfig);
  }
  if (props?.matchCrosshair === true) {
    return spring(props.springConfig ?? DEFAULT_CHART_CONFIG.tooltipSpring);
  }
  const { animate, springConfig } = resolveTooltipBoxMotion(props?.damping);
  if (!animate) {
    return { type: "tween", duration: 0 };
  }
  const base = DEFAULT_CHART_CONFIG.tooltipBoxSpring;
  return springConfig.stiffness === base.stiffness && springConfig.damping === base.damping ? TOOLTIP_MOTION : spring(springConfig);
}
