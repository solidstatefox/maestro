import { createMark } from "@tanstack/charts";
import type { SceneNode } from "@tanstack/charts";
import { curveBumpX, curveLinear, curveMonotoneX, line as d3Line } from "d3-shape";
import type { CurveFactory } from "d3-shape";
import { prefersReducedMotion } from "../loading/reduced-motion";
import { REVEAL_CSS_EASE } from "../motion/easing";
import { MASK_MIRROR_ATTR } from "../surface/svg-css-mask";

/** A point in the plot's pixels: (0, 0) is the plot's top-left corner (a shape may reach into the margins, as a label's pill does). */
export type SkeletonPoint = readonly [number, number];

/** How a skeleton line or band runs through its points. */
export type SkeletonCurve = "linear" | "monotone" | "bump";

/** One skeleton shape. `tone` scales its strength (1: a bar's; a stem or a band is lighter). */
export type SkeletonShape =
  | { readonly kind: "rect"; readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly radius?: number; readonly tone?: number }
  | { readonly kind: "dot"; readonly x: number; readonly y: number; readonly r: number; readonly tone?: number }
  | { readonly kind: "line"; readonly points: readonly SkeletonPoint[]; readonly width?: number; readonly curve?: SkeletonCurve; readonly tone?: number }
  | { readonly kind: "band"; readonly top: readonly SkeletonPoint[]; readonly bottom: readonly SkeletonPoint[]; readonly curve?: SkeletonCurve; readonly tone?: number };

/** The plot's size the skeleton is laid out in (the renderer's measured plot, the margins taken off). */
export interface SkeletonSize {
  readonly width: number;
  readonly height: number;
}

/** A family's skeleton: its shapes at a plot size. */
export type PlotSkeleton = (size: SkeletonSize) => readonly SkeletonShape[];

/** The skeleton mark's id (its group's `data-ts-key`). */
const SKELETON_ID = "plot-skeleton";
/** The skeleton's group class: the owned CSS sweeps it. */
const SKELETON_CLASS = "bkm-plot-skeleton";
/** bklit's skeleton bars (core/markup/loading.ts `barSkeletonTree`): the foreground at 45% under the sweep. */
const SKELETON_FILL = "var(--bkm-foreground)";
const SKELETON_OPACITY = 0.45;
/** Ready -> loading: the drawn marks fade over this (bklit's heatmap conceal, core/heatmap/motion.ts), then the skeleton fades in. */
const CONCEAL_MS = 450;
const SKELETON_FADE_MS = 300;
/** One sweep of the band across the plot (core/markup/loading.ts DEFAULT_SWEEP_DURATION_S). */
const SWEEP_S = 2;
const SVG_NS = "http://www.w3.org/2000/svg";

// Deterministic [0, 1) from an integer and a salt (core/markup/loading.ts's hash): server and client draw the same skeleton.
const fract = (n: number): number => {
  const x = Math.sin(n) * 43_758.5453;
  return x - Math.floor(x);
};

/** A seeded share in [0, 1) for skeleton item `index` (each family salts its own draws). */
export const skeletonSeed = (index: number, salt = 0): number => fract((index + 1) * 12.9898 + salt * 78.233);

/** A seeded value in [lo, hi) for item `index`. */
export const skeletonBetween = (index: number, lo: number, hi: number, salt = 0): number => lo + skeletonSeed(index, salt) * (hi - lo);

const CURVES: Readonly<Record<SkeletonCurve, CurveFactory>> = { linear: curveLinear, monotone: curveMonotoneX, bump: curveBumpX };

const pathOf = (points: readonly SkeletonPoint[], curve: SkeletonCurve): string =>
  d3Line<SkeletonPoint>()
    .x((p) => p[0])
    .y((p) => p[1])
    .curve(CURVES[curve])(points) ?? "";

