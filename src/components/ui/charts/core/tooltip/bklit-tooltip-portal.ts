import { trackPanelSize } from "./track-panel-size";
import type { PanelSize } from "./track-panel-size";
import { writePlacementSide, writePosition } from "./write-placement";
import type { ChartTooltipPortalExtension, ChartTooltipPortalInput } from "@tanstack/charts/tooltip/portal";
import { hostPointerMove } from "../interaction/host-pointer";

interface BklitPortalOptions {
  /** Pixels trimmed from the bottom of the scene before the vertical clamp (bklit's chart height excludes the cell inset). */
  readonly bottomInset?: number;
  /** bklit's cartesian TooltipBox passes `top={margin.top}`: the panel top sits at the anchor's y (the plot top) instead of centring on the anchor. */
  readonly pinTop?: boolean;
  /** bklit ChartTooltip `topOffset`: extra px between the plot top and a pinned panel. */
  readonly topOffset?: number;
  /** bklit TooltipBox `animate` (default true). `false` is its static path: the layout effect sets the measured position before the first paint. */
  readonly animate?: boolean;
  /** The anchor is the pointer (`tooltip.anchor: "pointer"`). bklit places the box from a React `MouseEvent`, whose clientX/clientY Chrome truncates to whole pixels (sankey-chart.tsx:171-176 `localPoint`),
   * while the renderer reads the fractional PointerEvent coordinates; the dropped fraction is taken off the anchor so the box lands on the same pixel. */
  readonly pointerAnchor?: boolean;
}

// gap #37 (docs/UPSTREAM-GAPS.md): `className`/`content`/`placement` are static options, so the first-anchor "settle" glide
// (bklit tooltip-box.tsx:94-135) is driven by toggling `data-bkm-settle` on the portal's own element and reading its style once.
const SETTLE_ATTR = "data-bkm-settle";

/** bklit TooltipBox `tooltipWidthRef` / `tooltipHeightRef` initial values. */
const BKLIT_INITIAL_SIZE: PanelSize = { width: 180, height: 80 };

const bklitTooltipPortal: ChartTooltipPortalExtension = {
  id: "bklit-tooltip-portal",
  create: ({ element }, initialOptions) => {
    // SAFETY: `use: bklitTooltipPortal` is only reachable through `bklitTooltipPlacement`, which supplies BklitPortalOptions.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
    let options = initialOptions as BklitPortalOptions;
    // bklit TooltipBox places the first render with the default size and picks the entrance side, then its layout effect retargets
    // the spring to the measured size (the glide); the side stays the first decision until the next pointer move.
    let showFlip: boolean | null = null;
    let anchorX = Number.NaN;
    let anchorY = Number.NaN;
    Object.assign(element.style, { bottom: "auto", margin: "0", position: "absolute", right: "auto", width: "max-content", zIndex: "1" });
    const panel = trackPanelSize(element);
    // Fraction of the last pointer position's client coordinates (the part a MouseEvent drops). A capture listener on the document runs before the renderer's own handler.
    const view = element.ownerDocument;
    let fractionX = 0;
    let fractionY = 0;
    const trackFraction = (event: PointerEvent): void => {
      fractionX = event.clientX - Math.trunc(event.clientX);
      fractionY = event.clientY - Math.trunc(event.clientY);
    };
    if (options.pointerAnchor === true) {
      view.addEventListener(hostPointerMove(view), trackFraction, true);
    }
    const place = (x: number, y: number, { width, height }: PanelSize, offset: number, scene: PanelSize): boolean => {
      const flipped = x + width + offset > scene.width;
      writePosition(
        element,
        flipped ? x - offset - width : x + offset,
        options.pinTop === true ? y + (options.topOffset ?? 0) : Math.max(offset, Math.min(y - height / 2, scene.height - (options.bottomInset ?? 0) - height - offset)),
      );
      return flipped;
    };
    return {
      destroy: () => {
        view.removeEventListener(hostPointerMove(view), trackFraction, true);
        panel.destroy();
      },
      hide: () => {
        showFlip = null;
        fractionX = 0;
        fractionY = 0;
        element.removeAttribute(SETTLE_ATTR);
      },
      position: ({ anchor: sceneAnchor, offset = 16, scene }) => {
        const measured = panel.size();
        const anchor = options.pointerAnchor === true ? { x: sceneAnchor.x - fractionX, y: sceneAnchor.y - fractionY } : sceneAnchor;
        const sameAnchor = anchor.x === anchorX && anchor.y === anchorY;
        anchorX = anchor.x;
        anchorY = anchor.y;
        if (options.animate === false) {
          // Static path: the layout effect's setState re-renders before paint, so position and side both use the measured size.
          showFlip = place(anchor.x, anchor.y, measured, offset, scene);
        } else if (showFlip === null) {
          // First paint of the show: the render's default-size placement, then the layout effect's measured retarget (the glide).
          element.removeAttribute(SETTLE_ATTR);
          showFlip = place(anchor.x, anchor.y, BKLIT_INITIAL_SIZE, offset, scene);
          // gap #37: no documented per-show state hook on the tooltip element. The forced style read commits the default-size
          // placement as the transition's start value before `data-bkm-settle` (styles.css, 900ms spring) and the measured placement land.
          getComputedStyle(element).getPropertyValue("left");
          element.setAttribute(SETTLE_ATTR, "");
          place(anchor.x, anchor.y, measured, offset, scene);
        } else if (sameAnchor) {
          // Re-measure at the same anchor (the body rendering, the ResizeObserver): the layout effect retargets the spring again.
          place(anchor.x, anchor.y, measured, offset, scene);
        } else {
          // A pointer move renders with the measured sizes; the native tooltip motion glides between anchors.
          element.removeAttribute(SETTLE_ATTR);
          showFlip = place(anchor.x, anchor.y, measured, offset, scene);
        }
        writePlacementSide(element, showFlip ? "left" : "right");
        return true;
      },
      update: (next) => {
        options = next;
      },
    };
  },
};

/** `tooltip.portal` value: bklit's container-relative flip and clamp instead of the native 8px-edge resolver. */
const bklitTooltipPlacement = (options: BklitPortalOptions = {}): ChartTooltipPortalInput => ({ ...options, use: bklitTooltipPortal });

export { bklitTooltipPlacement };
