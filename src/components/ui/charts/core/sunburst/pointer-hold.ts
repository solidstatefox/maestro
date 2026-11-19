import type { ChartInteractionController } from "@tanstack/charts";
import { hostPointerMove } from "../interaction/host-pointer";

export interface SunburstPointerHold {
  /** True while a pointer move is being dispatched: the strategy holds the hover off sectors only then (a click on the hub must still resolve it). */
  readonly moving: () => boolean;
  /** Installs the listeners on the chart's host and on its stage (the chart stage inside the host: only clicks on it are guarded, so the breadcrumb's
   * and the hint's own buttons keep their clicks). Returns their removal; re-attachable. */
  readonly attach: (host: HTMLElement, stage: HTMLElement) => () => void;
}

// bklit's only click handlers are a branch sector's zoom and the hub's zoom-out. The click guard is a capture listener on the stage, ahead of the
// renderer's; on the host it also swallowed clicks on SunburstBreadcrumb and SunburstHint content, which resolve to no sector.
// The move flag lets the focus strategy tell a move from a click (gap #46) without stopping the event.
/** `interaction` (the mounted chart's controller) and `zoomable` (whether a click on a datum zooms) are read at event time. */
export const createPointerHold = <TDatum>(
  interaction: () => ChartInteractionController<TDatum, number, number> | null,
  zoomable: (datum: TDatum) => boolean,
): SunburstPointerHold => {
  let moving = false;
  const attach = (host: HTMLElement, stage: HTMLElement): (() => void) => {
    // A click on a leaf or the gaps does nothing in bklit. The native select would still re-render the chart (a no-op motion cycle),
    // so such clicks never reach the renderer.
    const clickOnlyZoom = (event: MouseEvent): void => {
      moving = false;
      const datum = interaction()?.resolvePointer(event.clientX, event.clientY)?.point.datum;
      if (datum === undefined || ! zoomable(datum)) {
        event.stopPropagation();
      }
    };
    // Cleared by a task after the dispatch, so the renderer's re-resolve after a render never sees it.
    const markMoving = (): void => {
      moving = true;
      setTimeout(() => { moving = false; }, 0);
    };
    host.addEventListener(hostPointerMove(host), markMoving, true);
    stage.addEventListener("click", clickOnlyZoom, true);
    return (): void => {
      host.removeEventListener(hostPointerMove(host), markMoving, true);
      stage.removeEventListener("click", clickOnlyZoom, true);
    };
  };
  return { attach, moving: () => moving };
};
