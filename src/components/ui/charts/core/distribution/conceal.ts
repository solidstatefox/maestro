import { prefersReducedMotion } from "../loading/reduced-motion";
import { REVEAL_CSS_EASE } from "../motion/easing";
import { SKELETON_CLASS } from "./skeleton";

const SVG_NS = "http://www.w3.org/2000/svg";
/** The conceal layer's class (css.ts places it over the plot). */
export const CONCEAL_CLASS = "bkm-d-conceal";
/** The marks fade out over this, as the heatmap's cells do (heatmap-animation.ts:43). */
export const CONCEAL_MS = 450;
/** The skeleton fades in over this as they finish going (the reveal ease leaves little of them past 70%). */
const SKELETON_AT_MS = CONCEAL_MS * 0.7;
const SKELETON_IN_MS = 260;

export interface DistributionConceal {
  /** Before a draw that swaps the drawn marks for the skeleton: copies the item groups over the chart and fades them out. */
  before(surface: HTMLElement): void;
  /** The renderer's `onRender` after that draw: holds the new skeleton hidden while the copy fades. */
  after(surface: HTMLElement): void;
  /** Drops the copy at once (back to ready, or the chart goes). */
  clear(): void;
}

const chartSvgOf = (surface: HTMLElement): SVGSVGElement | null => {
  const first = surface.firstElementChild;
  return first instanceof SVGSVGElement ? first : null;
};

const canAnimate = (el: Element): boolean => typeof el.animate === "function";

/** A copy that only paints: no class (its entrance would replay), no key (the renderer must never adopt it). */
const inert = (source: Element): Element | null => {
  const copy = source.cloneNode(true);
  if (!(copy instanceof Element)) {
    return null;
  }
  for (const el of [copy, ...copy.querySelectorAll("*")]) {
    el.removeAttribute("class");
    el.removeAttribute("data-ts-key");
  }
  return copy;
};

export function createConceal(): DistributionConceal {
  let layer: SVGSVGElement | null = null;
  let holding = false;

  const clear = (): void => {
    layer?.remove();
    layer = null;
    holding = false;
  };

  return {
    before(surface) {
      clear();
      const svg = chartSvgOf(surface);
      if (svg === null || prefersReducedMotion()) {
        return;
      }
      // The item groups (css.ts `groupClass`), outermost only: a beeswarm's series, a histogram's bins, a box plot's categories; and an
      // ECDF's percentile guides.
      const groups = [...svg.querySelectorAll(".bkm-d-g, .bkm-d-guide")].filter((group) => group.parentElement?.closest(".bkm-d-g") === null);
      if (groups.length === 0) {
        return;
      }
      const doc = svg.ownerDocument;
      const next = doc.createElementNS(SVG_NS, "svg");
      next.setAttribute("class", CONCEAL_CLASS);
      next.setAttribute("aria-hidden", "true");
      const viewBox = svg.getAttribute("viewBox");
      if (viewBox !== null) {
        next.setAttribute("viewBox", viewBox);
      }
      for (const group of groups) {
        const copy = inert(group);
        if (copy !== null) {
          next.append(copy);
        }
      }
      // Each shape fades its own fill and stroke, never its opacity nor a group's: a translucent shape on a composited opacity paints
      // garbage colours in Chrome's software rasterizer (an out-of-sRGB `--chart-1` mixed with transparent turned yellow).
      const shapes = [...next.querySelectorAll("*")].filter((el) => el.childElementCount === 0 && canAnimate(el));
      if (shapes.length === 0) {
        return;
      }
      svg.after(next);
      // Each shape's own fill and stroke opacity, read before the fade replaces them.
      const from = shapes.map((shape) => {
        const style = getComputedStyle(shape);
        return { fillOpacity: style.fillOpacity, strokeOpacity: style.strokeOpacity };
      });
      layer = next;
      holding = true;
      const done = (): void => {
        next.remove();
        if (layer === next) {
          layer = null;
        }
      };
      for (const [i, shape] of shapes.entries()) {
        const fade = shape.animate([from[i] ?? { fillOpacity: 1, strokeOpacity: 1 }, { fillOpacity: 0, strokeOpacity: 0 }], { duration: CONCEAL_MS, easing: REVEAL_CSS_EASE, fill: "forwards" });
        if (i === 0) {
          fade.addEventListener("finish", done);
          fade.addEventListener("cancel", done);
        }
      }
    },
    after(surface) {
      if (!holding) {
        return;
      }
      holding = false;
      const skeleton = chartSvgOf(surface)?.querySelector(`.${SKELETON_CLASS}`);
      if (skeleton !== null && skeleton !== undefined && canAnimate(skeleton)) {
        const total = SKELETON_AT_MS + SKELETON_IN_MS;
        skeleton.animate([{ opacity: 0 }, { offset: SKELETON_AT_MS / total, opacity: 0 }, { opacity: 1 }], { duration: total, easing: "linear" });
      }
    },
    clear,
  };
}
