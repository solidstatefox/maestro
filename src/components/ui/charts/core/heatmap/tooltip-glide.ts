import type { HeatmapTooltipGlideCurve } from "./tooltip";

/** The renderer's tooltip element, a child of the surface (controller.ts reads it the same way). */
const TOOLTIP_SELECTOR = ":scope > .ts-chart-tooltip";
/** A move shorter than this (px) on both axes is not animated (motion.js: 0.5). */
const MIN_TRAVEL_PX = 0.5;
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

export interface HeatmapTooltipGlide {
  /** The surface whose tooltip glides; null lets it go (a detach, a replaced surface). */
  surface(el: HTMLElement | null): void;
  /** The glide's curve from the latest pass; null snaps. */
  curve(next: HeatmapTooltipGlideCurve | null): void;
}

const pxOf = (value: string): number | undefined => {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : undefined;
};

/** Where a running glide has the panel now: its computed `translate` ("12px 4px", "12px", "none"). */
const translateOf = (el: HTMLElement): { readonly x: number; readonly y: number } => {
  const value = (el.ownerDocument.defaultView ?? globalThis).getComputedStyle(el).translate;
  if (value === "none" || value === "") {
    return { x: 0, y: 0 };
  }
  const [x = "0", y = "0"] = value.split(/\s+/);
  return { x: pxOf(x) ?? 0, y: pxOf(y) ?? 0 };
};

export function createHeatmapTooltipGlide(): HeatmapTooltipGlide {
  let surfaceEl: HTMLElement | null = null;
  let tooltip: HTMLElement | null = null;
  let observer: MutationObserver | null = null;
  let glide: HeatmapTooltipGlideCurve | null = null;
  let animation: Animation | null = null;
  // The tooltip's last placement while shown (undefined while hidden: the next show places it at once).
  let left: number | undefined;
  let top: number | undefined;

  const stop = (): void => {
    animation?.cancel();
    animation = null;
  };
  const place = (el: HTMLElement): void => {
    left = el.hidden ? undefined : pxOf(el.style.left);
    top = el.hidden ? undefined : pxOf(el.style.top);
  };
  const watch = (el: HTMLElement | null): void => {
    stop();
    tooltip = el;
    if (el === null) {
      left = undefined;
      top = undefined;
      return;
    }
    place(el);
    observer?.observe(el, { attributeFilter: ["style", "hidden"], attributeOldValue: true });
  };
  const reduced = (el: HTMLElement): boolean => (el.ownerDocument.defaultView ?? globalThis).matchMedia?.(REDUCED_MOTION).matches === true;

  const changed = (records: readonly MutationRecord[]): void => {
    const found = surfaceEl?.querySelector<HTMLElement>(TOOLTIP_SELECTOR) ?? null;
    if (found !== tooltip) {
      // The tooltip appeared (its first paint) or was replaced: placed where it is, nothing to glide from.
      watch(found);
      return;
    }
    const el = tooltip;
    if (el === null) {
      return;
    }
    if (el.hidden) {
      stop();
      left = undefined;
      top = undefined;
      return;
    }
    const fromLeft = left;
    const fromTop = top;
    place(el);
    if (left === fromLeft && top === fromTop) {
      return;
    }
    // A show after a hide (its `hidden` removed in this paint) places at once; so does a curve of null or reduced motion.
    const shown = records.some((record) => record.target === el && record.attributeName === "hidden" && record.oldValue !== null);
    const offset = animation === null ? { x: 0, y: 0 } : translateOf(el);
    stop();
    if (shown || glide === null || fromLeft === undefined || fromTop === undefined || left === undefined || top === undefined || reduced(el)) {
      return;
    }
    const x = fromLeft + offset.x - left;
    const y = fromTop + offset.y - top;
    if ((Math.abs(x) < MIN_TRAVEL_PX && Math.abs(y) < MIN_TRAVEL_PX) || typeof el.animate !== "function") {
      return;
    }
    const { duration, offsets, values } = glide;
    const frames = offsets.map((at, i) => {
      const rest = 1 - (values[i] ?? 1);
      return { offset: at, translate: `${x * rest}px ${y * rest}px` };
    });
    const running = el.animate(frames, { duration, easing: "linear" });
    animation = running;
    running.onfinish = () => {
      if (animation === running) {
        animation = null;
      }
    };
  };

  return {
    surface(el) {
      // The same surface again is a no-op once it is observed (a framework may hand it over before a MutationObserver could be made).
      if (el === surfaceEl && (el === null || observer !== null)) {
        return;
      }
      observer?.disconnect();
      observer = null;
      surfaceEl = el;
      // A surface cloned from a template (Solid's ref runs before it is connected) belongs to the template's inert document, which has no
      // window: the realm's own MutationObserver observes it the same.
      const Observer = el?.ownerDocument.defaultView?.MutationObserver ?? globalThis.MutationObserver;
      if (el === null || typeof Observer !== "function") {
        watch(null);
        return;
      }
      observer = new Observer(changed);
      observer.observe(el, { childList: true });
      watch(el.querySelector<HTMLElement>(TOOLTIP_SELECTOR));
    },
    curve(next) {
      glide = next;
      if (next === null) {
        stop();
      }
    },
  };
}
