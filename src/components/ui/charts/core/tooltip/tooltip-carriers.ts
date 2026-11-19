import { isNumber, isString } from "../guards";
import { propsFor } from "../carriers/table";
import type { ChildTable } from "../carriers/table";
import type { IndicatorFadeEdges, IndicatorWidth } from "../types/cartesian";
import type { TooltipDotProps, TooltipIndicatorProps } from "../types/tooltip";

const fadeEdgesOf = (fadeEdges: TooltipIndicatorProps["fadeEdges"]): IndicatorFadeEdges | "none" | undefined => {
  if (isString(fadeEdges)) {
    return fadeEdges;
  }
  return fadeEdges === false ? "none" : undefined;
};

const WIDTHS: ReadonlyMap<string, number> = /* @__PURE__ */ new Map([["line", 1], ["thin", 2], ["medium", 4], ["thick", 8]]);

export const resolveIndicatorWidth = (width: IndicatorWidth | undefined): number =>
  isNumber(width) ? width : WIDTHS.get(width ?? "line") ?? 1;

/** Carrier overrides folded into the `<ChartTooltip>` props (explicit ChartTooltip props win). */
export const mergeTooltipCarriers = <T extends object>(tooltip: T | undefined, table: ChildTable): (T & Record<string, unknown>) | undefined => {
  if (tooltip === undefined) {
    return undefined;
  }
  const dot = propsFor<TooltipDotProps>(table, "tooltipDot").at(0);
  const indicator = propsFor<TooltipIndicatorProps>(table, "tooltipIndicator").at(0);
  const fromCarriers: Record<string, unknown> = {};
  if (dot !== undefined) {
    fromCarriers.showDots = dot.visible !== false;
    fromCarriers.dotSize = dot.size;
    fromCarriers.dotStrokeWidth = dot.strokeWidth;
    fromCarriers.dotColor = dot.color;
    fromCarriers.dotVariant = dot.variant;
  }
  if (indicator !== undefined) {
    fromCarriers.showCrosshair = indicator.visible !== false;
    fromCarriers.indicatorColor = indicator.colorEdge;
    fromCarriers.indicatorDasharray = indicator.strokeDasharray;
    fromCarriers.indicatorWidth = indicator.width;
    fromCarriers.indicatorFadeEdges = fadeEdgesOf(indicator.fadeEdges);
    fromCarriers.indicatorFadeLength = indicator.fadeLength;
  }
  const defined = Object.fromEntries(Object.entries(fromCarriers).filter(([, v]) => v !== undefined));
  return { ...defined, ...tooltip };
};
