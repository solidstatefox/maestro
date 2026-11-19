import { observeParentSize, observeResize } from "./resize";
import { writable } from "../store";
import type { Readable } from "../store";

/** Width the pie and ring charts assume until the first measure. */
export const INITIAL_WIDTH_PX = 320;

export interface FluidWidth {
  readonly width: number;
  readonly ready: boolean;
  /** The host's height, kept only while the owner's `height` option says so (a heatmap with `layout="fill"`); 0 otherwise. */
  readonly height: number;
}

export interface FluidWidthOptions {
  /** Whether the host's height is followed too, read at each delivery (a heatmap's `layout="fill"` fits its cells in it). */
  readonly height?: () => boolean;
}

/** A fluid chart's width: `initialWidth` until the first measure; `ready` from the start when nothing is measured (fixed-size charts). */
export interface FluidWidthStore extends Readable<FluidWidth> {
  /** The first width, on ParentSize's chain: the first ResizeObserver delivery, then one frame (@visx/responsive useParentSize.js:44-58; debounce 10 ms, `leading: true`);
   * then `ready`. Returns the cancel. */
  readonly measure: (host: HTMLElement) => () => void;
  /** Once ready: follows `host`'s own observer, applying changes larger than `epsilon` px. Returns the disconnect. */
  readonly follow: (host: HTMLElement, epsilon: number) => () => void;
}

export const createFluidWidth = (initialWidth: number, ready: boolean, options: FluidWidthOptions = {}): FluidWidthStore => {
  const state = writable<FluidWidth>({ width: initialWidth, ready, height: 0 });
  const tracksHeight = (): boolean => options.height?.() === true;
  return {
    get: state.get,
    subscribe: state.subscribe,
    measure: (host) => observeParentSize(host, (measured, measuredHeight) => {
      state.set({ width: measured > 0 ? measured : state.get().width, ready: true, height: tracksHeight() ? measuredHeight : 0 });
    }),
    follow: (host, epsilon) => {
      if (typeof ResizeObserver === "undefined") { return () => undefined; }
      return observeResize(host, (entry) => {
        const next = entry?.contentRect.width ?? 0;
        const nextHeight = tracksHeight() ? entry?.contentRect.height ?? 0 : 0;
        const current = state.get();
        const widthMoved = Number.isFinite(next) && next > 0 && Math.abs(current.width - next) > epsilon;
        const heightMoved = Number.isFinite(nextHeight) && Math.abs(current.height - nextHeight) > epsilon;
        if (widthMoved || heightMoved) { state.set({ width: widthMoved ? next : current.width, ready: current.ready, height: nextHeight }); }
      });
    },
  };
};
