import { FEATURES_ID } from "./projection";
import type { HoverStore } from "../types/choropleth";
import type { RenderedChart } from "./feature-hover";

interface WheelClearDeps {
  readonly hoverStore: HoverStore;
  /** The latest rendered chart's interaction controller (read in the frame after the tick). */
  readonly interaction: () => RenderedChart["interaction"] | undefined;
  readonly isHeld: () => boolean;
}

interface WheelFocusClear {
  /** The zoom layer's wheel tick (core/choropleth/zoom.ts `onWheelZoom`). */
  readonly onWheelZoom: (clientX: number, clientY: number) => void;
  /** The hover it clears; a tick before `bind` does nothing. */
  readonly bind: (deps: WheelClearDeps) => void;
  /** Cancels a pending frame. */
  readonly dispose: () => void;
}

/** Wheel zoom moves the map under a resting pointer: bklit's mouseenter/leave hover stays while the path is still under it and clears once it slid away; the new path gets none.
 * After the transform paints, the pointer is hit-tested via the renderer's focus strategy: same feature keeps focus, else clears; keyboard-held focus stays. */
export function createWheelFocusClear(): WheelFocusClear {
  let deps: WheelClearDeps | undefined = undefined;
  let frame = 0;
  return {
    bind: (next) => { deps = next; },
    dispose: () => { cancelAnimationFrame(frame); },
    onWheelZoom: (clientX, clientY) => {
      if (deps === undefined) {return;}
      const { hoverStore, interaction: interactionOf, isHeld } = deps;
      if (hoverStore.hovered === null || isHeld()) {return;}
      cancelAnimationFrame(frame);
      // One frame, so the transform has painted: bklit has no timer here, its path's onMouseLeave (choropleth-feature.tsx:90-91, :114-115,
      // :201-202) fires from the browser's own post-layout hit test once the zoom (choropleth-chart.tsx:435-447) slid the path from under the pointer.
      frame = requestAnimationFrame(() => {
        const interaction = interactionOf();
        if (interaction === undefined || hoverStore.hovered === null) {return;}
        const under = interaction.resolvePointer(clientX, clientY);
        if (under?.point.markId === FEATURES_ID && under.point.datumIndex === hoverStore.hovered) {return;}
        interaction.setControlledFocus(null, { source: "pointer" });
      });
    },
  };
}
