import { tooltip } from "@tanstack/charts/tooltip";
import type { ChartTooltipExtension } from "@tanstack/charts/tooltip";
import { SNAPPY_HOVER_MS } from "../motion/springs";

/** The stock tooltip as a `ChartTooltipExtension` (reference/types.md:352-355) whose `hide()` is instant: bklit's TooltipBox unmounts when data clears (tooltip-box.tsx:64-66) and replays its enter on the next show (:209-227),
 * while 1.0 runs one `motion` for glide and exit (motion.ts:603-630, `resumingExit` :523-548). `hide()` calls `update` once with `motion: false` (:363-366, 604-611) and restores. Module-level. Gap #19. */
export const bklitTooltip: ChartTooltipExtension = /* @__PURE__ */ ((): ChartTooltipExtension => ({
  ...tooltip,
  id: "bklit-tooltip",
  create(context) {
    const instance = tooltip.create(context);
    let options: Parameters<typeof instance.update>[0] | null = null;
    let hiding = false;
    return {
      ...instance,
      update(next) {
        options = next;
        instance.update(next);
      },
      paint(paintContext) {
        hiding = false;
        instance.paint(paintContext);
      },
      hide() {
        if (hiding) {
          return;
        }
        hiding = true;
        if (options) {
          instance.update({ ...options, motion: false });
          instance.hide();
          instance.update(options);
          return;
        }
        instance.hide();
      },
    };
  },
}))();

/** Set on the tooltip while it fades out (styles.css `bkm-tt-leave`, over the hover profile). */
const LEAVING_ATTR = "data-bkm-leaving";

/**
 * bklit's TooltipBox with `exit` (its default since the fade-out for every chart tooltip, tooltip-box.tsx:564, 779: `exit={{ opacity: 0 }}`
 * over 0.1s): a hide fades the panel out (`data-bkm-leaving`, over the hover profile) with its content, then hides it as `bklitTooltip`
 * does; a show while it fades takes it back. `bklitTooltip` is the `exit={false}` one. Module-level.
 */
export const bklitTooltipExit: ChartTooltipExtension = /* @__PURE__ */ ((): ChartTooltipExtension => ({
  ...tooltip,
  id: "bklit-tooltip-exit",
  create(context) {
    const instance = bklitTooltip.create(context);
    let leaving: { readonly element: HTMLElement; readonly timer: ReturnType<typeof setTimeout> } | null = null;
    const stop = (): void => {
      if (leaving !== null) {
        clearTimeout(leaving.timer);
        leaving.element.removeAttribute(LEAVING_ATTR);
        leaving = null;
      }
    };
    return {
      ...instance,
      paint(paintContext) {
        stop();
        instance.paint(paintContext);
      },
      hide() {
        if (leaving !== null) {
          return;
        }
        const element = context.container.querySelector<HTMLElement>(":scope > .ts-chart-tooltip");
        if (element === null || element.hidden) {
          instance.hide();
          return;
        }
        element.setAttribute(LEAVING_ATTR, "");
        leaving = {
          element,
          timer: setTimeout(() => {
            stop();
            instance.hide();
          }, SNAPPY_HOVER_MS),
        };
      },
      destroy() {
        stop();
        instance.destroy();
      },
    };
  },
}))();
