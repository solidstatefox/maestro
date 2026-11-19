import type { ChartTextMeasurer } from "@tanstack/charts";
import type { ChartTooltipExtension } from "@tanstack/charts/tooltip";
import { createSurfaceTextMeasure } from "../surface/text-measure";
import { livePillFilterElement } from "../markup/live";

const SVG_NS = "http://www.w3.org/2000/svg";
/** charts-core crosshair-resolver.js clampLabel: the label stays this far inside the surface. */
const LABEL_INSET = 2;
const PILL_FONT_SIZE = 14;
const PILL_FONT_WEIGHT = 500;
/** The pill's halo: one stroke the merged-edge filter rounds into bklit's capsule (styles.css). */
const PILL_HALO = 22;
/** The pill's gap under the plot (the x labels' padding, definition.ts). */
const PILL_OFFSET = 14;

/** What the indicator draws, from the chart's carriers and the renderer's plot (svg px). */
export interface LiveHoverModel {
  readonly rule: boolean;
  /** bklit's ChartTooltip dot on the line; none without `showDots`. */
  readonly marker: { readonly radius: number; readonly fill: string } | null;
  /** The time pill (LiveXAxis's crosshair label); none without an x axis or a crosshair. */
  readonly pill: { readonly format: (time: number) => string } | null;
  /** The renderer's plot: the rule's span and the marker's clip. */
  readonly plot: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  /** The surface's size: the pill is clamped inside it. */
  readonly width: number;
  readonly height: number;
}

/** A focused point as the renderer paints it. */
export interface LiveHoverPoint {
  readonly x: number;
  readonly y: number;
  readonly xValue?: unknown;
}

const svgEl = <K extends keyof SVGElementTagNameMap>(doc: Document, tag: K, attrs: Readonly<Record<string, string>>, parent?: Element): SVGElementTagNameMap[K] => {
  const el = doc.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) {
    el.setAttribute(name, value);
  }
  parent?.append(el);
  return el;
};

const fixed = (n: number): string => String(Math.round(n * 100) / 100);

interface Nodes {
  readonly root: SVGSVGElement;
  readonly rule: SVGGElement;
  readonly ruleRect: SVGRectElement;
  readonly clip: SVGRectElement;
  readonly marker: SVGCircleElement;
  readonly halo: SVGTextElement;
  readonly text: SVGTextElement;
  /** What was last written, so a paint writes only what moved. */
  readonly last: Record<string, string>;
}

export interface LiveHover {
  /** The latest draw's model (or none: no tooltip, so nothing to show). */
  update(model: LiveHoverModel | null): void;
  /** The surface the indicator lives in (the line's), or null when it goes. */
  attach(surface: HTMLElement | null): void;
  /** Keeps the indicator right after the renderer's svg (call after a render). */
  place(): void;
  /** The tooltip extension that paints the indicator with every focus paint (stable). */
  readonly extension: (base: ChartTooltipExtension) => ChartTooltipExtension;
  dispose(): void;
}

