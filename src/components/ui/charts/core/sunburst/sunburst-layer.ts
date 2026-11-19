import type { ChartLayerRenderer, SceneLabel, SceneNode, SceneStyle } from "@tanstack/charts";
import { createSvgLayer, paintKeyed, setOrRemove, STYLE_PROPERTIES, SVG_NS, translateOf } from "../layer/svg-layer";
import { prefersReducedMotion } from "../loading/reduced-motion";
import { resolveEntranceOrigins } from "../entrance/entrance-origin";
import { REVEAL_EASING } from "../motion/easing";
import { ZOOM_EASING, ZOOM_MS } from "./easing";
import { labelFits, lerpArc, poseOf, sameArc, sectorPath, seedArc, unwrapArc } from "./geometry";
import type { ArcValues } from "./geometry";

/** Class the mark puts on the group that carries one label (its display follows the fit rule, so a label that does not fit is absent from layout like bklit's unrendered one). */
export const LABEL_BOX_CLASS = "bk-sb-lbox";

/** The mark's `render` rewrites this feed (target geometry by node key, to tween) before the same scene reaches the layer's `render`,
 * so the layer reads it in place: keep that mark-then-layer order. */
export interface SectorFeed {
  /** `delayMs` is the intro delay of an area; labels and boxes carry none. */
  readonly geometry: Map<string, { readonly arc: ArcValues; readonly delayMs: number }>;
  /** The view's root id: a change is a zoom (tweened), the same id with other geometry is a resize or data change (snaps). */
  view: string;
  sweepMs: number;
  /** The sweep's curve (the chart's `enterTransition.ease`, else the reveal curve). */
  sweepEase: (t: number) => number;
  /** The chart's nominal size: bklit draws in a size-unit viewBox, so strokes and text scale by width over this. */
  readonly size: number;
  /** Runs after each paint: the hover push vars live on the layer's own elements (push.ts). */
  onPainted: (() => void) | null;
}

export const createSectorFeed = (size: number): SectorFeed => ({ geometry: new Map(), onPainted: null, size, sweepEase: REVEAL_EASING, sweepMs: 1100, view: "" });

interface Track {
  readonly from: ArcValues;
  to: ArcValues;
  readonly intro: boolean;
  readonly start: number;
  readonly delay: number;
  readonly duration: number;
  readonly ease: (t: number) => number;
}

interface NodeState {
  readonly element: SVGElement;
  readonly apply: (arc: ArcValues) => void;
  readonly isArea: boolean;
  /** A sector's hover overlay (`<key>:pop`): hidden while no sector is hovered, so a tween frame skips it then (its end is still written). */
  readonly overlay: boolean;
  /** The geometry on screen when no track runs. */
  cur: ArcValues | null;
  /** The last target the mark published (a track may run to a turn-shifted copy of it). */
  target: ArcValues | null;
  track: Track | null;
}

// Presentation attributes, not inline style: the hover CSS (push.ts) must be able to override a scene's opacity.
const applyStyle = (element: SVGElement, style: SceneStyle | undefined, scale: number): void => {
  for (const [key, property] of STYLE_PROPERTIES) {
    const value = style?.[key];
    if (value === undefined) {
      element.removeAttribute(property);
    } else {
      element.setAttribute(property, String(key === "strokeWidth" ? Number(value) * scale : value));
    }
  }
};

const noop = (): void => undefined;

/** Set on the layer's svg while a zoom morphs, past its dim fade: styles.css drops the sectors' and labels' transitions. */
const ZOOM_ATTR = "data-bk-zoom";
/** The zoom's dim fade: bklit's HOVER_DIM_TRANSITION (160ms), or the hover profile's duration plus a margin when that is longer. */
const ZOOM_FADE_MS = 180;
const ZOOM_FADE_MARGIN_MS = 40;
const MS_PER_S = 1000;

/** The hover profile's duration (`--bkm-hover-dur`, styles.css) in ms, 0 when unset. */
const hoverMs = (element: Element): number => {
  const value = getComputedStyle(element).getPropertyValue("--bkm-hover-dur").trim();
  const amount = Number.parseFloat(value);
  if (!Number.isFinite(amount)) { return 0; }
  return value.endsWith("ms") ? amount : amount * MS_PER_S;
};

