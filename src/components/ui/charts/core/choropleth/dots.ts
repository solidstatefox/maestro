import type { ChoroplethDotGridProps, ChoroplethDotLattice, ChoroplethFeature } from "../types/choropleth";
import { DEFAULT_COLORS } from "./projection";

const SVG_NS = "http://www.w3.org/2000/svg";

interface Dot {
  readonly x: number;
  readonly y: number;
  /** Feature index, or -1 for ocean. */
  readonly feature: number;
}

/**
 * One lattice over the whole map. Each dot belongs to the region its centre lands on (read from an index-coloured canvas) and is always
 * drawn whole: coastlines and borders never clip a dot.
 */
export function buildChoroplethLattice(featurePaths: readonly (string | null)[], width: number, height: number, gap: number, lattice: ChoroplethDotLattice): Dot[] {
  if (typeof document === "undefined" || width < 1 || height < 1 || gap < 1) {
    return [];
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width);
  canvas.height = Math.ceil(height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return [];
  }
  featurePaths.forEach((d, index) => {
    if (!d) {
      return;
    }
    const id = index + 1;
    ctx.fillStyle = `rgb(${id % 256},${Math.floor(id / 256) % 256},${Math.floor(id / 65_536)})`;
    ctx.fill(new Path2D(d));
  });
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const rowStep = lattice === "hex" ? gap * 0.866 : gap;
  const dots: Dot[] = [];
  let row = 0;
  for (let y = gap / 2; y < height; y += rowStep, row += 1) {
    const offset = lattice === "hex" && row % 2 === 1 ? gap / 2 : 0;
    for (let x = gap / 2 + offset; x < width; x += gap) {
      const p = (Math.floor(y) * canvas.width + Math.floor(x)) * 4;
      // Unpremultiplied: an anti-aliased edge pixel still carries its id.
      const id = (pixels[p + 3] ?? 0) === 0 ? 0 : (pixels[p] ?? 0) + (pixels[p + 1] ?? 0) * 256 + (pixels[p + 2] ?? 0) * 65_536;
      dots.push({ feature: id > 0 && id <= featurePaths.length ? id - 1 : -1, x, y });
    }
  }
  return dots;
}

/** A dot: a zero-length segment with a round cap, so its size is the path's `stroke-width`. */
const dot = (x: number, y: number): string => `M${Math.round(x * 100) / 100} ${Math.round(y * 100) / 100}h0`;

const clampSize = (size: number): number => Math.min(1, Math.max(0.05, size));

/** The dot grid's props with bklit's defaults. */
interface DotGridConfig {
  readonly gap: number;
  readonly base: number;
  readonly growth: number;
  readonly lattice: ChoroplethDotLattice;
  readonly showOcean: boolean;
  readonly oceanColor: string;
  readonly oceanOpacity: number;
  readonly oceanDotScale: number;
  readonly edgeFade: number;
  readonly hideOceanOnFocus: boolean;
  readonly fadedOpacity: number;
}

const configOf = (props: ChoroplethDotGridProps): DotGridConfig => {
  const base = clampSize(props.dotSize ?? 0.7);
  return {
    base,
    edgeFade: Math.min(45, Math.max(0, props.edgeFade ?? 12)),
    fadedOpacity: props.fadedOpacity ?? 0.4,
    gap: props.gap ?? 7,
    growth: clampSize(props.zoomDotSize ?? 0.9) - base,
    hideOceanOnFocus: props.hideOceanOnFocus ?? true,
    lattice: props.lattice ?? "hex",
    oceanColor: props.oceanColor ?? "var(--chart-scale-01)",
    oceanDotScale: props.oceanDotScale ?? 0.55,
    oceanOpacity: props.oceanOpacity ?? 0.55,
    showOcean: props.showOcean ?? true,
  };
};

const colorOf = (props: ChoroplethDotGridProps, feature: ChoroplethFeature | undefined, index: number): string => {
  if (props.fill !== undefined && props.fill !== "") {return props.fill;}
  if (feature !== undefined && props.getFeatureColor !== undefined) {return props.getFeatureColor(feature, index);}
  return DEFAULT_COLORS[index % DEFAULT_COLORS.length] ?? "var(--chart-1)";
};

const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Readonly<Record<string, string | number>>): SVGElementTagNameMap[K] => {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) {node.setAttribute(name, String(value));}
  return node;
};

/** The edge fade: a horizontal × vertical gradient mask in the map's own space (bklit's, choropleth-dot-grid.tsx:283-334). */
const fadeMask = (id: string, width: number, height: number, edge: number): SVGElement[] => {
  const stops = (): SVGStopElement[] => [[0, 0], [edge, 1], [100 - edge, 1], [100, 0]].map(([offset, opacity]) =>
    svgEl("stop", { offset: `${offset}%`, "stop-color": "white", "stop-opacity": opacity ?? 1 }));
  const h = svgEl("linearGradient", { id: `${id}-h`, x1: 0, x2: 1, y1: 0, y2: 0 });
  h.append(...stops());
  const v = svgEl("linearGradient", { id: `${id}-v`, x1: 0, x2: 0, y1: 0, y2: 1 });
  v.append(...stops());
  const box = { height, maskUnits: "userSpaceOnUse", width, x: 0, y: 0 };
  const hm = svgEl("mask", { ...box, id: `${id}-hm` });
  hm.append(svgEl("rect", { fill: `url(#${id}-h)`, height, width }));
  const m = svgEl("mask", { ...box, id });
  const g = svgEl("g", { mask: `url(#${id}-hm)` });
  g.append(svgEl("rect", { fill: `url(#${id}-v)`, height, width }));
  m.append(g);
  return [h, v, hm, m];
};

