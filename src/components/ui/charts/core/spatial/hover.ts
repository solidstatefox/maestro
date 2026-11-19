import type { ChartPoint } from "@tanstack/charts";
import { clearAttribute, writePresence } from "../host-write";
import type { MarkupChild, MarkupNode } from "../markup/node";
import { cssText } from "../style";
import type { SpatialBuild } from "./family";

const SVG_NS = "http://www.w3.org/2000/svg";
export const SPATIAL_HOVER_ATTR = "data-bkm-hover";
export const SPATIAL_LIFT_CLASS = "bkm-sp-lift";

const isNode = (child: MarkupChild): child is MarkupNode => child !== null && typeof child === "object" && "tag" in child;

/** A markup tree as svg elements (the lift is a handful of nodes; no framework renders it). */
const svgElement = (doc: Document, node: MarkupNode): SVGElement => {
  const element = doc.createElementNS(SVG_NS, node.tag);
  for (const [name, value] of Object.entries(node.attrs)) {
    if (value !== undefined && value !== false) {
      element.setAttribute(name, value === true ? "" : String(value));
    }
  }
  if (node.style !== undefined) {
    element.setAttribute("style", cssText(node.style));
  }
  for (const child of node.children) {
    if (isNode(child)) {
      element.append(svgElement(doc, child));
    } else if (typeof child === "string") {
      element.append(doc.createTextNode(child));
    }
  }
  return element;
};

/** How long the dim outlasts a lost focus: crossing the gap between two marks keeps it on, so its transition never restarts mid-hover
 * (a restarted filter transition re-layerizes the chart every frame). */
const DIM_HOLD_MS = 120;

const samePoint = (a: ChartPoint | null, b: ChartPoint | null): boolean =>
  a === b || (a !== null && b !== null && a.markId === b.markId && a.key === b.key && a.x === b.x && a.y === b.y);

export interface SpatialHover {
  /** The renderer's `onFocusChange`, over the latest build. */
  focus(point: ChartPoint | null, build: SpatialBuild): void;
  /** After a draw: the overlay follows the chart svg's viewBox, and a focus drawn at the old size is dropped. */
  drawn(surface: HTMLElement): void;
  /** Removes the overlay and the host's hover state. */
  detach(): void;
}

export function createSpatialHover(host: () => HTMLElement | null): SpatialHover {
  let overlay: SVGSVGElement | null = null;
  let viewBox = "";
  let current: ChartPoint | null = null;
  let dimTimer: ReturnType<typeof setTimeout> | undefined;
  const dim = (on: boolean): void => {
    clearTimeout(dimTimer);
    dimTimer = undefined;
    if (on) {
      writePresence(host(), SPATIAL_HOVER_ATTR, true);
      return;
    }
    dimTimer = setTimeout(() => {
      dimTimer = undefined;
      clearAttribute(host(), SPATIAL_HOVER_ATTR);
    }, DIM_HOLD_MS);
  };
  const clear = (): void => {
    clearTimeout(dimTimer);
    dimTimer = undefined;
    current = null;
    overlay?.replaceChildren();
    clearAttribute(host(), SPATIAL_HOVER_ATTR);
  };
  return {
    focus(point, build) {
      const el = host();
      const hoverable = point !== null && build.focusMarks.has(point.markId) ? point : null;
      if (samePoint(hoverable, current)) {
        return;
      }
      current = hoverable;
      if (el !== null) {
        dim(hoverable !== null && build.hoverLayers.length > 0);
      }
      if (overlay === null) {
        return;
      }
      const node = hoverable === null || build.lift === null ? null : build.lift(hoverable);
      if (node === null) {
        overlay.replaceChildren();
        return;
      }
      overlay.replaceChildren(svgElement(overlay.ownerDocument, node));
    },
    drawn(surface) {
      const svg = surface.querySelector("svg.ts-chart");
      if (!(svg instanceof SVGSVGElement)) {
        return;
      }
      if (overlay === null || overlay.parentNode !== surface) {
        overlay = surface.ownerDocument.createElementNS(SVG_NS, "svg");
        overlay.setAttribute("class", SPATIAL_LIFT_CLASS);
        overlay.setAttribute("aria-hidden", "true");
        svg.after(overlay);
      }
      const next = svg.getAttribute("viewBox") ?? "";
      if (next !== viewBox) {
        viewBox = next;
        overlay.setAttribute("viewBox", next);
        // A focus drawn at the old size would sit off its mark: the next pointer move draws it again.
        clear();
      }
    },
    detach() {
      clear();
      overlay?.remove();
      overlay = null;
      viewBox = "";
    },
  };
}