const paintLabel = (element: SVGElement, node: SceneLabel, scale: number): void => {
  setOrRemove(element, "class", node.className);
  setOrRemove(element, "x", node.x);
  setOrRemove(element, "y", node.y);
  setOrRemove(element, "text-anchor", node.anchor);
  setOrRemove(element, "dominant-baseline", node.baseline);
  setOrRemove(element, "font-size", node.fontSize === undefined ? undefined : node.fontSize * scale);
  setOrRemove(element, "font-weight", node.fontWeight);
  element.setAttribute("font-family", "inherit");
  applyStyle(element, node.style, scale);
  if (element.textContent !== node.text) { element.textContent = node.text; }
};

export const createSectorLayer = (feed: SectorFeed, renderStart: { readonly current: number | null }): ChartLayerRenderer<unknown, number, number> =>
  createSvgLayer<unknown>("bkm-sunburst-sectors", (svg) => {
    const states = new Map<string, NodeState>();
    const elements = new Map<string, SVGElement>();
    const seen = new Set<string>();
    let reduced = false;
    let first = true;
    let view: string | null = null;
    let origin: number | null = null;
    let cancelOrigin = noop;
    let frame = 0;
    let scale = 1;

    const arcNow = (state: NodeState, now: number): ArcValues => {
      const { track } = state;
      if (track === null || state.cur === null) { return state.cur ?? track?.to ?? [0, 0, 0, 0]; }
      const start = track.intro ? origin : track.start;
      const progress = start === null ? 0 : Math.min(1, Math.max(0, (now - start - track.delay) / track.duration));
      return progress >= 1 ? track.to : lerpArc(track.from, track.to, track.ease(progress));
    };

    // While a zoom morphs the sectors (`d` and the label poses written every frame), each frame restyles every sector and label, and the
    // hover transitions they declare double that cost: once the zoom's dim fade (the hover profile) is over, `data-bk-zoom` on the layer's
    // svg turns them off until the morph ends (styles.css).
    let zoomStart: number | null = null;
    let fadeMs = ZOOM_FADE_MS;
    const markZoom = (now: number, zooming: number | null): void => {
      if (zooming === null) {
        zoomStart = null;
        svg.removeAttribute(ZOOM_ATTR);
        return;
      }
      if (zoomStart !== zooming) {
        zoomStart = zooming;
        // At the start of a frame, before this tick's writes: the style is clean, so the read costs nothing.
        fadeMs = Math.max(ZOOM_FADE_MS, hoverMs(svg) + ZOOM_FADE_MARGIN_MS);
      }
      if (now - zooming >= fadeMs) { svg.setAttribute(ZOOM_ATTR, ""); }
    };

    const tick = (now: number): void => {
      let running = false;
      let zooming: number | null = null;
      // The overlays show only on the hovered path (the host's `data-bk-hov`, push.ts): unhovered, a frame leaves them as they are.
      const overlaysShown = svg.closest("[data-bk-hov]") !== null;
      for (const state of states.values()) {
        const { track } = state;
        if (track !== null) {
          if (!track.intro) { zooming = Math.min(zooming ?? track.start, track.start); }
          const start = track.intro ? origin : track.start;
          const done = start !== null && now - start - track.delay >= track.duration;
          if (done || overlaysShown || !state.overlay) { state.apply(done ? track.to : arcNow(state, now)); }
          if (done) {
            state.cur = track.to;
            state.track = null;
          } else {
            running = true;
          }
        }
      }
      markZoom(now, running ? zooming : null);
      // Next frame of the sector tween: bklit drives zoom and enter as motion values per frame (sunburst-chart.tsx:244, sunburst-segment.tsx:78-81).
      frame = running ? requestAnimationFrame(tick) : 0;
    };
    const wake = (): void => {
      if (frame === 0) { frame = requestAnimationFrame(tick); }
    };

    const sync = (state: NodeState, id: string, introPending: boolean, now: number): void => {
      const geometry = feed.geometry.get(id);
      if (geometry === undefined) { return; }
      const { arc } = geometry;
      if (state.cur === null || state.target === null) {
        const intro = introPending && state.isArea;
        if (intro) { state.element.style.animationDelay = `${geometry.delayMs}ms`; }
        state.cur = intro ? seedArc(arc) : arc;
        state.target = arc;
        state.track = intro ? { delay: geometry.delayMs, duration: feed.sweepMs, ease: feed.sweepEase, from: state.cur, intro: true, start: 0, to: arc } : null;
        state.apply(state.cur);
        return;
      }
      if (sameArc(arc, state.target)) { return; }
      state.target = arc;
      if (view !== null && feed.view !== view && !reduced) {
        const from = arcNow(state, now);
        state.cur = from;
        state.track = { delay: 0, duration: ZOOM_MS, ease: ZOOM_EASING, from, intro: false, start: now, to: unwrapArc(arc, from) };
      } else if (state.track === null) {
        state.cur = arc;
        state.apply(arc);
      } else {
        state.track.to = arc;
      }
    };

    const create = (node: SceneNode): NodeState | null => {
      if (node.kind === "area") {
        const path = document.createElementNS(SVG_NS, "path");
        return { apply: (arc) => { path.setAttribute("d", sectorPath(arc)); }, cur: null, element: path, isArea: true, overlay: node.key.endsWith(":pop"), target: null, track: null };
      }
      if (node.kind === "label") {
        const text = document.createElementNS(SVG_NS, "text");
        return {
          apply: (arc) => {
            const { x, y, rotate } = poseOf(arc);
            text.setAttribute("transform", `translate(${x} ${y}) rotate(${rotate})`);
          },
          cur: null, element: text, isArea: false, overlay: false, target: null, track: null,
        };
      }
      if (node.kind === "group" && node.className?.includes(LABEL_BOX_CLASS) === true) {
        const box = document.createElementNS(SVG_NS, "g");
        // Written on change only: an inline style write restyles the box and its label even when the value is the same.
        let shown: boolean | null = null;
        return {
          apply: (arc) => {
            const fits = labelFits(arc, scale);
            if (fits !== shown) {
              shown = fits;
              box.style.display = fits ? "" : "none";
            }
          },
          cur: null, element: box, isArea: false, overlay: false, target: null, track: null,
        };
      }
      return null;
    };

    const elementOf = (node: SceneNode, id: string): { readonly element: SVGElement; readonly state: NodeState | null } | null => {
      const existing = elements.get(id);
      if (existing !== undefined) { return { element: existing, state: states.get(id) ?? null }; }
      const state = create(node);
      const element = state?.element ?? document.createElementNS(SVG_NS, "g");
      elements.set(id, element);
      if (state !== null) { states.set(id, state); }
      return { element, state };
    };

    const paintNode = (node: SceneNode, id: string, introPending: boolean, now: number): SVGElement | null => {
      if (node.kind !== "area" && node.kind !== "label" && node.kind !== "group") { return null; }
      const { element, state } = elementOf(node, id) ?? {};
      if (element === undefined) { return null; }
      if (node.kind === "label") {
        paintLabel(element, node, scale);
      } else {
        if (node.kind === "area") { applyStyle(element, node.style, scale); }
        setOrRemove(element, "class", node.className);
        setOrRemove(element, "aria-hidden", node.ariaHidden === true ? "true" : undefined);
        if (node.kind === "group") {
          if (state === null) { setOrRemove(element, "transform", translateOf(node)); }
          // eslint-disable-next-line no-use-before-define -- mutual recursion with paintNodes
          paintNodes(node.children, element, id, introPending, now);
        }
      }
      if (state !== null && state !== undefined) { sync(state, node.key, introPending, now); }
      return element;
    };

    const paintNodes = (nodes: readonly SceneNode[], parent: SVGElement, path: string, introPending: boolean, now: number): void => {
      paintKeyed(nodes, parent, path, seen, (node, id) => paintNode(node, id, introPending, now));
    };

    return {
      destroy: (): void => {
        cancelAnimationFrame(frame);
        frame = 0;
        cancelOrigin();
        markZoom(0, null);
      },
      render: (scene): void => {
        const now = performance.now();
        scale = scene.width / feed.size;
        reduced = prefersReducedMotion();
        const introPending = first && !reduced;
        if (introPending) {
          // bklit's per-sector enter is a JS-driven motion value: its clock starts at motion's origin (kit/entrance/entrance-origin.ts), resolved in the first rAF.
          cancelOrigin = resolveEntranceOrigins(renderStart.current ?? now, (clocks) => { origin = clocks.motion; });
        }
        paintNodes(scene.nodes, svg, "", introPending, now);
        ({ view } = feed);
        first = false;
        for (const [id, element] of elements) {
          if (!seen.has(id)) { element.remove(); elements.delete(id); states.delete(id); }
        }
        seen.clear();
        feed.onPainted?.();
        wake();
      },
    };
  });
