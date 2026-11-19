import { clearAttribute, clearVar, raiseAttribute, writeVar } from "../host-write";
import { hostPointerMove } from "../interaction/host-pointer";
import type { ChartZoomProps } from "../types/link";

/** A window in ms. */
export type Span = readonly [number, number];

/** Where the plot sits in the surface (svg px, 1:1 with CSS px). */
export interface ZoomGeometry {
  readonly left: number;
  readonly top: number;
  readonly innerWidth: number;
  readonly innerHeight: number;
}

export interface ZoomGestureOptions {
  /** The latest draw's plot, or null before the first one. */
  geom(): ZoomGeometry | null;
  /** The surface element (the plot's client rect). */
  surface(): HTMLElement | null;
  /** The full time range the window moves in, or null without data. */
  extent(): Span | null;
  /** The accepted window (the extent when unzoomed). */
  shown(): Span | null;
  /** The ChartZoom's latest props. */
  props(): ChartZoomProps;
  /** A live window: draw it as a transform. */
  preview(window: Span): void;
  /** A settled window (null: the full range), or the gesture cancelled back to `shown()` (`cancel`). */
  commit(window: Span | null, cancel?: boolean): void;
}

export interface ZoomGestures {
  attach(host: HTMLElement): () => void;
}

const WHEEL_IDLE_MS = 160;
const DRAG_SLOP = 3;
const KEY_STEP = 1.5;
const DEFAULT_MAX_ZOOM = 24;
const PANNING = "data-bkm-panning";

const clampSpan = (extent: Span, start: number, end: number, maxZoom: number): Span => {
  const full = extent[1] - extent[0];
  const span = Math.min(full, Math.max(full / Math.max(1, maxZoom), end - start));
  const lo = Math.min(Math.max(extent[0], start), extent[1] - span);
  return [lo, lo + span];
};

/** `window` zoomed by `factor` (< 1 zooms in) around the fraction `at` of its width, clamped into `extent`. */
export function zoomAround(window: Span, extent: Span, factor: number, at: number, maxZoom = DEFAULT_MAX_ZOOM): Span {
  const span = window[1] - window[0];
  const anchor = window[0] + at * span;
  const next = span * factor;
  return clampSpan(extent, anchor - at * next, anchor - at * next + next, maxZoom);
}

/** `window` moved by `by` ms, clamped into `extent`. */
export function panBy(window: Span, extent: Span, by: number, maxZoom = DEFAULT_MAX_ZOOM): Span {
  return clampSpan(extent, window[0] + by, window[1] + by, maxZoom);
}

const sameSpan = (a: Span | null, b: Span | null): boolean => a === b || (a !== null && b !== null && a[0] === b[0] && a[1] === b[1]);

/** Whether `window` is the whole of `extent` (a reset). */
export const isFull = (window: Span, extent: Span): boolean => window[0] <= extent[0] && window[1] >= extent[1];

/** The wheel's zoom factor for one event: d3-zoom's default delta, gentler (a mouse notch zooms ~1.3x, a pinch follows the fingers). */
const wheelFactor = (event: WheelEvent): number => {
  const unit = event.deltaMode === 1 ? 33 : event.deltaMode === 2 ? 400 : 1;
  return 2 ** (Math.max(-240, Math.min(240, event.deltaY * unit)) * 0.004);
};

