import { prefersReducedMotion } from "../loading/reduced-motion";
import { CLS, keyIs, keyStarts } from "../renderer-dom";
import type { HeatmapHoverCoordinator } from "../types/heatmap";
import {
  HEATMAP_CONCEAL_EASING,
  HEATMAP_ENTER_FADE_EASING,
  HEATMAP_ENTER_FADE_MS,
  HEATMAP_ENTER_FROM_TRANSFORM,
  HEATMAP_LOADING_CONCEAL_MS,
  heatmapShimmerLoop,
  heatmapWaveDelayMs,
} from "./motion";
import type { HeatmapWaveTiming } from "./motion";
import type { HeatmapScene } from "./focus";

const SVG_NS = "http://www.w3.org/2000/svg";
const OVERLAY_CLASS = "bkm-hm-overlay";
const LIFT_CLASS = "bkm-hm-lift";
const LIFT_ATTR = "data-lift";
/** The ready cells' groups (one per level and opacity, definition.ts `groupCells`) and their cells. */
const READY_GROUPS = `${CLS.rect}${keyStarts("heatmap-cells-")}`;
const READY_CELLS = `${READY_GROUPS} > rect`;
const SHIMMER_CELLS = `${CLS.rect}${keyIs("heatmap-loading-shimmer")} > rect`;
const STILL_CELLS = `${CLS.rect}${keyIs("heatmap-loading")} > rect`;
/** A ready cell's key ends `:<column>-<row>:<revealSignature>` (definition.ts `readyMarks`). */
const CELL_KEY = /:(\d+)-(\d+):/u;

/** What the layer reads from the latest pass. */
export interface HeatmapCellLayerInput {
  readonly status: string;
  /** `animate`: the conceal and the shimmer run (unless the reader prefers reduced motion). */
  readonly animate: boolean;
  /** The entrance runs (`animate` and `animationDuration > 0`). */
  readonly enter: boolean;
  /** The skeleton cells shimmer (`animate` and `showLoadingCells`). */
  readonly shimmer: boolean;
  readonly timing: HeatmapWaveTiming;
  readonly revealKey: string;
  readonly loadingCellMaxOpacity: number;
}

export interface HeatmapCellLayer {
  latest(input: HeatmapCellLayerInput): void;
  /** Before the renderer draws into `surface`: a ready -> loading draw copies the cells it is about to remove into the overlay first. */
  beforeDraw(surface: HTMLElement): void;
  /** The renderer's `onRender` (synchronous, before the paint): starts the entrance or the shimmer on the cells it added. `scene` is the
   * drawn scene, which canvas cells are read from. */
  drawn(surface: HTMLElement, scene?: HeatmapScene): void;
  /** Lifts the coordinator's hovered cell now and on every change; returns the unsubscribe, which drops the lift. */
  watchLift(coordinator: HeatmapHoverCoordinator): () => void;
  destroy(): void;
}

/** Whether any ready cell is in the scene. */
const sceneHasCells = (nodes: readonly HeatmapScene["nodes"][number][]): boolean =>
  nodes.some((node) => (node.kind === "group" ? sceneHasCells(node.children) : node.kind === "rect" && node.key?.startsWith("heatmap-cells-") === true));

const cellKeyOf = (rect: Element): string | null => {
  const match = CELL_KEY.exec(rect.getAttribute("data-ts-key") ?? "");
  return match === null ? null : `${match[1]}-${match[2]}`;
};

const chartSvgOf = (surface: HTMLElement): SVGSVGElement | null => {
  const first = surface.firstElementChild;
  return first instanceof SVGSVGElement ? first : null;
};

const canAnimate = (el: Element): boolean => typeof el.animate === "function";

/** TanStack's layered root (a chart with a canvas mark), and the canvas surface in it. */
const LAYERS_CLASS = "ts-chart-layers";
const canvasOf = (surface: HTMLElement): { readonly root: Element; readonly canvas: HTMLElement } | null => {
  const root = surface.firstElementChild;
  const canvas = root?.classList.contains(LAYERS_CLASS) ? root.querySelector(CLS.canvas) : null;
  return root && canvas instanceof HTMLElement ? { root, canvas } : null;
};

