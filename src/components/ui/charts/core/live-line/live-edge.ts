import { drawnValueAt } from "./definition";
import type { GlideView } from "./live-glide";
import type { RowLayout } from "./live-frame";
import { clearAttribute, clearVar, raiseAttribute, writeVar } from "../host-write";

/** The cells the edge hold reads at each call and frame: the host it writes, the held row, the view, the row layout and the plot's left edge. */
export interface EdgeHoldSource {
  readonly host: { readonly current: HTMLElement | null };
  readonly focus: { readonly current: { readonly row: number | null } };
  readonly view: { readonly current: GlideView };
  readonly layout: { readonly current: RowLayout };
  readonly bounds: { readonly current: { readonly left: number } };
}

export interface EdgeHold {
  /** Lays the held row's marker out for this tick (and steps it per frame through a jump's slide). */
  readonly holdEdge: () => void;
  /** Cancels the step and clears the marker's host writes. */
  readonly stopEdge: () => void;
  /** Whether the held guide sits at the edge (see below). */
  readonly edgeAt: { current: boolean };
}

  // Gap: no native clock for the slide (UPSTREAM-GAPS #43), so the held marker's offset is stepped per frame from the slide's --bkm-fxr (gap #45: identity dedupe).
  // A keyboard-held row at the edge on a jump tick: the guide stays at max(edge, row's slid x) (live-line-chart.tsx:229-269); --bkm-kex / --bkm-key carry the marker (liveline.css).
export function createEdgeHold({ host: hostRef, focus: focusRef, view: glideFrameRef, layout: layoutRef, bounds: boundsRef }: EdgeHoldSource): EdgeHold {
  let edge = 0;
  const stopEdge = (): void => {
    const el = hostRef.current;
    cancelAnimationFrame(edge);
    edge = 0;
    clearAttribute(el, "data-bkm-kedge");
    clearVar(el, "--bkm-kex");
    clearVar(el, "--bkm-key");
  };
  // Whether the held guide sits at the edge: core re-reports the held point each tick as the row then at or left of the edge (liveFocus `group`),
  // which says nothing about where the guide was; it stays there until an arrow takes it back inside (rows only move left).
  const edgeAt = { current: false };
  const holdEdge = (): void => {
    const keep = edgeAt.current;
    stopEdge();
    const el = hostRef.current;
    const held = focusRef.current.row;
    const { frame, top, height } = glideFrameRef.current;
    if (!el || !frame || frame.seed || held === null) {
      edgeAt.current = false;
      return;
    }
    const g = layoutRef.current;
    const pl = boundsRef.current.left;
    const kx = g.left + (held - g.x0) * g.pxPerMs;
    if (!frame.jump || !el.hasAttribute("data-bkm-jump")) {
      // A rolling tick: the renderer carries the row and pins it (group); it ends this tick at the edge if its rest is left of it.
      edgeAt.current = kx < pl;
      return;
    }
    const pinned = keep && kx < pl;
    if (!pinned && kx >= pl) {
      edgeAt.current = false;
      return;
    }
    const [y0, y1] = frame.yDomain;
    const yAt = (x: number): number => top + ((y1 - drawnValueAt(frame.rows, g.x0 + (x - g.left) / (g.pxPerMs || 1))) * height) / (y1 - y0 || 1);
    const at = yAt(pl);
    const write = (): number => {
      const fxr = Number.parseFloat(getComputedStyle(el).getPropertyValue("--bkm-fxr")) || 0;
      const xv = pinned ? pl : Math.max(pl, kx + fxr);
      edgeAt.current = xv <= pl;
      writeVar(el, "--bkm-kex", (xv - pl).toFixed(2));
      writeVar(el, "--bkm-key", (yAt(xv - fxr) - at).toFixed(2));
      return fxr;
    };
    raiseAttribute(el, "data-bkm-kedge");
    write();
    const step = (): void => {
      if (write() === 0) {
        edge = 0;
        return;
      }
      // Same per-frame step (UPSTREAM-GAPS #43).
      edge = requestAnimationFrame(step);
    };
    // Steps the held marker per frame from the slide clock (UPSTREAM-GAPS #43; bklit rides the cursor, live-line-chart.tsx:229-269).
    edge = requestAnimationFrame(step);
  };
  return { holdEdge, stopEdge, edgeAt };
}