export function createZoomGestures(options: ZoomGestureOptions): ZoomGestures {
  return {
    attach(host) {
      let live: Span | null = null;
      let wheelTimer: ReturnType<typeof setTimeout> | undefined;
      const pointers = new Map<number, number>();
      let drag: { readonly id: number; readonly x0: number; readonly from: Span; active: boolean } | null = null;
      let pinch: { readonly d0: number; readonly from: Span; readonly at: number } | null = null;
      let swallowClick = false;

      const plotOf = (clientX: number, clientY: number): { readonly fx: number; readonly inside: boolean; readonly width: number } | null => {
        const g = options.geom();
        const el = options.surface();
        if (!g || !el || g.innerWidth <= 0) {
          return null;
        }
        const rect = el.getBoundingClientRect();
        const x = clientX - rect.left - g.left;
        const y = clientY - rect.top - g.top;
        return { fx: Math.max(0, Math.min(1, x / g.innerWidth)), inside: x >= 0 && x <= g.innerWidth && y >= 0 && y <= g.innerHeight, width: g.innerWidth };
      };
      const maxZoom = (): number => options.props().maxZoom ?? DEFAULT_MAX_ZOOM;
      const base = (): Span | null => live ?? options.shown() ?? options.extent();
      const show = (next: Span): void => {
        if (sameSpan(next, live)) {
          return;
        }
        live = next;
        options.preview(next);
      };
      const settle = (): void => {
        const extent = options.extent();
        const next = live;
        live = null;
        if (wheelTimer !== undefined) {
          clearTimeout(wheelTimer);
          wheelTimer = undefined;
        }
        if (!next || !extent) {
          return;
        }
        options.commit(isFull(next, extent) ? null : next);
      };
      const cancel = (): void => {
        live = null;
        options.commit(options.shown(), true);
      };

      const onWheel = (event: WheelEvent): void => {
        const mode = options.props().wheel ?? "modifier";
        const extent = options.extent();
        const from = base();
        const at = plotOf(event.clientX, event.clientY);
        if (mode === "none" || !extent || !from || !at?.inside) {
          return;
        }
        const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
        if (!horizontal && !(mode === "always" || event.ctrlKey || event.metaKey)) {
          return;
        }
        event.preventDefault();
        const span = from[1] - from[0];
        show(horizontal ? panBy(from, extent, (event.deltaX / at.width) * span, maxZoom()) : zoomAround(from, extent, wheelFactor(event), at.fx, maxZoom()));
        if (wheelTimer !== undefined) {
          clearTimeout(wheelTimer);
        }
        wheelTimer = setTimeout(settle, WHEEL_IDLE_MS);
      };

      const onPointerDown = (event: PointerEvent): void => {
        if (event.button !== 0) {
          return;
        }
        const at = plotOf(event.clientX, event.clientY);
        const from = base();
        if (!at?.inside || !from) {
          return;
        }
        pointers.set(event.pointerId, event.clientX);
        if (pointers.size === 2 && event.pointerType === "touch") {
          // A second finger turns the drag into a pinch around the fingers' midpoint.
          const [a, b] = [...pointers.values()];
          const mid = plotOf((a + b) / 2, event.clientY);
          drag = null;
          pinch = { d0: Math.max(1, Math.abs(a - b)), from, at: mid?.fx ?? 0.5 };
          raiseAttribute(host, PANNING);
          return;
        }
        drag = { id: event.pointerId, x0: event.clientX, from, active: false };
      };
      const onPointerMove = (event: PointerEvent): void => {
        if (pointers.has(event.pointerId)) {
          pointers.set(event.pointerId, event.clientX);
        }
        const extent = options.extent();
        if (pinch && extent && pointers.size === 2) {
          event.stopPropagation();
          const [a, b] = [...pointers.values()];
          show(zoomAround(pinch.from, extent, pinch.d0 / Math.max(1, Math.abs(a - b)), pinch.at, maxZoom()));
          return;
        }
        if (!drag || drag.id !== event.pointerId || !extent) {
          return;
        }
        const dx = event.clientX - drag.x0;
        if (!drag.active) {
          if (Math.abs(dx) < DRAG_SLOP) {
            return;
          }
          drag.active = true;
          raiseAttribute(host, PANNING);
          host.setPointerCapture?.(event.pointerId);
        }
        // The chart's own hover stays where it was: the drawn scene no longer matches the pointer until the window settles.
        event.stopPropagation();
        const g = options.geom();
        const span = drag.from[1] - drag.from[0];
        show(panBy(drag.from, extent, (-dx / Math.max(1, g?.innerWidth ?? 1)) * span, maxZoom()));
      };
      const endPointer = (event: PointerEvent): void => {
        pointers.delete(event.pointerId);
        if (pinch) {
          if (pointers.size < 2) {
            pinch = null;
            clearAttribute(host, PANNING);
            swallowClick = true;
            settle();
          }
          return;
        }
        if (!drag || drag.id !== event.pointerId) {
          return;
        }
        const wasActive = drag.active;
        drag = null;
        if (!wasActive) {
          return;
        }
        clearAttribute(host, PANNING);
        host.releasePointerCapture?.(event.pointerId);
        swallowClick = true;
        if (event.type === "pointercancel") {
          cancel();
        } else {
          settle();
        }
      };
      // The click that ends a pan is not a click on a point (no pin, no selection).
      const onClick = (event: MouseEvent): void => {
        if (swallowClick) {
          swallowClick = false;
          event.stopPropagation();
          event.preventDefault();
        }
      };
      const onDoubleClick = (event: MouseEvent): void => {
        const extent = options.extent();
        if (!extent || !plotOf(event.clientX, event.clientY)?.inside) {
          return;
        }
        live = null;
        options.commit(null);
      };
      const onKeyDown = (event: KeyboardEvent): void => {
        const extent = options.extent();
        const from = base();
        if (!extent || !from || event.altKey || event.ctrlKey || event.metaKey) {
          return;
        }
        if (event.key === "Escape" && (drag?.active === true || pinch)) {
          drag = null;
          pinch = null;
          clearAttribute(host, PANNING);
          cancel();
          return;
        }
        const step = event.key === "+" || event.key === "=" ? 1 / KEY_STEP : event.key === "-" || event.key === "_" ? KEY_STEP : event.key === "0" ? 0 : null;
        if (step === null) {
          return;
        }
        event.preventDefault();
        live = step === 0 ? extent : zoomAround(from, extent, step, 0.5, maxZoom());
        settle();
      };

      host.addEventListener("wheel", onWheel, { passive: false });
      host.addEventListener("pointerdown", onPointerDown, true);
      // The pan swallows the host's own move stream (raw samples where the browser has them), so the hover holds while it pans.
      const moveEvent = hostPointerMove(host);
      host.addEventListener(moveEvent, onPointerMove, true);
      host.addEventListener("pointerup", endPointer, true);
      host.addEventListener("pointercancel", endPointer, true);
      host.addEventListener("click", onClick, true);
      host.addEventListener("dblclick", onDoubleClick);
      host.addEventListener("keydown", onKeyDown);
      return (): void => {
        if (wheelTimer !== undefined) {
          clearTimeout(wheelTimer);
        }
        clearAttribute(host, PANNING);
        host.removeEventListener("wheel", onWheel);
        host.removeEventListener("pointerdown", onPointerDown, true);
        host.removeEventListener(moveEvent, onPointerMove, true);
        host.removeEventListener("pointerup", endPointer, true);
        host.removeEventListener("pointercancel", endPointer, true);
        host.removeEventListener("click", onClick, true);
        host.removeEventListener("dblclick", onDoubleClick);
        host.removeEventListener("keydown", onKeyDown);
      };
    },
  };
}