export function createLiveHover(uid: string): LiveHover {
  let model: LiveHoverModel | null = null;
  let surface: HTMLElement | null = null;
  let nodes: Nodes | null = null;
  let shown: LiveHoverPoint | null = null;
  const text = createSurfaceTextMeasure();
  let measure: ChartTextMeasurer | undefined;

  const write = (el: Element, slot: string, name: string, value: string): void => {
    const last = nodes?.last;
    if (!last || last[slot] === value) {
      return;
    }
    last[slot] = value;
    if (name === "#text") {
      el.textContent = value;
    } else {
      el.setAttribute(name, value);
    }
  };

  const build = (host: HTMLElement): Nodes => {
    const doc = host.ownerDocument;
    // The renderer's focus guide layer class: its hover-only visibility and its dims (styles.css) apply as they did to the renderer's.
    const root = svgEl(doc, "svg", { class: "ts-chart__focus-guide-layer bkm-live-hov", "aria-hidden": "true", width: "1", height: "1", visibility: "hidden" });
    root.style.cssText = "position:absolute;left:0;top:0;overflow:visible;pointer-events:none";
    const defs = svgEl(doc, "defs", {}, root);
    const gradient = svgEl(doc, "linearGradient", { id: `${uid}-live-crosshair`, x1: "0", y1: "0", x2: "0", y2: "1" }, defs);
    for (const [offset, opacity] of [[0, 0], [0.1, 1], [0.9, 1], [1, 0]] as const) {
      const stop = svgEl(doc, "stop", { offset: String(offset), "stop-opacity": String(opacity) }, gradient);
      stop.style.stopColor = "var(--chart-crosshair)";
    }
    const clipPath = svgEl(doc, "clipPath", { id: `${uid}-live-hov-clip` }, defs);
    const clip = svgEl(doc, "rect", {}, clipPath);
    defs.append(livePillFilterElement(doc));
    const rule = svgEl(doc, "g", { class: "ts-chart__crosshair bkm-live-rule", "aria-hidden": "true" }, root);
    const ruleRect = svgEl(doc, "rect", { x: "-0.5", width: "1", fill: `url(#${uid}-live-crosshair)` }, rule);
    const crosshair = svgEl(doc, "g", { class: "ts-chart__crosshair", "aria-hidden": "true" }, root);
    const plot = svgEl(doc, "g", { class: "ts-chart__crosshair-plot", "clip-path": `url(#${uid}-live-hov-clip)` }, crosshair);
    const marker = svgEl(doc, "circle", { class: "ts-chart__crosshair-marker", stroke: "var(--chart-background)", "stroke-width": "2" }, plot);
    const label = { "text-anchor": "middle", "font-size": String(PILL_FONT_SIZE), "font-weight": String(PILL_FONT_WEIGHT), "font-family": "inherit" };
    const halo = svgEl(doc, "text", { class: "ts-chart__crosshair-label ts-chart__crosshair-label--x ts-chart__crosshair-label-halo", fill: "none", stroke: "var(--chart-date-pill-background)", "stroke-width": String(PILL_HALO), "stroke-linejoin": "round", ...label }, crosshair);
    const pillText = svgEl(doc, "text", { class: "ts-chart__crosshair-label ts-chart__crosshair-label--x ts-chart__crosshair-label-text", fill: "var(--chart-date-pill-foreground)", stroke: "none", "stroke-width": "0", ...label }, crosshair);
    return { root, rule, ruleRect, clip, marker, halo, text: pillText, last: {} };
  };

  /** The pill's x and y kept inside the surface (crosshair-resolver.js clampLabel, with the renderer's measurer in the host's font). */
  const clampPill = (label: string, x: number, y: number, m: LiveHoverModel): readonly [number, number] => {
    if (!surface || label.length === 0) {
      return [x, y];
    }
    measure ??= text.current(surface);
    if (!measure) {
      return [x, y];
    }
    const box = measure(label, { fontSize: PILL_FONT_SIZE, fontWeight: PILL_FONT_WEIGHT, fontFamily: "sans-serif", fontStyle: "normal", fontStretch: "normal", letterSpacing: 0, direction: "inherit", fontScale: 1, anchor: "middle", baseline: "auto" });
    const left = x + box.x;
    const top = y + box.y;
    const right = m.width - LABEL_INSET;
    const bottom = m.height - LABEL_INSET;
    const dx = left < LABEL_INSET ? LABEL_INSET - left : left + box.width > right ? right - left - box.width : 0;
    const dy = top < LABEL_INSET ? LABEL_INSET - top : top + box.height > bottom ? bottom - top - box.height : 0;
    return [x + dx, y + dy];
  };

  const paint = (point: LiveHoverPoint | null): void => {
    shown = point;
    const m = model;
    if (!surface || !m || !point || !Number.isFinite(point.x)) {
      if (nodes) {
        write(nodes.root, "visibility", "visibility", "hidden");
      }
      return;
    }
    nodes ??= build(surface);
    place();
    const n = nodes;
    write(n.clip, "clip-x", "x", fixed(m.plot.x));
    write(n.clip, "clip-y", "y", fixed(m.plot.y));
    write(n.clip, "clip-w", "width", fixed(m.plot.width));
    write(n.clip, "clip-h", "height", fixed(m.plot.height));
    write(n.rule, "rule-on", "display", m.rule ? "inline" : "none");
    if (m.rule) {
      write(n.ruleRect, "rule-y", "y", fixed(m.plot.y));
      write(n.ruleRect, "rule-h", "height", fixed(m.plot.height));
      write(n.rule, "rule-x", "transform", `translate(${fixed(point.x)} 0)`);
    }
    const dot = m.marker !== null && Number.isFinite(point.y);
    write(n.marker, "marker-on", "display", dot ? "inline" : "none");
    if (m.marker && dot) {
      write(n.marker, "marker-r", "r", String(m.marker.radius));
      write(n.marker, "marker-fill", "fill", m.marker.fill);
      write(n.marker, "marker-x", "cx", fixed(point.x));
      write(n.marker, "marker-y", "cy", fixed(point.y));
    }
    const time = point.xValue instanceof Date ? point.xValue.getTime() : typeof point.xValue === "number" ? point.xValue : undefined;
    const pill = m.pill !== null && time !== undefined;
    write(n.halo, "pill-on", "display", pill ? "inline" : "none");
    write(n.text, "pill-on2", "display", pill ? "inline" : "none");
    if (m.pill && time !== undefined) {
      const label = m.pill.format(time);
      const [x, y] = clampPill(label, point.x, m.plot.y + m.plot.height + PILL_OFFSET + PILL_FONT_SIZE * 0.8, m);
      write(n.halo, "pill-text", "#text", label);
      write(n.text, "pill-text2", "#text", label);
      write(n.halo, "pill-x", "x", fixed(x));
      write(n.text, "pill-x2", "x", fixed(x));
      write(n.halo, "pill-y", "y", fixed(y));
      write(n.text, "pill-y2", "y", fixed(y));
    }
    write(n.root, "visibility", "visibility", "visible");
  };

  const place = (): void => {
    const root = nodes?.root;
    if (!root || !surface) {
      return;
    }
    const svg = surface.querySelector(":scope > svg.ts-chart");
    if (svg && root.previousElementSibling !== svg) {
      svg.after(root);
    } else if (!svg && root.parentElement !== surface) {
      surface.append(root);
    }
  };

  const extension = (base: ChartTooltipExtension): ChartTooltipExtension => ({
    ...base,
    create(context) {
      const instance = base.create(context);
      return {
        ...instance,
        paint(paintContext) {
          instance.paint(paintContext);
          paint(paintContext.point);
        },
        hide() {
          instance.hide();
          paint(null);
        },
        destroy() {
          instance.destroy();
          paint(null);
        },
      };
    },
  });

  return {
    update(next) {
      model = next;
      if (shown) {
        paint(shown);
      }
    },
    attach(next) {
      if (next === surface) {
        return;
      }
      nodes?.root.remove();
      nodes = null;
      measure = undefined;
      surface = next;
    },
    place,
    extension,
    dispose() {
      nodes?.root.remove();
      nodes = null;
      surface = null;
      shown = null;
      text.destroy();
    },
  };
}