type SceneNode = HeatmapScene["nodes"][number];

/** The ready cells' rects in a scene, by `<column>-<row>`, in scene coordinates (group translations applied). */
const sceneCells = (scene: HeatmapScene): Map<string, Extract<SceneNode, { kind: "rect" }>> => {
  const out = new Map<string, Extract<SceneNode, { kind: "rect" }>>();
  const visit = (nodes: readonly SceneNode[], dx: number, dy: number): void => {
    for (const node of nodes) {
      if (node.kind === "group") {
        visit(node.children, dx + (node.translateX ?? 0), dy + (node.translateY ?? 0));
      } else if (node.kind === "rect" && node.key?.startsWith("heatmap-cells-") === true) {
        const match = CELL_KEY.exec(node.key);
        if (match !== null) {out.set(`${match[1]}-${match[2]}`, dx === 0 && dy === 0 ? node : { ...node, x: node.x + dx, y: node.y + dy });}
      }
    }
  };
  visit(scene.nodes, 0, 0);
  return out;
};

/** An svg rect drawn as the SVG renderer draws a cell's (fill, fill-opacity, x, y, width, height, rx), to lift a canvas cell. */
const cellRect = (doc: Document, node: Extract<SceneNode, { kind: "rect" }>): Element => {
  const rect = doc.createElementNS(SVG_NS, "rect");
  const { style } = node;
  if (typeof style?.fill === "string") {rect.setAttribute("fill", style.fill);}
  if (style?.fillOpacity !== undefined) {rect.setAttribute("fill-opacity", String(style.fillOpacity));}
  rect.setAttribute("x", String(node.x));
  rect.setAttribute("y", String(node.y));
  rect.setAttribute("width", String(node.width));
  rect.setAttribute("height", String(node.height));
  if (node.radius !== undefined && node.radius > 0) {rect.setAttribute("rx", String(node.radius));}
  return rect;
};

