import type { ChartPoint } from "@tanstack/charts";
import { resolveChartTooltipPlacement } from "@tanstack/charts/tooltip/model";
import type { ChartTooltipPortalExtension, ChartTooltipPortalInput, ChartTooltipPortalPositionContext } from "@tanstack/charts/tooltip/portal";
import { trackPanelSize } from "../tooltip/track-panel-size";
import { writePlacementSide, writePosition } from "../tooltip/write-placement";
import type { ChoroplethFeature } from "../types/choropleth";

interface Point {
  readonly x: number;
  readonly y: number;
}

/** What `tooltipAnchor` (tooltip-anchor.ts) is handed. */
type AnchorArgs = readonly [readonly ChartPoint<ChoroplethFeature>[], { focus: { source: string }; plot: { x: number; y: number; width: number; height: number } }];
type Anchor = (...args: AnchorArgs) => Point | undefined;

export interface TooltipFollow {
  /** The definition's `tooltip.portal`. */
  readonly portal: () => ChartTooltipPortalInput;
  /** The definition's `tooltip.anchor`: `anchor`, its last arguments kept. */
  readonly anchor: (anchor: Anchor) => Anchor;
  /** Moves a shown panel to its focus's anchor as the map now is; false when none is shown. */
  readonly follow: () => boolean;
}

export function createTooltipFollow(): TooltipFollow {
  let anchorFn: Anchor | null = null;
  let anchorArgs: AnchorArgs | null = null;
  let placed: { readonly element: HTMLElement; readonly size: () => { width: number; height: number }; readonly input: ChartTooltipPortalPositionContext; readonly left: number; readonly top: number } | null = null;
  const resolve = (size: { width: number; height: number }, input: ChartTooltipPortalPositionContext, anchor: Point): ReturnType<typeof resolveChartTooltipPlacement> => {
    const { placement, offset, scene } = input;
    return resolveChartTooltipPlacement(anchor, size, { bottom: scene.height, left: 0, right: scene.width, top: 0 }, placement, offset);
  };
  const extension: ChartTooltipPortalExtension = {
    create: ({ element }) => {
      // What `moveToContainer` sets for the built-in placement (tooltip.ts:254-266); a portal extension skips it.
      Object.assign(element.style, { bottom: "auto", margin: "0", position: "absolute", right: "auto", zIndex: "1" });
      const panel = trackPanelSize(element);
      return {
        destroy: () => {
          panel.destroy();
          if (placed?.element === element) {placed = null;}
        },
        hide: () => {
          if (placed?.element === element) {placed = null;}
        },
        position: (input) => {
          const resolved = resolve(panel.size(), input, input.anchor);
          if (element.style.transform !== "") {element.style.transform = "";}
          writePosition(element, resolved.left, resolved.top);
          writePlacementSide(element, resolved.placement);
          placed = { element, input, left: resolved.left, size: panel.size, top: resolved.top };
          return true;
        },
        update: () => undefined,
      };
    },
    id: "choropleth-tooltip-placement",
  };
  return {
    anchor: (fn) => {
      anchorFn = fn;
      return (...args) => {
        anchorArgs = args;
        return fn(...args);
      };
    },
    follow: () => {
      if (placed === null || anchorFn === null || anchorArgs === null) {return false;}
      const anchor = anchorFn(...anchorArgs);
      if (anchor === undefined) {return false;}
      const { element, input, left, top } = placed;
      const resolved = resolve(placed.size(), input, anchor);
      // The panel's entrance animates its body, never the panel itself: its `transform` is free for the offset.
      element.style.transform = `translate(${resolved.left - left}px, ${resolved.top - top}px)`;
      writePlacementSide(element, resolved.placement);
      return true;
    },
    portal: () => ({ use: extension }),
  };
}
