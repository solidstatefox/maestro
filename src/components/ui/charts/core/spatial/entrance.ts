import { REVEAL_CSS_EASE } from "../motion/easing";
import { keyIs } from "../renderer-dom";
import type { SpatialEntrance } from "./family";

/** One element's own enter: the heatmap cells' 450 ms strong ease-out (core/heatmap/motion.ts). */
const ELEMENT_MS = 450;
const ELEMENT_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
/** A traced stroke takes the whole sweep, on the reveal ease. */
const DRAW_EASE = REVEAL_CSS_EASE;
const FIRST_POINT = /^M\s*(-?[\d.]+(?:e-?\d+)?)[ ,]+(-?[\d.]+(?:e-?\d+)?)/u;

interface Point {
  readonly x: number;
  readonly y: number;
}

/** Where an element sits, from its own attributes: a path's first point, a circle's center, a line's start, a group's first child's. */
const anchorOf = (element: Element): Point | null => {
  const tag = element.tagName.toLowerCase();
  if (tag === "circle") {
    return { x: Number(element.getAttribute("cx")), y: Number(element.getAttribute("cy")) };
  }
  if (tag === "line") {
    return { x: Number(element.getAttribute("x1")), y: Number(element.getAttribute("y1")) };
  }
  if (tag === "path") {
    const match = FIRST_POINT.exec(element.getAttribute("d") ?? "");
    return match === null ? null : { x: Number(match[1]), y: Number(match[2]) };
  }
  const first = element.firstElementChild;
  return first === null ? null : anchorOf(first);
};

/** The plot's size, from the chart svg's viewBox. */
const viewBoxOf = (svg: SVGSVGElement): { readonly width: number; readonly height: number } => {
  const box = svg.viewBox.baseVal;
  return box.width > 0 ? { width: box.width, height: box.height } : { width: 1, height: 1 };
};

const canAnimate = (element: Element): boolean => typeof element.animate === "function";

/** The share of the sweep before an element starts, 0-1. */
type Stagger = (element: Element, index: number, count: number) => number;

const staggerOf = (kind: SpatialEntrance["kind"], size: { readonly width: number; readonly height: number }): Stagger => {
  switch (kind) {
    case "wave":
      return (element) => {
        const at = anchorOf(element);
        return at === null ? 0 : Math.min(1, Math.max(0, at.x / size.width));
      };
    case "radial": {
      const cx = size.width / 2;
      const cy = size.height / 2;
      const reach = Math.hypot(cx, cy) || 1;
      return (element) => {
        const at = anchorOf(element);
        return at === null ? 0 : Math.min(1, Math.hypot(at.x - cx, at.y - cy) / reach);
      };
    }
    case "grow":
    case "levels":
      return (_element, index, count) => (count <= 1 ? 0 : index / (count - 1));
    default:
      return () => 0;
  }
};

/** Starts one mark's entrance on its drawn elements; returns how many it started. */
const playMark = (svg: SVGSVGElement, entrance: SpatialEntrance, sweepMs: number): Animation[] => {
  const group = svg.querySelector(`g${keyIs(entrance.markId)}`);
  if (group === null) {
    return [];
  }
  const delay = entrance.delay ?? 0;
  const duration = entrance.duration ?? ELEMENT_MS;
  if (entrance.kind === "fade") {
    return canAnimate(group) ? [group.animate([{ opacity: 0 }, { opacity: 1 }], { delay, duration: Math.max(duration, sweepMs), easing: ELEMENT_EASE, fill: "backwards" })] : [];
  }
  const elements = [...group.children].filter((child) => child.tagName.toLowerCase() !== "defs");
  const size = viewBoxOf(svg);
  const stagger = staggerOf(entrance.kind, size);
  const animations: Animation[] = [];
  const count = elements.length;
  if (entrance.kind === "draw") {
    for (const [index, element] of elements.entries()) {
      if (!canAnimate(element)) {
        continue;
      }
      // A normalised length: the dash covers the whole path whatever its length, with no layout read.
      element.setAttribute("pathLength", "1");
      animations.push(element.animate(
        [{ strokeDasharray: "1 1", strokeDashoffset: 1 }, { strokeDasharray: "1 1", strokeDashoffset: 0 }],
        { delay: delay + (count <= 1 ? 0 : (index / count) * sweepMs * 0.5), duration: Math.max(duration, sweepMs), easing: DRAW_EASE, fill: "backwards" },
      ));
    }
    return animations;
  }
  const from = `scale(${entrance.fromScale ?? 0.6})`;
  for (const [index, element] of elements.entries()) {
    if (!canAnimate(element)) {
      continue;
    }
    animations.push(element.animate(
      [{ opacity: 0, transform: from }, { opacity: 1, transform: "none" }],
      { delay: delay + stagger(element, index, count) * sweepMs, duration, easing: ELEMENT_EASE, fill: "backwards" },
    ));
  }
  return animations;
};

/** The chart's entrance: every mark's, on the elements of `svg` (the renderer's), now. `started` counts the animations (0: nothing drawn
 * yet); `cancel` finishes them at rest. */
export const playSpatialEntrance = (svg: SVGSVGElement, entrances: readonly SpatialEntrance[], sweepMs: number): { readonly started: number; readonly cancel: () => void } => {
  const animations = entrances.flatMap((entrance) => playMark(svg, entrance, sweepMs));
  return {
    started: animations.length,
    cancel: () => {
      for (const animation of animations) {
        animation.cancel();
      }
    },
  };
};
