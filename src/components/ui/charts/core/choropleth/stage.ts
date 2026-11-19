import type { ViewTransform } from "./camera-math";
import { transformCss } from "./camera-math";

const SVG_NS = "http://www.w3.org/2000/svg";
const MARKS_SELECTOR = ".ts-chart__marks";

export interface Stage {
  /** The owned overlay svg (built on first client use). */
  readonly root: SVGSVGElement;
  /** Its map-space group: the dot grid, then the highlight path. */
  readonly mapLayer: SVGGElement;
  /** Its plane-space group: the markers. */
  readonly markerLayer: SVGGElement;
  /** Its `<defs>`. */
  readonly defs: SVGDefsElement;
  /** Appends the overlay to `host` beside the renderer's `surface`. */
  readonly attach: (host: HTMLElement, surface: HTMLElement) => void;
  /** Removes the overlay and forgets the renderer's nodes. */
  readonly detach: () => void;
  /** Writes the map transform (camera ∘ zoom) on both map layers. */
  readonly setMap: (t: ViewTransform) => void;
  /** Writes the plane transform (planeCss) on both plane elements; "" is flat. */
  readonly setPlane: (css: string, layered: boolean) => void;
  /** After every renderer pass: re-applies the writes on the renderer's nodes (its svg and marks group may be new or patched). */
  readonly afterRender: () => void;
}

const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K, className?: string): SVGElementTagNameMap[K] => {
  const node = document.createElementNS(SVG_NS, tag);
  if (className !== undefined) {node.setAttribute("class", className);}
  return node;
};

interface Built {
  readonly root: SVGSVGElement;
  readonly defs: SVGDefsElement;
  readonly mapLayer: SVGGElement;
  readonly markerLayer: SVGGElement;
}

/** One stage per chart. Nothing touches the DOM until the overlay is first read (a chart is also rendered on a server). */
export function createStage(): Stage {
  let built: Built | null = null;
  let surface: HTMLElement | null = null;
  let svg: SVGSVGElement | null = null;
  let marks: SVGGElement | null = null;
  let mapCss = "";
  let planeCss = "";
  let planeLayered = false;
  const build = (): Built => {
    if (built) {return built;}
    const root = svgEl("svg", "bkm-choro-hl");
    root.setAttribute("aria-hidden", "true");
    const defs = svgEl("defs");
    const mapLayer = svgEl("g", "bkm-choro-hl-layer");
    const markerLayer = svgEl("g", "bkm-choro-markers");
    root.append(defs, mapLayer, markerLayer);
    built = { defs, mapLayer, markerLayer, root };
    return built;
  };
  /** The renderer's svg and marks group, found again when the renderer replaced them. */
  const rendererNodes = (): void => {
    if (surface === null) {return;}
    if (svg === null || !svg.isConnected) {
      svg = surface.querySelector("svg");
    }
    if (marks === null || !marks.isConnected) {
      // SAFETY: the renderer's marks layer is an svg <g>.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
      marks = (svg?.querySelector(MARKS_SELECTOR) ?? null) as SVGGElement | null;
    }
  };
  const writeTransform = (node: SVGElement | null, css: string): void => {
    if (node !== null && node.style.transform !== css) {node.style.transform = css;}
  };
  const writePlane = (node: SVGElement | null): void => {
    if (node === null) {return;}
    writeTransform(node, planeCss);
    // A tilt that moves every frame otherwise drops Chrome to a low-res raster until it settles (bklit's plane, choropleth-chart.tsx:421-423).
    const willChange = planeLayered ? "transform" : "";
    if (node.style.willChange !== willChange) {node.style.willChange = willChange;}
  };
  return {
    get root() { return build().root; },
    get mapLayer() { return build().mapLayer; },
    get markerLayer() { return build().markerLayer; },
    get defs() { return build().defs; },
    attach: (host, next) => {
      surface = next;
      svg = null;
      marks = null;
      host.append(build().root);
      rendererNodes();
    },
    detach: () => {
      built?.root.remove();
      surface = null;
      svg = null;
      marks = null;
    },
    setMap: (t) => {
      mapCss = transformCss(t);
      rendererNodes();
      writeTransform(marks, mapCss);
      writeTransform(built?.mapLayer ?? null, mapCss);
    },
    setPlane: (css, layered) => {
      planeCss = css;
      planeLayered = layered;
      rendererNodes();
      writePlane(svg);
      writePlane(built?.root ?? null);
    },
    afterRender: () => {
      rendererNodes();
      writeTransform(marks, mapCss);
      writePlane(svg);
    },
  };
}
