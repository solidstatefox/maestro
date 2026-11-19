"use client";
// TooltipDot / TooltipIndicator: config carriers, since natively the hover dot and crosshair are the chart's own marks
// (core/tooltip/tooltip-carriers.ts merges their style props into the tooltip config).
import { defineCarrier } from "../role";
import type { TooltipDotProps, TooltipIndicatorProps } from "../../core/types/tooltip";

/**
 * Styles the dots drawn on each series at the hovered position. It renders nothing itself; place it as a child of the chart next to `ChartTooltip`. Equivalent to the `dot*` props of `ChartTooltip`.
 */
export const TooltipDot = /* @__PURE__ */ defineCarrier<TooltipDotProps>("tooltipDot", "TooltipDot");
/**
 * Styles the vertical crosshair at the hovered position. It renders nothing itself; place it as a child of the chart next to `ChartTooltip`. Equivalent to the `indicator*` props of `ChartTooltip`.
 */
export const TooltipIndicator = /* @__PURE__ */ defineCarrier<TooltipIndicatorProps>("tooltipIndicator", "TooltipIndicator");
