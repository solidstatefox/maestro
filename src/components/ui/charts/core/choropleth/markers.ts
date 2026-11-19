import type { ChoroplethMarkerProps, ChoroplethMarkerShape } from "../types/choropleth";
import type { Point } from "./camera-math";

const SVG_NS = "http://www.w3.org/2000/svg";
const MIN_HIT_RADIUS = 22;
const LABEL_GAP = 6;

/** The shape's path around the coordinate, `r` its radius (bklit's `shapePath`). */
export const markerShapePath = (shape: ChoroplethMarkerShape, r: number): string => {
  switch (shape) {
    case "triangle":
      return `M0,${-r * 1.15}L${r * 1.05},${r * 0.7}L${-r * 1.05},${r * 0.7}Z`;
    case "square": {
      const s = r * 0.88;
      return `M${-s},${-s}H${s}V${s}H${-s}Z`;
    }
    case "diamond":
      return `M0,${-r * 1.2}L${r * 1.2},0L0,${r * 1.2}L${-r * 1.2},0Z`;
    case "pin": {
      // The tip sits on the coordinate; the round head above it.
      const cy = -r * 1.9;
      const hx = r * 0.82;
      const hy = cy + r * 0.57;
      return `M0,0L${-hx},${hy}A${r},${r} 0 1,1 ${hx},${hy}Z`;
    }
    default:
      return `M${-r},0a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`;
  }
};

/** A stable per-label offset, so "always" pulses don't fire in lockstep (bklit's `pulseDelay`). */
export const pulseDelay = (label: string): string => {
  let h = 0;
  for (let i = 0; i < label.length; i += 1) {
    h = (h * 31 + label.charCodeAt(i)) % 997;
  }
  return `${-(h % 10) * 110}ms`;
};

/** What a marker's events do (the controller's camera and hover). */
export interface MarkerHandlers {
  /** Whether hovering `key` (`point:<label>`) reacts (the camera's `isHoverable`). */
  readonly hoverable: (key: string) => boolean;
  /** Shows the marker's tooltip (`index`: its position among the markers), or hides it (null). */
  readonly focus: (index: number | null, source: "pointer" | "keyboard") => void;
  /** Clicked or Enter / Space: the camera flies to it (when `clickToZoom`). */
  readonly activate: (props: ChoroplethMarkerProps) => void;
  /** Whether the last press was a drag (its click doesn't count). */
  readonly wasDrag: () => boolean;
  /** Whether markers are buttons (`clickToZoom`). */
  readonly interactive: () => boolean;
}

interface Built {
  readonly props: ChoroplethMarkerProps;
  /** Placed at the coordinate. */
  readonly outer: SVGGElement;
  /** The marker itself: its events, role and inert flag. */
  readonly node: SVGGElement;
  readonly key: string;
}

const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Readonly<Record<string, string | number | undefined>>): SVGElementTagNameMap[K] => {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value !== undefined) {node.setAttribute(name, String(value));}
  }
  return node;
};

export interface Markers {
  /** Builds the markers in `layer` (and their glow filters in `defs`); a new list rebuilds them. */
  readonly draw: (list: readonly ChoroplethMarkerProps[], layer: SVGGElement, defs: SVGDefsElement, uid: string, handlers: MarkerHandlers) => void;
  /** Moves each marker to where its coordinate is drawn; `at` maps a `[longitude, latitude]` to the overlay's space (null: not drawn). */
  readonly place: (at: (coordinates: [number, number]) => Point | null) => void;
  /** The camera's focus changed: markers that can't be hovered lose their hover feedback (bklit's `hoverable`), and the role follows `clickToZoom`. */
  readonly refresh: () => void;
  readonly remove: () => void;
}