/** A band's outline: along the top, back along the bottom. */
const bandPath = (top: readonly SkeletonPoint[], bottom: readonly SkeletonPoint[], curve: SkeletonCurve): string => {
  const upper = pathOf(top, curve);
  const lower = pathOf(bottom.toReversed(), curve);
  return upper === "" || lower === "" ? "" : `${upper}L${lower.slice(1)}Z`;
};

const strength = (tone: number | undefined): number => Math.round(SKELETON_OPACITY * (tone ?? 1) * 1000) / 1000;

/** A shape as the renderer's scene node. */
function sceneNode(shape: SkeletonShape, index: number): SceneNode | null {
  const key = `${SKELETON_ID}:${index}`;
  const opacity = strength(shape.tone);
  switch (shape.kind) {
    case "rect":
      return shape.width > 0 && shape.height > 0
        ? { kind: "rect", key, x: shape.x, y: shape.y, width: shape.width, height: shape.height, radius: shape.radius, style: { fill: SKELETON_FILL, fillOpacity: opacity } }
        : null;
    case "dot":
      return shape.r > 0 ? { kind: "dot", key, x: shape.x, y: shape.y, radius: shape.r, style: { fill: SKELETON_FILL, fillOpacity: opacity } } : null;
    case "line":
      return shape.points.length < 2
        ? null
        : {
            kind: "polyline",
            key,
            points: shape.points,
            path: pathOf(shape.points, shape.curve ?? "linear"),
            style: { fill: "none", stroke: SKELETON_FILL, strokeOpacity: opacity, strokeWidth: shape.width ?? 2, lineCap: "round", lineJoin: "round" },
          };
    case "band":
      return shape.top.length < 2 || shape.bottom.length < 2
        ? null
        : { kind: "area", key, points: [...shape.top, ...shape.bottom.toReversed()], path: bandPath(shape.top, shape.bottom, shape.curve ?? "linear"), style: { fill: SKELETON_FILL, fillOpacity: opacity } };
    default:
      return null;
  }
}

/** The skeleton as one custom mark: its shapes in one group at the plot's corner, no points (nothing to hover), no motion of its own. */
const skeletonMark = (skeleton: PlotSkeleton): object =>
  createMark<never>(() => ({
    channels: {},
    id: SKELETON_ID,
    resolveLayout: ({ chart }) => ({
      render: () => {
        const children = skeleton({ width: Math.max(0, chart.width), height: Math.max(0, chart.height) }).flatMap((shape, i) => sceneNode(shape, i) ?? []);
        return { nodes: [{ kind: "group", key: `${SKELETON_ID}:root`, className: SKELETON_CLASS, ariaHidden: true, translateX: chart.x, translateY: chart.y, children }], points: [] };
      },
    }),
  }), false);

/** A family's definition as it draws while loading: its frame (scales, axes, grid, margin, theme) with the skeleton in place of its
 * marks, and no pointer, keyboard or tooltip. */
export function loadingDefinition(definition: object, skeleton: PlotSkeleton): object {
  const mark = skeletonMark(skeleton);
  const base = definition as { readonly chart?: (context: unknown) => object };
  const frame = base.chart;
  const marks = typeof frame === "function" ? { chart: (context: unknown) => ({ ...frame(context), marks: [mark] }) } : { marks: [mark] };
  return { ...definition, ...marks, tooltip: false, pointer: false, keyboard: false };
}

// bklit's sweep band (core/markup/loading.ts BAND_STOPS: a sin² bell from 5% to 90%), as the middle third of a mask three plots wide that
// the shared `bkm-loading-shimmer` keyframes slide from 100% to 0% (styles.css): the band crosses the plot left to right, then re-enters.
const BAND_MASK = /* @__PURE__ */ (() => {
  const stops = Array.from({ length: 9 }, (_unused, i) => {
    const t = i / 8;
    const alpha = Math.round((0.05 + Math.sin(t * Math.PI) ** 2 * 0.85) * 1000) / 1000;
    return `rgb(0 0 0 / ${alpha}) ${Math.round((100 / 3) * (1 + t) * 100) / 100}%`;
  });
  return `linear-gradient(115deg, ${stops.join(", ")})`;
})();

