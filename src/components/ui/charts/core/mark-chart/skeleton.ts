import type { SceneNode } from "@tanstack/charts";
import { REVEAL_CSS_EASE } from "../motion/easing";
import type { MarkFrame } from "./types";

/** A bone's class (styles.css: none needed, the paint is inline) and the skeleton group's. */
export const BONE_CLASS = "bkm-mc-bone";
export const SKELETON_CLASS = "bkm-mc-skeleton";
/** The skeleton group's scene key; bones' keys start `sk:`, so none meets a family's own (its `enter` reads only its own). */
export const SKELETON_KEY = "mark:skeleton";

const BONE_PAINT = "var(--bkm-foreground)";
/** The bones' fill (a stroke's) opacity: their paint at its strongest, as the wave passes. */
const BONE_ALPHA = 0.2;
/** A bone's opacity at rest (no shimmer: reduced motion, a static preview) and at the shimmer's low. */
const REST_OPACITY = 0.7;
const LOW_OPACITY = 0.32;

const boneKey = (key: string): string => `sk:${key}`;

/** A rounded rectangle bone (a tile, a cell, a bar segment). */
export const boneRect = (key: string, x: number, y: number, width: number, height: number, radius = 4): SceneNode => {
  const w = Math.max(0, width);
  const h = Math.max(0, height);
  return { className: BONE_CLASS, height: h, key: boneKey(key), kind: "rect", radius: Math.max(0, Math.min(radius, w / 2, h / 2)), style: { fill: BONE_PAINT, fillOpacity: BONE_ALPHA, opacity: REST_OPACITY }, width: w, x, y };
};

/** A round bone (a node, a dot cell). */
export const boneDot = (key: string, x: number, y: number, radius: number): SceneNode => ({
  className: BONE_CLASS, key: boneKey(key), kind: "dot", radius: Math.max(0, radius), style: { fill: BONE_PAINT, fillOpacity: BONE_ALPHA, opacity: REST_OPACITY }, x, y,
});

/** A filled band bone (a stream layer), parted from its neighbours by the card's colour: its path and the outline it was drawn from. */
export const boneBand = (key: string, path: string, points: readonly (readonly [number, number])[]): SceneNode => ({
  className: BONE_CLASS, key: boneKey(key), kind: "area", path, points,
  style: { fill: BONE_PAINT, fillOpacity: BONE_ALPHA, opacity: REST_OPACITY, stroke: "var(--chart-background)", strokeWidth: 2 },
});

/** A stroked bone (a link): its path and the points it was drawn through. */
export const boneLink = (key: string, path: string, points: readonly (readonly [number, number])[], width = 1.5): SceneNode => ({
  className: BONE_CLASS, key: boneKey(key), kind: "polyline", path, points, style: { fill: "none", opacity: REST_OPACITY, stroke: BONE_PAINT, strokeOpacity: BONE_ALPHA * 1.4, strokeWidth: width },
});

/** A short pill where a label would sit (an axis tick, a name), placed as text anchored at (`x`, `y`) would be. */
export const boneLabel = (key: string, x: number, y: number, width: number, anchor: "start" | "middle" | "end" = "middle", height = 8): SceneNode => {
  const x0 = anchor === "start" ? x : anchor === "end" ? x - width : x - width / 2;
  return boneRect(key, x0, y - height / 2, width, height, height / 2);
};

/** A deterministic share in [0, 1) for `index` and `seed` (never `Math.random()`: the server's skeleton is the client's). */
export const boneShare = (index: number, seed = 0): number => {
  const x = Math.sin((index + 1) * 12.9898 + seed * 78.233) * 43_758.5453;
  return x - Math.floor(x);
};

// --- Motion ------------------------------------------------------------------------------------------------------------------------------

/** bklit line-loading-timing.ts: the loading pulse's 2.2 s cycle. */
const PULSE_CYCLE_MS = 2200;
/** The wave's crossing: the last bone's pulse starts this long after the first's. */
const WAVE_MS = 900;
/** The heatmap's shimmer ease (heatmap-cells.tsx:313-348). */
const PULSE_EASE = "cubic-bezier(0.45, 0, 0.55, 1)";
/** One bone's cycle: up to full and back down over the first two thirds, then a rest before the next wave. Starts low, so a fresh
 * skeleton rises into its first pulse (as bklit's pulse starts from nothing). */
export const BONE_PULSE: Keyframe[] = [
  { easing: PULSE_EASE, offset: 0, opacity: LOW_OPACITY },
  { easing: PULSE_EASE, offset: 0.32, opacity: 1 },
  { offset: 0.64, opacity: LOW_OPACITY },
  { offset: 1, opacity: LOW_OPACITY },
];

/** A bone's pulse, `phase` (0 to 1) across the wave, after `delay` ms (the conceal). */
export const bonePulseTiming = (phase: number, delay: number): KeyframeAnimationOptions => ({
  delay: delay + Math.min(1, Math.max(0, phase)) * WAVE_MS,
  duration: PULSE_CYCLE_MS,
  fill: "backwards",
  iterations: Number.POSITIVE_INFINITY,
});

/** The skeleton's fade in. */
export const SKELETON_FADE_MS = 360;
export const SKELETON_FADE_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
/** Ready -> loading: the drawn chart fades out over this before the skeleton shows (the heatmap's conceal, heatmap-animation.ts:43). */
export const SKELETON_CONCEAL_MS = 450;
export const SKELETON_CONCEAL_EASE = REVEAL_CSS_EASE;

// --- The wave's phases -------------------------------------------------------------------------------------------------------------------

const centreOf = (node: SceneNode): readonly [number, number] | null => {
  switch (node.kind) {
    case "rect":
      return [node.x + node.width / 2, node.y + node.height / 2];
    case "dot":
    case "label":
      return [node.x, node.y];
    case "rule":
      return [(node.x1 + node.x2) / 2, (node.y1 + node.y2) / 2];
    case "area":
    case "polyline": {
      if (node.points.length === 0) { return null; }
      let x0 = Number.POSITIVE_INFINITY;
      let x1 = Number.NEGATIVE_INFINITY;
      let y0 = Number.POSITIVE_INFINITY;
      let y1 = Number.NEGATIVE_INFINITY;
      for (const [x, y] of node.points) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
      return [(x0 + x1) / 2, (y0 + y1) / 2];
    }
    default:
      return null;
  }
};

/** Each bone's place in the wave (its scene key to 0..1): mostly left to right, leaning a little down, so the sweep reads as bklit's
 * skewed band. Fills `out` (cleared first). */
export const bonePhases = (nodes: readonly SceneNode[], frame: MarkFrame, out: Map<string, number>): void => {
  out.clear();
  const w = Math.max(1, frame.width);
  const h = Math.max(1, frame.height);
  const visit = (list: readonly SceneNode[]): void => {
    for (const node of list) {
      if (node.kind === "group") {
        visit(node.children);
        continue;
      }
      if (node.className !== BONE_CLASS) { continue; }
      const centre = centreOf(node);
      if (centre === null) { continue; }
      const across = (centre[0] - frame.x) / w;
      const down = (centre[1] - frame.y) / h;
      out.set(node.key, Math.min(1, Math.max(0, across * 0.8 + down * 0.2)));
    }
  };
  visit(nodes);
};