/** What the dot grid needs from its chart. */
export interface DotGridInput {
  readonly props: ChoroplethDotGridProps;
  readonly features: readonly ChoroplethFeature[];
  /** The base projection's path per feature (identity zoom). */
  readonly featurePaths: readonly (string | null)[];
  readonly width: number;
  readonly height: number;
  /** The camera's scale cap (`focusMaxZoom`): the dots reach `zoomDotSize` there. */
  readonly maxZoom: number;
}

export interface DotGrid {
  /** Builds (or rebuilds, on a new input) the grid in `layer`, before its other children; `defs` takes the edge mask. */
  readonly draw: (input: DotGridInput, layer: SVGGElement, defs: SVGDefsElement, uid: string) => void;
  /** Lights a region over the dimmed rest; null lights none. */
  readonly light: (index: number | null) => void;
  /** The camera's scale this frame: the land dots grow toward `zoomDotSize` at the cap. */
  readonly zoom: (cameraK: number) => void;
  readonly remove: () => void;
}

export function createDotGrid(): DotGrid {
  let root: SVGGElement | null = null;
  let mask: SVGElement[] = [];
  let land: SVGGElement | null = null;
  let lit: SVGPathElement | null = null;
  let config: DotGridConfig | null = null;
  let maxZoom = 1;
  let byFeature = new Map<number, { readonly d: string; readonly color: string }>();
  let lastWidth = "";
  let litIndex: number | null = null;
  const remove = (): void => {
    root?.remove();
    for (const node of mask) {node.remove();}
    root = null;
    land = null;
    lit = null;
    mask = [];
  };
  const landWidth = (cameraK: number): string => {
    if (config === null) {return "";}
    const { gap, base, growth } = config;
    // 0 at the overview, 1 at the camera's cap; the camera scales the layer, so the width is in map units.
    const progress = growth === 0 ? 0 : Math.min(1, Math.max(0, (cameraK - 1) / Math.max(0.01, maxZoom - 1)));
    return `${gap * (base + growth * progress)}px`;
  };
  const writeLit = (): void => {
    if (lit === null) {return;}
    const region = litIndex === null ? undefined : byFeature.get(litIndex);
    if (region === undefined) {
      lit.style.display = "none";
      return;
    }
    lit.setAttribute("d", region.d);
    lit.setAttribute("stroke", region.color);
    lit.style.display = "";
  };
  return {
    draw: ({ props, features, featurePaths, width, height, maxZoom: cap }, layer, defs, uid) => {
      remove();
      config = configOf(props);
      maxZoom = cap;
      const { gap, lattice, showOcean, oceanColor, oceanOpacity, oceanDotScale, edgeFade, base, fadedOpacity, hideOceanOnFocus } = config;
      const dots = buildChoroplethLattice(featurePaths, width, height, gap, lattice);
      const ocean: string[] = [];
      const regions = new Map<number, string[]>();
      for (const { x, y, feature } of dots) {
        if (feature < 0) {
          ocean.push(dot(x, y));
          continue;
        }
        const list = regions.get(feature);
        if (list) {list.push(dot(x, y));} else {regions.set(feature, [dot(x, y)]);}
      }
      byFeature = new Map();
      const byColor = new Map<string, string[]>();
      for (const [index, parts] of regions) {
        const color = colorOf(props, features[index], index);
        const d = parts.join("");
        byFeature.set(index, { color, d });
        const list = byColor.get(color);
        if (list) {list.push(d);} else {byColor.set(color, [d]);}
      }
      root = svgEl("g", { class: "bkm-choro-dots" });
      root.style.setProperty("--bkm-choro-dots-dim", String(fadedOpacity));
      const fadeId = `${uid}-dots-fade`;
      const body = svgEl("g", { "pointer-events": "none", ...(edgeFade > 0 ? { mask: `url(#${fadeId})` } : {}) });
      if (edgeFade > 0) {
        mask = fadeMask(fadeId, width, height, edgeFade);
        defs.append(...mask);
      }
      if (showOcean && ocean.length > 0) {
        const oceanPath = svgEl("path", { class: "bkm-choro-dots-ocean", d: ocean.join(""), fill: "none", opacity: oceanOpacity, stroke: oceanColor, "stroke-linecap": "round", "stroke-width": `${gap * base * oceanDotScale}px` });
        if (hideOceanOnFocus) {oceanPath.setAttribute("data-hide-on-focus", "");}
        body.append(oceanPath);
      }
      land = svgEl("g", { class: "bkm-choro-dots-land", fill: "none", "stroke-linecap": "round" });
      const rest = svgEl("g", { class: "bkm-choro-dots-regions" });
      for (const [color, parts] of byColor) {
        rest.append(svgEl("path", { d: parts.join(""), stroke: color }));
      }
      lit = svgEl("path", { class: "bkm-choro-dots-lit" });
      lit.style.display = "none";
      land.append(rest, lit);
      lastWidth = landWidth(1);
      land.style.strokeWidth = lastWidth;
      body.append(land);
      root.append(body);
      layer.prepend(root);
      writeLit();
    },
    light: (index) => {
      litIndex = index;
      writeLit();
    },
    remove,
    zoom: (cameraK) => {
      if (land === null || config === null || config.growth === 0) {return;}
      const next = landWidth(cameraK);
      if (next !== lastWidth) {
        lastWidth = next;
        land.style.strokeWidth = next;
      }
    },
  };
}
