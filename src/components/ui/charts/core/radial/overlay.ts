import type { HoverDotSpec, ScrubberSpec } from "./layers/types";
import type { RadialStage } from "./shell";

const SVG_NS = "http://www.w3.org/2000/svg";
const DEG = 180 / Math.PI;

export interface RadialOverlay {
  readonly element: SVGSVGElement;
  readonly defs: SVGDefsElement;
  /** Puts the overlay after the renderer's svg in `surface` (again after a remount replaced the surface's children). */
  place(surface: HTMLElement): void;
  /** The layers' resources, the stage's centre, the scrubber and the dots of a new model. */
  build(input: { readonly defs: string; readonly stage: RadialStage; readonly scrubber: ScrubberSpec | null; readonly dots: readonly HoverDotSpec[]; readonly uid: string }): void;
  /** The scrubber's angle (radians). */
  rotate(angle: number): void;
  /** Shows or hides the scrubber (its opacity transition). */
  showScrubber(shown: boolean): void;
  /** Places dot `index` at `angle` on its edge, hidden where the edge has no point or `shown` is false. */
  placeDot(index: number, angle: number, shown: boolean): void;
  remove(): void;
}

const svgEl = <K extends keyof SVGElementTagNameMap>(doc: Document, tag: K, attrs: Readonly<Record<string, string | number | undefined>>): SVGElementTagNameMap[K] => {
  const element = doc.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value !== undefined) {
      element.setAttribute(name, String(value));
    }
  }
  return element;
};

export function createRadialOverlay(doc: Document): RadialOverlay {
  const element = svgEl(doc, "svg", { "aria-hidden": "true", class: "bkm-rd-overlay", focusable: "false" });
  const layerDefs = svgEl(doc, "defs", {});
  // Entrance resources go in their own <defs>, so a model's rebuild of the layers' resources never drops a running entrance's mask.
  const defs = svgEl(doc, "defs", {});
  const centre = svgEl(doc, "g", {});
  element.append(layerDefs, defs, centre);
  let arm: SVGGElement | null = null;
  let scrubberGroup: SVGGElement | null = null;
  let dots: { readonly circle: SVGCircleElement; readonly spec: HoverDotSpec; shown: boolean; transform: string }[] = [];
  let lastDefs: string | null = null;
  return {
    element,
    defs,
    place(surface) {
      if (element.parentNode !== surface || element.nextSibling !== null) {
        surface.append(element);
      }
    },
    build({ defs: markup, stage, scrubber, dots: specs, uid }) {
      if (markup !== lastDefs) {
        lastDefs = markup;
        // SVG markup the layers build from numbers and the chart's colours (escaped attribute values).
        layerDefs.innerHTML = markup;
      }
      centre.setAttribute("transform", `translate(${stage.cx} ${stage.cy})`);
      centre.replaceChildren();
      arm = null;
      scrubberGroup = null;
      if (scrubber) {
        scrubberGroup = svgEl(doc, "g", { class: "bkm-rd-scrubber", "data-hidden": "" });
        arm = svgEl(doc, "g", {});
        const gradient = scrubber.variant === "gradient";
        const dashed = scrubber.variant === "dashed";
        let stroke = scrubber.color;
        if (gradient) {
          const id = `${uid}-rd-scrubber`;
          // In user space along the unrotated line, so it turns with the arm.
          const linear = svgEl(doc, "linearGradient", { gradientUnits: "userSpaceOnUse", id, x1: 0, x2: 0, y1: -scrubber.inner, y2: -scrubber.outer });
          linear.append(svgEl(doc, "stop", { offset: "0%", "stop-color": scrubber.color, "stop-opacity": 0 }), svgEl(doc, "stop", { offset: "100%", "stop-color": scrubber.color, "stop-opacity": 1 }));
          arm.append(linear);
          stroke = `url(#${id})`;
        }
        arm.append(svgEl(doc, "line", {
          stroke, "stroke-dasharray": dashed ? scrubber.dashArray : undefined, "stroke-linecap": dashed ? "butt" : "round", "stroke-opacity": scrubber.lineOpacity,
          "stroke-width": scrubber.strokeWidth, x1: 0, x2: 0, y1: -scrubber.inner, y2: -scrubber.outer,
        }));
        if (scrubber.showDot) {
          arm.append(svgEl(doc, "circle", { cx: 0, cy: -scrubber.outer, fill: scrubber.color, r: scrubber.dotRadius }));
        }
        scrubberGroup.append(arm);
        centre.append(scrubberGroup);
      }
      dots = specs.map((spec) => {
        const circle = svgEl(doc, "circle", {
          class: `bkm-rd-hover-dot ${spec.dimClass}`, fill: spec.fill, "fill-opacity": spec.fillOpacity, r: spec.r, stroke: spec.stroke, "stroke-width": spec.strokeWidth, visibility: "hidden",
        });
        centre.append(circle);
        return { circle, spec, shown: false, transform: "" };
      });
    },
    rotate(angle) {
      arm?.setAttribute("transform", `rotate(${angle * DEG})`);
    },
    showScrubber(shown) {
      if (scrubberGroup === null) {
        return;
      }
      if (shown) {
        scrubberGroup.removeAttribute("data-hidden");
      } else if (!scrubberGroup.hasAttribute("data-hidden")) {
        scrubberGroup.setAttribute("data-hidden", "");
      }
    },
    placeDot(index, angle, shown) {
      const dot = dots[index];
      if (!dot) {
        return;
      }
      const r = shown ? dot.spec.lookup(angle) : null;
      const visible = r !== null;
      if (visible !== dot.shown) {
        dot.shown = visible;
        if (visible) {
          dot.circle.removeAttribute("visibility");
        } else {
          dot.circle.setAttribute("visibility", "hidden");
        }
      }
      if (r !== null) {
        const transform = `translate(${r * Math.sin(angle)} ${-r * Math.cos(angle)})`;
        if (transform !== dot.transform) {
          dot.transform = transform;
          dot.circle.setAttribute("transform", transform);
        }
      }
    },
    remove() {
      element.remove();
    },
  };
}