const PREVIEW = "data-bkm-zoompv";
const LABELS = 'text[data-ts-key^="x-tick-label"]';

/**
 * Draws `window` over a scene drawn for `drawn` (ms) as one transform: a drawn x maps to `k * x + t` (styles.css moves the series paths by
 * `--bkm-zk` / `--bkm-zx`; their strokes don't scale, `vector-effect`), the x tick labels slide to where their dates fall and fade off the
 * plot, and the hover chrome hides. `window` null clears it (after the redraw that draws the committed window).
 */
export function writeZoomPreview(host: HTMLElement, surface: HTMLElement | null, geom: ZoomGeometry, drawn: Span, window: Span | null): void {
  const labels = surface ? surface.querySelectorAll<SVGTextElement>(LABELS) : [];
  if (window === null) {
    if (!host.hasAttribute(PREVIEW)) {
      return;
    }
    clearAttribute(host, PREVIEW);
    clearVar(host, "--bkm-zk");
    clearVar(host, "--bkm-zx");
    for (const label of labels) {
      label.style.removeProperty("transform");
      label.style.removeProperty("opacity");
    }
    return;
  }
  const span = window[1] - window[0];
  const drawnSpan = drawn[1] - drawn[0];
  if (span <= 0 || drawnSpan <= 0) {
    return;
  }
  const k = drawnSpan / span;
  const t = geom.left * (1 - k) + (geom.innerWidth * (drawn[0] - window[0])) / span;
  writeVar(host, "--bkm-zk", k.toFixed(5));
  writeVar(host, "--bkm-zx", `${t.toFixed(2)}px`);
  raiseAttribute(host, PREVIEW);
  const lo = geom.left - 8;
  const hi = geom.left + geom.innerWidth + 8;
  for (const label of labels) {
    const x = Number(label.getAttribute("x"));
    const to = k * x + t;
    label.style.transform = `translateX(${(to - x).toFixed(2)}px)`;
    label.style.opacity = to < lo || to > hi ? "0" : "";
  }
}
