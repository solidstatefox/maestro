import { writable } from "../store";
import type { Readable } from "../store";

/** Observes `el`; `onEntry` gets the latest entry of each delivery. Returns the disconnect. */
export const observeResize = (el: Element, onEntry: (entry: ResizeObserverEntry | undefined) => void): (() => void) => {
  const observer = new ResizeObserver((entries) => { onEntry(entries.at(-1)); });
  observer.observe(el);
  return (): void => { observer.disconnect(); };
};

// bklit mounts pie, ring, heatmap and live-line under `<ParentSize>` (leading first call, no debounce on it): e.g. heatmap/heatmap-chart.tsx:685.
/** First ResizeObserver delivery for `host`, then one frame, then `onSize(width, height)`. Returns the cleanup. */
export const observeParentSize = (host: HTMLElement, onSize: (width: number, height: number) => void): (() => void) => {
  let frame = 0;
  const observer = new ResizeObserver((entries) => {
    const rect = entries.at(-1)?.contentRect;
    const width = rect?.width ?? 0;
    const height = rect?.height ?? 0;
    observer.disconnect();
    // The frame hop of visx ParentSize: its ResizeObserver callback commits through rAF (useParentSize.js:44-58).
    frame = requestAnimationFrame(() => { onSize(width, height); });
  });
  observer.observe(host);
  return () => { cancelAnimationFrame(frame); observer.disconnect(); };
};

/** Runs `run` after `frames` animation frames. Returns the cancel. */
export const afterFrames = (frames: number, run: () => void): (() => void) => {
  let id = 0;
  // One rAF per hop of the mount chain bklit's ParentSize makes (useParentSize.js:44-58); no tuned ms value.
  const step = (left: number): void => { id = requestAnimationFrame(() => { if (left > 1) { step(left - 1); } else { run(); } }); };
  step(frames);
  return () => { cancelAnimationFrame(id); };
};

export interface ResizeBox {
  readonly width: number;
  readonly height: number;
  /** False until a delivery changes the box: a first delivery of the size already rendered commits nothing. */
  readonly observed: boolean;
}

/** An element's box, rounded to whole pixels, `initial` until the first change (bklit's react-use-measure first hop). The value is replaced only when the box changes. */
export interface ResizeBoxStore extends Readable<ResizeBox> {
  /** Reads `el`'s box now (before first paint, where an owner opts in). */
  readonly measure: (el: Element) => void;
  /** Follows `el`'s content box; returns the disconnect. */
  readonly observe: (el: Element) => () => void;
}

export const createResizeBox = (initial?: { readonly width: number; readonly height: number }): ResizeBoxStore => {
  const box = writable<ResizeBox>({ width: initial?.width ?? 0, height: initial?.height ?? 0, observed: false });
  const apply = (width: number, height: number): void => {
    const prev = box.get();
    if (prev.width !== width || prev.height !== height) { box.set({ width, height, observed: true }); }
  };
  return {
    get: box.get,
    subscribe: box.subscribe,
    measure: (el) => {
      const rect = el.getBoundingClientRect();
      apply(Math.round(rect.width), Math.round(rect.height));
    },
    observe: (el) => observeResize(el, (entry) => { apply(Math.round(entry?.contentRect.width ?? 0), Math.round(entry?.contentRect.height ?? 0)); }),
  };
};
