import { resolveChartTooltipPlacement } from "@tanstack/charts/tooltip/model";
import { trackPanelSize } from "./track-panel-size";
import { writePlacementSide, writePosition } from "./write-placement";
import type { ChartTooltipPortalExtension, ChartTooltipPortalInput } from "@tanstack/charts/tooltip/portal";

const sizedTooltipPortal: ChartTooltipPortalExtension = {
  id: "sized-tooltip-placement",
  create: ({ element }) => {
    // What `moveToContainer` sets for the built-in placement (tooltip.ts:254-266); a portal extension skips it.
    Object.assign(element.style, { bottom: "auto", margin: "0", position: "absolute", right: "auto", zIndex: "1" });
    // A changed size re-places via the renderer's own ResizeObserver (tooltip.ts:164-166 schedulePosition), created before this one.
    const panel = trackPanelSize(element);
    return {
      destroy: panel.destroy,
      hide: () => undefined,
      position: ({ anchor, placement, offset, scene }) => {
        const resolved = resolveChartTooltipPlacement(anchor, panel.size(), { left: 0, top: 0, right: scene.width, bottom: scene.height }, placement, offset);
        writePosition(element, resolved.left, resolved.top);
        writePlacementSide(element, resolved.placement);
        return true;
      },
      update: () => undefined,
    };
  },
};

/** `tooltip.portal` value: the native placement without a per-paint layout read. */
export const sizedTooltipPlacement = (): ChartTooltipPortalInput => ({ use: sizedTooltipPortal });
