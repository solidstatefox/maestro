import type { ReactElement, ReactNode } from "react";
import { enableZoom } from "../core/cartesian/enable-zoom";
import { TOOLTIP_DETAIL_CLASS, tooltipDetailAttrs } from "../core/tooltip/detail";
import type { TooltipDetailProps as CoreTooltipDetailProps } from "../core/tooltip/detail";
import type { ChartZoomProps } from "../core/types/link";
import { defineCarrier } from "./role";

/**
 * Zooms and pans the chart's time range: Ctrl or ⌘ with the wheel (or a pinch) zooms around the pointer, a drag or a horizontal swipe pans,
 * a double-click (or `0`) resets, `+` and `-` zoom from the keyboard. The y axis holds while you explore. In a chart with a `syncId`, every
 * chart of the group follows the window.
 */
export const ChartZoom = /* @__PURE__ */ defineCarrier<Readonly<ChartZoomProps>>("zoom", "ChartZoom", undefined, enableZoom);

/** Props of `TooltipDetail`. */
export interface TooltipDetailProps extends CoreTooltipDetailProps<ReactNode> {}

/**
 * Detail inside a custom tooltip (`ChartTooltip`'s `content`) that unfolds when the tooltip is pinned (`ChartTooltip pinnable`): put the
 * glanceable values above it and the breakdown, links or actions in it.
 */
export const TooltipDetail = ({ open, className, children }: Readonly<TooltipDetailProps>): ReactElement => (
  <div className={TOOLTIP_DETAIL_CLASS} {...tooltipDetailAttrs(open)}>
    <div>
      <div className={className}>{children}</div>
    </div>
  </div>
);