export function createMarkers(): Markers {
  let built: Built[] = [];
  let defsNodes: SVGElement[] = [];
  let handlers: MarkerHandlers | null = null;
  let lastList: readonly ChoroplethMarkerProps[] | null = null;
  const remove = (): void => {
    for (const { outer } of built) {outer.remove();}
    for (const node of defsNodes) {node.remove();}
    built = [];
    defsNodes = [];
    lastList = null;
  };
  const refresh = (): void => {
    if (handlers === null) {return;}
    const interactive = handlers.interactive();
    for (const { node, key, props } of built) {
      const inert = !handlers.hoverable(key);
      if (node.hasAttribute("data-inert") !== inert) {node.toggleAttribute("data-inert", inert);}
      if (interactive) {
        node.setAttribute("role", "button");
        node.setAttribute("tabindex", "0");
        node.setAttribute("aria-label", `Zoom to ${props.label}`);
        node.setAttribute("data-interactive", "");
      } else {
        node.removeAttribute("role");
        node.removeAttribute("tabindex");
        node.removeAttribute("aria-label");
        node.removeAttribute("data-interactive");
      }
    }
  };
  return {
    draw: (list, layer, defs, uid, next) => {
      handlers = next;
      if (list === lastList) {
        refresh();
        return;
      }
      remove();
      lastList = list;
      built = list.map((props, index) => {
        const { label, shape = "circle", size = 9, color = "var(--foreground)", stroke, strokeWidth = 1.5, pulse = "hover", glow = 0, showLabel = false } = props;
        // The ports hand `class` (core/types/choropleth.ts `ChoroplethMarkerPortProps`).
        const className = props.className ?? (props as { readonly class?: string }).class;
        const key = `point:${label}`;
        const r = size / 2;
        const d = markerShapePath(shape, r);
        const isPin = shape === "pin";
        const headY = isPin ? -r * 1.9 : 0;
        const outer = svgEl("g", { class: "bkm-choro-marker-at", "data-label": label });
        const node = svgEl("g", { class: `bkm-choro-marker${className ? ` ${className}` : ""}`, "data-pulse": pulse, "data-shape": shape });
        // The hit area stays still while the shape scales.
        node.append(svgEl("circle", { class: "bkm-choro-marker-hit", cy: headY * 0.6, fill: "transparent", r: Math.max(r * 2, MIN_HIT_RADIUS) }));
        const ring = svgEl("circle", { class: "bkm-choro-marker-pulse", cy: headY, fill: "none", r, stroke: color, "stroke-width": 1.5 });
        if (pulse === "always") {ring.style.animationDelay = pulseDelay(label);}
        node.append(ring);
        if (glow > 0) {
          const id = `${uid}-marker-glow-${index}`;
          const filter = svgEl("filter", { height: "500%", id, width: "500%", x: "-200%", y: "-200%" });
          filter.append(svgEl("feGaussianBlur", { stdDeviation: glow }));
          defs.append(filter);
          defsNodes.push(filter);
          node.append(svgEl("path", { class: "bkm-choro-marker-glow", d, fill: color, filter: `url(#${id})` }));
        }
        // No outline unless asked for; keyboard focus still draws one (styles.css).
        node.append(svgEl("path", { class: "bkm-choro-marker-shape", d, fill: color, "paint-order": "stroke", stroke: stroke ?? "none", "stroke-width": stroke ? strokeWidth : 2 }));
        if (isPin) {node.append(svgEl("circle", { class: "bkm-choro-marker-pin-head", cy: headY, fill: "var(--background)", r: r * 0.38 }));}
        if (showLabel) {
          const text = svgEl("text", { class: "bkm-choro-marker-label", dy: "0.35em", x: r + LABEL_GAP, y: headY });
          text.textContent = label;
          node.append(text);
        }
        const show = (source: "pointer" | "keyboard"): void => {
          if (handlers?.hoverable(key) === true) {handlers.focus(index, source);}
        };
        const hide = (): void => { handlers?.focus(null, "pointer"); };
        node.addEventListener("pointerenter", () => { show("pointer"); });
        node.addEventListener("pointerleave", hide);
        node.addEventListener("focus", () => { show("keyboard"); });
        node.addEventListener("blur", hide);
        node.addEventListener("click", (event) => {
          event.stopPropagation();
          if (handlers?.wasDrag() !== true) {handlers?.activate(props);}
        });
        node.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            handlers?.activate(props);
          }
        });
        outer.append(node);
        layer.append(outer);
        return { key, node, outer, props };
      });
      refresh();
    },
    place: (at) => {
      for (const { outer, props } of built) {
        const p = at(props.coordinates);
        if (p === null) {
          if (outer.style.display !== "none") {outer.style.display = "none";}
          continue;
        }
        if (outer.style.display === "none") {outer.style.display = "";}
        // A style, so the zoom's ease (styles.css) carries the marker with the map.
        outer.style.transform = `translate(${Math.round(p.x * 100) / 100}px, ${Math.round(p.y * 100) / 100}px)`;
      }
    },
    refresh,
    remove,
  };
}
