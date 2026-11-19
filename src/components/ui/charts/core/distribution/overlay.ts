import type { ChartBounds } from "@tanstack/charts";
import type { AnyPoint } from "../erased-types";

/** A dot on the crosshair, in the surface's pixels. */
export interface OverlayDotAt {
  readonly x: number;
  readonly y: number;
  readonly color: string;
  /** Its radius before the ring (default 5, bklit's TooltipDot). */
  readonly radius?: number;
}

/** What the overlay draws for a focused point. */
export interface DistributionOverlayModel {
  /** A vertical rule at the point's x across the plot. */
  readonly crosshair: boolean;
  /** The dots for the focused point (read from its datum, laid out by the marks' latest draw). */
  readonly dots: (point: AnyPoint) => readonly OverlayDotAt[];
}

const SVG_NS = "http://www.w3.org/2000/svg";
const DOT_RADIUS = 5;

export interface DistributionOverlay {
  /** The overlay's element, made on first use; the controller appends it to the host. */
  root(doc: Document): SVGSVGElement;
  model(next: DistributionOverlayModel | null): void;
  /** The plot box of the latest draw (the rule's extent). */
  drawn(chart: ChartBounds | null): void;
  show(point: AnyPoint | null): void;
  remove(): void;
}

export function createOverlay(): DistributionOverlay {
  let svg: SVGSVGElement | null = null;
  let rule: SVGLineElement | null = null;
  const dots: SVGCircleElement[] = [];
  let current: DistributionOverlayModel | null = null;
  let plot: ChartBounds | null = null;
  let shown: AnyPoint | null = null;

  const dotAt = (index: number): SVGCircleElement | null => {
    if (svg === null) {
      return null;
    }
    while (dots.length <= index) {
      const dot = svg.ownerDocument.createElementNS(SVG_NS, "circle");
      dot.setAttribute("r", String(DOT_RADIUS));
      dot.setAttribute("class", "bkm-d-ov-dot");
      svg.append(dot);
      dots.push(dot);
    }
    return dots[index] ?? null;
  };

  const paint = (): void => {
    if (svg === null) {
      return;
    }
    const point = shown;
    if (point === null || current === null || plot === null) {
      svg.removeAttribute("data-on");
      return;
    }
    svg.setAttribute("data-on", "");
    if (rule !== null) {
      rule.style.display = current.crosshair ? "" : "none";
      const x = String(Math.round(point.x) + 0.5);
      rule.setAttribute("x1", x);
      rule.setAttribute("x2", x);
      rule.setAttribute("y1", String(plot.y));
      rule.setAttribute("y2", String(plot.y + plot.height));
    }
    const at = current.dots(point);
    for (const [index, spot] of at.entries()) {
      const dot = dotAt(index);
      if (dot !== null) {
        dot.style.display = "";
        dot.setAttribute("cx", String(spot.x));
        dot.setAttribute("cy", String(spot.y));
        dot.setAttribute("fill", spot.color);
        dot.setAttribute("r", String(spot.radius ?? DOT_RADIUS));
      }
    }
    for (const dot of dots.slice(at.length)) {
      dot.style.display = "none";
    }
  };

  return {
    root(doc) {
      if (svg === null) {
        svg = doc.createElementNS(SVG_NS, "svg");
        svg.setAttribute("class", "bkm-d-ov");
        svg.setAttribute("aria-hidden", "true");
        rule = doc.createElementNS(SVG_NS, "line");
        rule.setAttribute("class", "bkm-d-ov-rule");
        svg.append(rule);
      }
      return svg;
    },
    model(next) {
      current = next;
      paint();
    },
    drawn(chart) {
      plot = chart;
      paint();
    },
    show(point) {
      shown = point;
      paint();
    },
    remove() {
      svg?.remove();
      shown = null;
    },
  };
}
