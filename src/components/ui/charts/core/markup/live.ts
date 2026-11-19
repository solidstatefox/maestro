import { el } from "./node";
import type { MarkupChild, MarkupNode } from "./node";

/** The date pill's merged-edge filter (liveline.css): dilate, erode and blur the label plates into one rounded shape. */
export const livePillFilter = (): MarkupNode =>
  el("filter", { id: "bkm-live-pill", x: "-60%", y: "-400%", width: "220%", height: "900%", "color-interpolation-filters": "sRGB" }, [
    el("feMorphology", { operator: "dilate", radius: "14 0", in: "SourceGraphic", result: "d" }),
    el("feMorphology", { operator: "erode", radius: "8 0", in: "d", result: "c" }),
    el("feGaussianBlur", { stdDeviation: "8", in: "c", result: "b" }),
    el("feComponentTransfer", { in: "b", result: "t" }, [el("feFuncA", { type: "linear", slope: "16", intercept: "-7.2" })]),
    el("feFlood", { result: "f" }, [], { style: { "flood-color": "var(--chart-date-pill-background)" }, styleBefore: "result" }),
    el("feComposite", { in: "f", in2: "t", operator: "in" }),
  ]);

/** The chart's pattern tiles (a Background's, the ReferenceAreas'), already scoped to the chart (markup/resources.ts), in an svg of their own; none without any. */
export const liveTilesHost = (defs: readonly MarkupChild[]): MarkupNode | null =>
  defs.length === 0 ? null : el("svg", { "aria-hidden": "true", width: "0", height: "0" }, [el("defs", {}, defs)], { style: { position: "absolute" } });

const SVG_NS = "http://www.w3.org/2000/svg";

/** An svg markup tree (attributes, style, children; no slots) as DOM. */
const svgDom = (doc: Document, node: MarkupNode): Element => {
  const element = doc.createElementNS(SVG_NS, node.tag);
  for (const [name, value] of Object.entries(node.attrs)) {
    if (value !== undefined && value !== false) {
      element.setAttribute(name, value === true ? "" : String(value));
    }
  }
  for (const [name, value] of Object.entries(node.style ?? {})) {
    (element as SVGElement).style.setProperty(name, String(value));
  }
  for (const child of node.children) {
    if (typeof child === "string") {
      element.append(child);
    } else if (child !== null && "tag" in child) {
      element.append(svgDom(doc, child));
    }
  }
  return element;
};

/** livePillFilter as DOM, for the hover overlay's defs. */
export const livePillFilterElement = (doc: Document): Element => svgDom(doc, livePillFilter());
