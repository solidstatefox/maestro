import type { ChartBrushSelection, ChartBrushTrackOverlayProps } from "../types/brush";
import type { Margin } from "../types/context";
import { isNumber } from "../guards";
import { px } from "../style";
import type { StyleObject } from "../style";

// Kept apart from kit toDate: other inputs (null, objects) go through String(), so they parse to NaN instead of epoch 0.
const toTime = (value: unknown): number => {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (isNumber(value)) {
    return value;
  }
  return new Date(String(value)).getTime();
};

/** Full data extent, optionally stretched to `xExtentMax`; null when no row has a finite x. */
export const brushExtent = (data: readonly Record<string, unknown>[], xDataKey: string, xExtentMax?: Date): [Date, Date] | null => {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const row of data) {
    const time = toTime(row[xDataKey]);
    if (Number.isFinite(time)) {
      min = Math.min(min, time);
      max = Math.max(max, time);
    }
  }
  if (min === Number.POSITIVE_INFINITY) {
    return null;
  }
  const end = xExtentMax && xExtentMax.getTime() > max ? xExtentMax.getTime() : max;
  return [new Date(min), new Date(end)];
};

// No selection (null) shows the full extent: it is the state until the strip reports a range and after a dataset swap, so a strip given
// `layout.brushSelection ?? window` starts at `window` (bklit's docs, brush.md "Start with a window"). A collapsed drag (null) resets to the full extent.

/** The selection a reported range sets: the range, or for a collapsed one (null) the full extent; null (keep the selection) without one. */
export const brushSelectionTarget = (next: ChartBrushSelection | null, fullExtent: [Date, Date] | null): ChartBrushSelection | null =>
  next ?? (fullExtent ? { end: fullExtent[1], start: fullExtent[0] } : null);

/** The main chart's x domain: the selection, else the full extent; `undefined` (everything) while the brush is off. */
export const brushXDomain = (enabled: boolean, selection: ChartBrushSelection | null, fullExtent: [Date, Date] | null): [Date, Date] | undefined => {
  if (!enabled) {
    return undefined;
  }
  return selection ? [selection.start, selection.end] : (fullExtent ?? undefined);
};

/** The overlays' layer over the chart: what they draw takes no pointer. */
export const BRUSH_OVERLAY_LAYER: StyleObject = { position: "absolute", inset: 0, "z-index": 1, "pointer-events": "none" };

/** The brushed window in plot pixels, ordered and clamped to `[0, innerWidth]`. */
export const brushWindow = (innerWidth: number, selectionX0: number, selectionX1: number): { readonly x0: number; readonly x1: number } => {
  const x0 = Math.max(0, Math.min(selectionX0, selectionX1, innerWidth));
  const x1 = Math.max(x0, Math.min(Math.max(selectionX0, selectionX1), innerWidth));
  return { x0, x1 };
};

// bklit chart-brush-track-overlay.tsx: outer panes fade over the first 15%.
const TRACK_OUTER_FADE = "15%";

const outsidePaneStyle = (edge: "left" | "right", blurPx: number, fadeOuterEdges: boolean): StyleObject => {
  const fadeTo = edge === "left" ? "right" : "left";
  const mask = fadeOuterEdges ? `linear-gradient(to ${fadeTo}, transparent 0%, black ${TRACK_OUTER_FADE}, black 100%)` : undefined;
  const blur = blurPx > 0 ? `blur(${blurPx}px)` : undefined;
  return {
    position: "absolute",
    "pointer-events": "none",
    ...(blur === undefined ? {} : { "backdrop-filter": blur, "-webkit-backdrop-filter": blur }),
    ...(mask === undefined ? {} : { "mask-image": mask, "-webkit-mask-image": mask }),
  };
};

/** The track overlay's panes outside the window (each `null` when it has no width); null when neither has one. */
export const brushTrackPanes = (
  { innerWidth, innerHeight, selectionX0, selectionX1, blurPx = 1.5, fadeOuterEdges = true }: Readonly<ChartBrushTrackOverlayProps>,
  margin: Readonly<Margin>,
): { readonly left: StyleObject | null; readonly right: StyleObject | null } | null => {
  const { x0, x1 } = brushWindow(innerWidth, selectionX0, selectionX1);
  const rightWidth = Math.max(0, innerWidth - x1);
  if (x0 <= 0 && rightWidth <= 0) {
    return null;
  }
  const blur = Math.min(5, Math.max(0, blurPx));
  return {
    left: x0 > 0 ? { ...outsidePaneStyle("left", blur, fadeOuterEdges), top: px(margin.top), left: px(margin.left), width: px(x0), height: px(innerHeight) } : null,
    right:
      rightWidth > 0
        ? { ...outsidePaneStyle("right", blur, fadeOuterEdges), top: px(margin.top), left: px(margin.left + x1), width: px(rightWidth), height: px(innerHeight) }
        : null,
  };
};