/** The owned CSS while loading: the host inert to the pointer (as BarChart's), the skeleton under the travelling band, or still (reduced
 * motion, `animate={false}`) at a resting strength. */
export function skeletonCss(scope: string, animate: boolean): string {
  const node = `${scope} .${SKELETON_CLASS}`;
  const still = `${node}{opacity:.6}`;
  const sweep = `${node}{-webkit-mask-image:${BAND_MASK};mask-image:${BAND_MASK};-webkit-mask-size:300% 100%;mask-size:300% 100%;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;animation:bkm-loading-shimmer ${SWEEP_S}s linear infinite}`;
  // An engine whose CSS masks on SVG content the surface mirrors (surface/svg-css-mask.ts) can't run the travelling band: it rests, as reduced motion has it.
  const rest = "{-webkit-mask-image:none;mask-image:none;animation:none;opacity:.6}";
  const motion = animate ? `${sweep}${scope} [${MASK_MIRROR_ATTR}] .${SKELETON_CLASS}${rest}@media (prefers-reduced-motion:reduce){${node}${rest}}` : still;
  return `${scope}[data-bkm-status="loading"] .ts-chart-host{pointer-events:none}${motion}`;
}

/** Whether the skeleton's phase changes animate: the chart animates and the reader allows motion. */
export const loadingMotion = (animate: boolean): boolean => animate && !prefersReducedMotion();

const chartSvgOf = (surface: HTMLElement): SVGSVGElement | null => {
  for (const child of surface.children) {
    if (child instanceof SVGSVGElement && child.classList.contains("ts-chart")) {
      return child;
    }
  }
  return null;
};

/** Removes the chart's svg, so the next mount draws (and enters) afresh rather than adopting it. */
export const dropChartSvg = (surface: HTMLElement): void => {
  chartSvgOf(surface)?.remove();
};

const OVERLAY_STYLE = "position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none";

/** Ready -> loading, before the draw that drops the marks: a copy of them fades out over the chart. Returns whether one did (the skeleton
 * then holds back until it is gone). */
export function concealMarks(surface: HTMLElement): boolean {
  const svg = chartSvgOf(surface);
  const marks = svg?.querySelector(".ts-chart__marks");
  if (!svg || !marks || marks.childElementCount === 0) {
    return false;
  }
  const overlay = svg.ownerDocument.createElementNS(SVG_NS, "svg");
  overlay.setAttribute("aria-hidden", "true");
  overlay.setAttribute("style", OVERLAY_STYLE);
  const viewBox = svg.getAttribute("viewBox");
  if (viewBox !== null) {
    overlay.setAttribute("viewBox", viewBox);
  }
  const layer = svg.ownerDocument.createElementNS(SVG_NS, "g");
  for (const child of marks.children) {
    layer.append(child.cloneNode(true));
  }
  overlay.append(layer);
  svg.after(overlay);
  if (typeof layer.animate !== "function") {
    overlay.remove();
    return false;
  }
  const fade = layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: CONCEAL_MS, easing: REVEAL_CSS_EASE, fill: "forwards" });
  const done = (): void => { overlay.remove(); };
  fade.addEventListener("finish", done);
  fade.addEventListener("cancel", done);
  return true;
}

/** After the draw that put the skeleton up behind a conceal: it waits for the marks to fade, then fades in. */
export function holdSkeleton(surface: HTMLElement): void {
  const group = surface.querySelector(`.${SKELETON_CLASS}`);
  if (group !== null && typeof group.animate === "function") {
    const total = CONCEAL_MS + SKELETON_FADE_MS;
    group.animate([{ opacity: 0 }, { opacity: 0, offset: CONCEAL_MS / total }, { opacity: 1 }], { duration: total, easing: "linear" });
  }
}