export function createHeatmapCellLayer(): HeatmapCellLayer {
  let input: HeatmapCellLayerInput | null = null;
  let chart: SVGSVGElement | null = null;
  let overlay: SVGSVGElement | null = null;
  // Canvas cells: the layered root the overlay follows, its viewBox, and the drawn scene the lift reads its rects from.
  let canvasRoot: Element | null = null;
  let canvasBox: string | null = null;
  let canvasScene: HeatmapScene | null = null;
  let canvasIndex: Map<string, Extract<SceneNode, { kind: "rect" }>> | null = null;
  let hadReady = false;
  let revealKey: string | null = null;
  let concealing = false;
  let cellIndex: Map<string, Element> | null = null;
  const shimmering = new WeakSet<Element>();

  /** The overlay svg, right after the chart's svg (or the canvas chart's layered root), on its viewBox. */
  const overlayFor = (svg: Element, box: string | null = svg.getAttribute("viewBox")): SVGSVGElement => {
    if (overlay === null) {
      overlay = svg.ownerDocument.createElementNS(SVG_NS, "svg");
      overlay.setAttribute("class", OVERLAY_CLASS);
      overlay.setAttribute("aria-hidden", "true");
    }
    if (svg.nextElementSibling !== overlay) {svg.after(overlay);}
    const viewBox = box;
    if (viewBox !== null && overlay.getAttribute("viewBox") !== viewBox) {overlay.setAttribute("viewBox", viewBox);}
    return overlay;
  };

  const motionOn = (): boolean => input !== null && input.animate && !prefersReducedMotion();

  const wave = (cells: NodeListOf<Element>, timing: HeatmapWaveTiming): void => {
    for (const cell of cells) {
      const key = CELL_KEY.exec(cell.getAttribute("data-ts-key") ?? "");
      if (key !== null && canAnimate(cell)) {
        // One keyframe: the end is the cell's own style, so a hover dim or scale mid-entrance carries through (heatmap-cells.tsx:383-423).
        cell.animate([{ offset: 0, opacity: 0, transform: HEATMAP_ENTER_FROM_TRANSFORM }], {
          delay: heatmapWaveDelayMs(Number(key[1]), Number(key[2]), timing),
          duration: HEATMAP_ENTER_FADE_MS,
          easing: HEATMAP_ENTER_FADE_EASING,
          fill: "backwards",
        });
      }
    }
  };

  const shimmer = (cells: NodeListOf<Element>, delay: number, maxOpacity: number): void => {
    for (const [index, cell] of [...cells].entries()) {
      if (!shimmering.has(cell) && canAnimate(cell)) {
        shimmering.add(cell);
        const loop = heatmapShimmerLoop(index, maxOpacity);
        cell.animate(loop.keyframes, { delay, duration: loop.duration, fill: "backwards", iterations: Number.POSITIVE_INFINITY });
      }
    }
  };

  const lookup = (key: string): Element | undefined => {
    if (canvasRoot !== null) {
      canvasIndex ??= canvasScene === null ? new Map() : sceneCells(canvasScene);
      const node = canvasIndex.get(key);
      return node === undefined ? undefined : cellRect(canvasRoot.ownerDocument, node);
    }
    if (cellIndex === null && chart !== null) {
      cellIndex = new Map();
      for (const cell of chart.querySelectorAll(READY_CELLS)) {
        const cellKey = cellKeyOf(cell);
        if (cellKey !== null) {cellIndex.set(cellKey, cell);}
      }
    }
    return cellIndex?.get(key);
  };

  /** A draw with canvas cells: the overlay follows the layered root, and new ready cells sweep in as one clip from the plot's left edge. */
  const drawnCanvas = (canvas: HTMLElement, scene: HeatmapScene | null): void => {
    canvasBox = scene === null ? null : `0 0 ${scene.width} ${scene.height}`;
    if (overlay !== null && canvasRoot !== null) {overlayFor(canvasRoot, canvasBox);}
    if (input === null) {return;}
    const ready = input.status !== "loading" && scene !== null && sceneHasCells(scene.nodes);
    if (!ready) {
      hadReady = false;
      return;
    }
    if ((!hadReady || input.revealKey !== revealKey) && input.enter && motionOn() && canAnimate(canvas)) {
      // The wave reaches the last column after its sweep, and each cell fades in over HEATMAP_ENTER_FADE_MS (its row lean is left out).
      const from = `inset(0 ${Math.max(0, scene.width - scene.chart.x)}px 0 0)`;
      canvas.animate([{ clipPath: from }, { clipPath: "inset(0 0 0 0)" }], {
        duration: input.timing.sweepMs + HEATMAP_ENTER_FADE_MS,
        easing: HEATMAP_ENTER_FADE_EASING,
        fill: "backwards",
      });
    }
    hadReady = true;
    revealKey = input.revealKey;
  };

  return {
    latest(next) {
      input = next;
    },
    beforeDraw(surface) {
      const svg = chartSvgOf(surface);
      if (input?.status !== "loading" || !hadReady || svg === null || !motionOn()) {return;}
      const groups = svg.querySelectorAll(READY_GROUPS);
      if (groups.length === 0) {return;}
      // bklit's conceal (heatmap-cells.tsx:149-153): the cells fade out over 450 ms on the reveal ease, then the shimmer starts.
      const layer = svg.ownerDocument.createElementNS(SVG_NS, "g");
      for (const group of groups) {
        const copy = group.cloneNode(true);
        if (copy instanceof Element) {
          copy.removeAttribute("data-ts-key");
          copy.removeAttribute("class");
          layer.append(copy);
        }
      }
      overlayFor(svg).prepend(layer);
      if (canAnimate(layer)) {
        const fade = layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: HEATMAP_LOADING_CONCEAL_MS, easing: HEATMAP_CONCEAL_EASING, fill: "forwards" });
        fade.addEventListener("finish", () => { layer.remove(); });
        fade.addEventListener("cancel", () => { layer.remove(); });
      } else {
        layer.remove();
      }
      concealing = true;
    },
    drawn(surface, scene) {
      cellIndex = null;
      chart = chartSvgOf(surface);
      const canvas = chart === null ? canvasOf(surface) : null;
      canvasRoot = canvas?.root ?? null;
      canvasScene = canvas === null ? null : (scene ?? null);
      canvasIndex = null;
      if (canvas !== null) {
        drawnCanvas(canvas.canvas, canvasScene);
        return;
      }
      const svg = chart;
      if (svg === null || input === null) {return;}
      if (overlay !== null) {overlayFor(svg);}
      const motion = motionOn();
      const ready = svg.querySelectorAll(READY_CELLS);
      if (ready.length > 0) {
        if ((!hadReady || input.revealKey !== revealKey) && input.enter && motion) {wave(ready, input.timing);}
        hadReady = true;
        revealKey = input.revealKey;
      } else {
        hadReady = false;
      }
      const delay = concealing ? HEATMAP_LOADING_CONCEAL_MS : 0;
      concealing = false;
      if (!motion) {return;}
      if (input.shimmer) {shimmer(svg.querySelectorAll(SHIMMER_CELLS), delay, input.loadingCellMaxOpacity);}
      if (delay > 0) {
        for (const cell of svg.querySelectorAll(STILL_CELLS)) {
          if (canAnimate(cell)) {cell.animate([{ opacity: 0 }, { opacity: 0 }], { duration: delay });}
        }
      }
    },
    watchLift(coordinator) {
      /** Where the lift goes: the overlay after the chart's svg or after the canvas chart's layered root. */
      const liftOverlay = (): SVGSVGElement | null => {
        if (chart !== null) {return overlayFor(chart);}
        return canvasRoot === null ? null : overlayFor(canvasRoot, canvasBox);
      };
      let lifted: { readonly key: string; readonly el: Element } | null = null;
      const retire = (el: Element, how: "out" | "leave"): void => {
        el.setAttribute(LIFT_ATTR, how);
        // styles.css plays the exit; without one (reduced motion) the copy goes at once.
        if (typeof el.getAnimations !== "function" || el.getAnimations().length === 0) {
          el.remove();
          return;
        }
        el.addEventListener("animationend", () => { el.remove(); }, { once: true });
        el.addEventListener("animationcancel", () => { el.remove(); }, { once: true });
      };
      const apply = (): void => {
        const cell = coordinator.getHoveredCell();
        const key = cell === null ? null : `${cell.column}-${cell.row}`;
        if (key === (lifted?.key ?? null)) {return;}
        const previous = lifted;
        lifted = null;
        if (previous !== null) {retire(previous.el, key === null ? "leave" : "out");}
        const target = liftOverlay();
        const source = key === null || target === null ? undefined : lookup(key);
        if (key === null || source === undefined || target === null) {return;}
        const copy = source.cloneNode(false);
        if (!(copy instanceof Element)) {return;}
        copy.removeAttribute("data-ts-key");
        copy.setAttribute("class", LIFT_CLASS);
        // From another cell it rises out of the dim; the first hover keeps it lit while the rest dims.
        copy.setAttribute(LIFT_ATTR, previous === null ? "enter" : "move");
        target.append(copy);
        lifted = { el: copy, key };
      };
      apply();
      const off = coordinator.subscribe(apply);
      return () => {
        off();
        lifted = null;
        for (const el of overlay?.querySelectorAll(`.${LIFT_CLASS}`) ?? []) {el.remove();}
      };
    },
    destroy() {
      overlay?.remove();
      overlay = null;
      chart = null;
      canvasRoot = null;
      canvasScene = null;
      canvasIndex = null;
      cellIndex = null;
      hadReady = false;
      revealKey = null;
      concealing = false;
    },
  };
}
