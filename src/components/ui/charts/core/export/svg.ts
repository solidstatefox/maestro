import type { ChartExportOptions } from "../types/export";
import { exportColor, exportPaint } from "./colors";
import { embeddedFontFaces } from "./fonts";
import type { UsedFont } from "./fonts";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Never exported: tooltips, the hover-only layers (the cartesian overlay, the spatial lift), focus decoration, the export's own controls. */
const SKIP = [
  ".ts-chart-tooltip",
  "[role='tooltip']",
  "[data-bkm-tooltip]",
  ".bkm-hov",
  ".bkm-sp-lift",
  "[data-ts-focus-layer]",
  "[data-bkm-export-skip]",
].join(",");

/** Elements that never paint, or would replay in the file (a `<style>`'s keyframes, SMIL). */
const DROPPED = new Set(["script", "style", "template", "noscript", "link", "meta", "animate", "animateTransform", "animateMotion", "set"]);

/** Containers whose content is a resource, not painted where it sits: their elements' `display` doesn't hide them. */
const RESOURCES = new Set(["defs", "linearGradient", "radialGradient", "stop", "pattern", "clipPath", "mask", "marker", "symbol", "filter"]);

/** Inherited presentation properties: written where they differ from the parent's. */
const INHERITED = [
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-opacity",
  "stroke-width",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "text-anchor",
  "dominant-baseline",
  "letter-spacing",
  "word-spacing",
  "visibility",
  "shape-rendering",
  "text-rendering",
  "paint-order",
  "clip-rule",
] as const;

/** Presentation properties that aren't inherited, and their initial values: written where they differ from it. */
const OWN: Readonly<Record<string, string>> = {
  opacity: "1",
  "stop-color": "#000000",
  "stop-opacity": "1",
  "flood-color": "#000000",
  "flood-opacity": "1",
  "vector-effect": "none",
};

/** Inherited CSS that has no attribute: written to `style` where it differs from the parent's. */
const INHERITED_CSS = ["font-variant-numeric", "font-feature-settings"] as const;

/** Geometry the stylesheet can set (`r`, `rx`…): written as attributes where the computed value isn't the attribute's. */
const GEOMETRY: Readonly<Record<string, readonly string[]>> = {
  circle: ["cx", "cy", "r"],
  ellipse: ["cx", "cy", "rx", "ry"],
  rect: ["x", "y", "width", "height", "rx", "ry"],
};

const PX = /px/g;
const DOUBLE_QUOTE = /"/g;
const SPACE_RUN = /\s+/g;

type Values = Record<string, string>;

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const round = (value: number): number => Math.round(value * 100) / 100;

const num = (value: number): string => String(round(value));

/** The intersection of two boxes (an empty one when they don't meet). */
const intersect = (a: Box, b: Box): Box => {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return { x, y, width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x), height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y) };
};

const sameBox = (a: Box | null, b: Box | null): boolean =>
  a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height);

/** A 2D matrix as an SVG `transform`. */
const matrixText = (m: DOMMatrix): string => `matrix(${[m.a, m.b, m.c, m.d, m.e, m.f].map((value) => String(Math.round(value * 10000) / 10000)).join(" ")})`;

/** An element's parent, through a shadow root to its host. */
const parentOf = (node: Node): Element | null => {
  if (node.parentElement !== null) {
    return node.parentElement;
  }
  const root = node.getRootNode();
  return "host" in root ? (root as ShadowRoot).host : null;
};

/** One export: the element, its box, what it found so far. */
class Exporter {
  readonly doc: Document;
  readonly view: Window;
  readonly origin: DOMRect;
  readonly out: SVGSVGElement;
  readonly fonts: UsedFont[] = [];
  private readonly opacities = new Map<Element, number>();
  private readonly clips = new Map<Element, Box | null>();
  private readonly clipIds = new Map<string, string>();
  private group: { readonly clip: Box | null; readonly node: Element } | null = null;
  private ids = 0;
  private measure: CanvasRenderingContext2D | null | undefined;
  readonly defs: SVGDefsElement;
  readonly root: Element;

  constructor(root: Element) {
    this.root = root;
    this.doc = root.ownerDocument;
    const view = this.doc.defaultView;
    if (view === null) {
      throw new Error("Chart export needs a browser document.");
    }
    this.view = view;
    this.origin = root.getBoundingClientRect();
    this.out = this.svg("svg") as SVGSVGElement;
    this.defs = this.svg("defs") as SVGDefsElement;
    this.out.append(this.defs);
  }

  svg(tag: string): SVGElement {
    return this.doc.createElementNS(SVG_NS, tag);
  }

  id(kind: string): string {
    this.ids += 1;
    return `bkm-export-${kind}-${this.ids}`;
  }

  style(element: Element): CSSStyleDeclaration {
    return this.view.getComputedStyle(element);
  }

  /** A client rect in the file's coordinates. */
  local(rect: DOMRect): Box {
    return { x: rect.left - this.origin.left, y: rect.top - this.origin.top, width: rect.width, height: rect.height };
  }

  /** The opacity an HTML element and its ancestors up to the root give what it holds. */
  opacity(element: Element | null): number {
    if (element === null) {
      return 1;
    }
    const known = this.opacities.get(element);
    if (known !== undefined) {
      return known;
    }
    const own = Number.parseFloat(this.style(element).opacity) || 0;
    const value = element === this.root ? own : own * this.opacity(parentOf(element));
    this.opacities.set(element, value);
    return value;
  }

  /** The box the page clips an HTML element's content to: its clipping ancestors' padding boxes (the root's is the file's edge). */
  clip(element: Element | null): Box | null {
    if (element === null || element === this.root) {
      return null;
    }
    const known = this.clips.get(element);
    if (known !== undefined) {
      return known;
    }
    const outer = this.clip(parentOf(element));
    const css = this.style(element);
    let box = outer;
    if (css.overflowX !== "visible" || css.overflowY !== "visible" || css.contain.includes("paint")) {
      const rect = this.local(element.getBoundingClientRect());
      const left = Number.parseFloat(css.borderLeftWidth) || 0;
      const top = Number.parseFloat(css.borderTopWidth) || 0;
      const own: Box = {
        x: rect.x + left,
        y: rect.y + top,
        width: Math.max(0, rect.width - left - (Number.parseFloat(css.borderRightWidth) || 0)),
        height: Math.max(0, rect.height - top - (Number.parseFloat(css.borderBottomWidth) || 0)),
      };
      box = outer === null ? own : intersect(outer, own);
    }
    this.clips.set(element, box);
    return box;
  }

  /** Appends a piece of the file, inside a group clipped as the page clips it. */
  place(node: Element, clip: Box | null): void {
    if (clip === null) {
      this.group = null;
      this.out.append(node);
      return;
    }
    if (this.group === null || !sameBox(this.group.clip, clip)) {
      const key = `${clip.x},${clip.y},${clip.width},${clip.height}`;
      let id = this.clipIds.get(key);
      if (id === undefined) {
        id = this.id("clip");
        this.clipIds.set(key, id);
        const path = this.svg("clipPath");
        path.setAttribute("id", id);
        const rect = this.svg("rect");
        rect.setAttribute("x", num(clip.x));
        rect.setAttribute("y", num(clip.y));
        rect.setAttribute("width", num(clip.width));
        rect.setAttribute("height", num(clip.height));
        path.append(rect);
        this.defs.append(path);
      }
      const group = this.svg("g");
      group.setAttribute("clip-path", `url(#${id})`);
      this.out.append(group);
      this.group = { clip, node: group };
    }
    this.group.node.append(node);
  }

  // --- Svgs ---------------------------------------------------------------------------------------------------------------------------

  /** A colour property's value and alpha, a paint's url as it is. */
  private paint(value: string): { readonly value: string; readonly alpha: number } {
    return exportPaint(this.doc, value);
  }

  /** The presentation an element's computed style gives it, as attribute values (colours resolved, alphas into the opacities). */
  values(css: CSSStyleDeclaration): Values {
    const values: Values = {};
    for (const name of INHERITED) {
      values[name] = css.getPropertyValue(name).trim();
    }
    const fill = this.paint(values.fill ?? "");
    values.fill = fill.value;
    values["fill-opacity"] = num((Number.parseFloat(values["fill-opacity"] ?? "1") || 0) * fill.alpha);
    const stroke = this.paint(values.stroke ?? "");
    values.stroke = stroke.value;
    values["stroke-opacity"] = num((Number.parseFloat(values["stroke-opacity"] ?? "1") || 0) * stroke.alpha);
    for (const name of ["stroke-width", "stroke-dasharray", "stroke-dashoffset"]) {
      values[name] = (values[name] ?? "").replace(PX, "");
    }
    values["font-family"] = (values["font-family"] ?? "").replace(DOUBLE_QUOTE, "'");
    for (const name of INHERITED_CSS) {
      values[name] = css.getPropertyValue(name).trim();
    }
    values.opacity = num(Number.parseFloat(css.opacity) || 0);
    for (const [color, alpha] of [
      ["stop-color", "stop-opacity"],
      ["flood-color", "flood-opacity"],
    ] as const) {
      const resolved = exportColor(this.doc, css.getPropertyValue(color));
      values[color] = resolved?.hex ?? "#000000";
      values[alpha] = num((Number.parseFloat(css.getPropertyValue(alpha)) || 0) * (resolved?.alpha ?? 1));
    }
    values["vector-effect"] = css.getPropertyValue("vector-effect").trim() || "none";
    return values;
  }

  /** The element's CSS transform with `translate`, `rotate` and `scale` (before its origin), or null without one. */
  private cssMatrix(css: CSSStyleDeclaration): DOMMatrix | null {
    const individual = [css.translate, css.rotate, css.scale].some((value) => value !== "" && value !== "none");
    if ((css.transform === "none" || css.transform === "") && !individual) {
      return null;
    }
    const Matrix = DOMMatrix;
    let matrix = new Matrix();
    if (css.translate !== "" && css.translate !== "none") {
      const [x = "0", y = "0"] = css.translate.split(" ");
      matrix = matrix.translate(Number.parseFloat(x) || 0, Number.parseFloat(y) || 0);
    }
    if (css.rotate !== "" && css.rotate !== "none") {
      const angle = css.rotate.split(" ").at(-1) ?? "0deg";
      const degrees = angle.endsWith("rad") ? (Number.parseFloat(angle) * 180) / Math.PI : angle.endsWith("turn") ? Number.parseFloat(angle) * 360 : Number.parseFloat(angle);
      matrix = matrix.rotate(degrees || 0);
    }
    if (css.scale !== "" && css.scale !== "none") {
      const [sx = "1", sy = sx] = css.scale.split(" ");
      matrix = matrix.scale(Number.parseFloat(sx), Number.parseFloat(sy));
    }
    if (css.transform !== "none" && css.transform !== "") {
      matrix = matrix.multiply(new Matrix(css.transform));
    }
    return matrix;
  }

  /** The element's CSS transform around its origin, as one 2D matrix in its user space. */
  private transform(element: SVGElement, css: CSSStyleDeclaration): string | null {
    const matrix = this.cssMatrix(css);
    if (matrix === null) {
      return null;
    }
    const Matrix = DOMMatrix;
    const [ox = "0", oy = "0"] = css.transformOrigin.split(" ");
    let bx = 0;
    let by = 0;
    if (css.transformBox === "fill-box" || css.transformBox === "stroke-box" || css.transformBox === "content-box" || css.transformBox === "border-box") {
      try {
        const box = (element as SVGGraphicsElement).getBBox();
        bx = box.x;
        by = box.y;
      } catch {
        // Not rendered: no box, the origin stays the user space's.
      }
    } else {
      const viewBox = (element as SVGGraphicsElement).ownerSVGElement?.viewBox?.baseVal;
      bx = viewBox?.x ?? 0;
      by = viewBox?.y ?? 0;
    }
    const x = bx + (Number.parseFloat(ox) || 0);
    const y = by + (Number.parseFloat(oy) || 0);
    return matrixText(new Matrix().translate(x, y).multiply(matrix).translate(-x, -y));
  }

  /**
   * An svg's own box without its CSS transform, measured with it lifted for the read (and its transition, so lifting it starts none):
   * the transform is then written around the clone (2D) or left out (a 3D camera tilt, which no SVG transform can draw: the chart is
   * exported head-on).
   */
  private untransformed(svg: SVGSVGElement): DOMRect {
    const style = svg.style;
    const names = ["transition", "transform", "translate", "rotate", "scale"];
    const saved = names.map((name) => [name, style.getPropertyValue(name), style.getPropertyPriority(name)] as const);
    for (const name of names) {
      style.setProperty(name, "none", "important");
    }
    const rect = svg.getBoundingClientRect();
    for (const [name, value, priority] of [...saved].reverse()) {
      if (name === "transition") {
        // Restored once the transform is back (read, so the style is resolved without one), so no transition runs.
        svg.getBoundingClientRect();
      }
      if (value === "") {
        style.removeProperty(name);
      } else {
        style.setProperty(name, value, priority);
      }
    }
    if (style.length === 0) {
      svg.removeAttribute("style");
    }
    return rect;
  }

  /** What the stylesheet gives one cloned element, written onto the clone; then its children. False when it isn't exported (removed). */
  inline(source: Element, clone: Element, parent: Values, root: boolean): boolean {
    const tag = source.localName;
    if (DROPPED.has(tag) || source.matches(SKIP)) {
      clone.remove();
      return false;
    }
    const css = this.style(source);
    if (css.display === "none" && !RESOURCES.has(tag) && source.closest("defs, clipPath, mask, pattern, marker, symbol") === null) {
      clone.remove();
      return false;
    }
    const values = this.values(css);
    if (values["vector-effect"] === "non-scaling-stroke") {
      // A stroke held at its screen width (in screen pixels, which the file has none of: it is drawn at any size) is written at the
      // width that gives in its user space: what the page shows, scaled with the file.
      const matrix = (source as SVGGraphicsElement).getScreenCTM?.();
      const scale = matrix ? Math.sqrt(Math.abs(matrix.a * matrix.d - matrix.b * matrix.c)) : 1;
      if (scale > 0 && Math.abs(scale - 1) > 0.001) {
        values["stroke-width"] = num((Number.parseFloat(values["stroke-width"] ?? "1") || 0) / scale);
        if (values["stroke-dasharray"] !== "none") {
          values["stroke-dasharray"] = (values["stroke-dasharray"] ?? "")
            .split(/[\s,]+/)
            .filter(Boolean)
            .map((dash) => num((Number.parseFloat(dash) || 0) / scale))
            .join(" ");
        }
      }
      values["vector-effect"] = "none";
      clone.removeAttribute("vector-effect");
    }
    for (const name of INHERITED) {
      if (root || clone.hasAttribute(name) || values[name] !== parent[name]) {
        clone.setAttribute(name, values[name] ?? "");
      }
    }
    for (const [name, initial] of Object.entries(OWN)) {
      if (clone.hasAttribute(name) || values[name] !== initial) {
        clone.setAttribute(name, values[name] ?? initial);
      }
    }
    const styles: string[] = [];
    for (const name of INHERITED_CSS) {
      if (values[name] !== (parent[name] ?? "normal") && values[name] !== "") {
        styles.push(`${name}:${values[name]}`);
      }
    }
    for (const name of GEOMETRY[tag] ?? []) {
      const computed = css.getPropertyValue(name).trim();
      const attribute = clone.getAttribute(name);
      if (computed.endsWith("px") && (attribute === null || (!attribute.includes("%") && Math.abs(Number.parseFloat(attribute) - Number.parseFloat(computed)) > 0.01))) {
        clone.setAttribute(name, computed.replace(PX, ""));
      }
    }
    if (!root) {
      const transform = this.transform(source as SVGElement, css);
      if (transform !== null) {
        clone.setAttribute("transform", transform);
      }
    }
    const clipPath = css.clipPath;
    if (clipPath !== "" && clipPath !== "none") {
      if (clipPath.startsWith("url(")) {
        clone.setAttribute("clip-path", this.paint(clipPath).value);
      } else {
        styles.push(`clip-path:${clipPath}`);
      }
    }
    const filter = css.filter;
    if (filter !== "" && filter !== "none") {
      if (filter.startsWith("url(") && !filter.includes(") ")) {
        clone.setAttribute("filter", this.paint(filter).value);
      } else {
        styles.push(`filter:${filter}`);
      }
    }
    const maskImage = css.getPropertyValue("mask-image") || css.getPropertyValue("-webkit-mask-image");
    if (maskImage !== "" && maskImage !== "none") {
      if (maskImage.startsWith("url(") && maskImage.includes("#") && !maskImage.includes("data:")) {
        clone.setAttribute("mask", this.paint(maskImage).value);
      } else {
        for (const name of ["mask-image", "mask-size", "mask-position", "mask-repeat", "mask-origin", "mask-clip", "mask-mode", "mask-composite"]) {
          const value = css.getPropertyValue(name) || css.getPropertyValue(`-webkit-${name}`);
          if (value !== "") {
            styles.push(`${name}:${value}`, `-webkit-${name}:${value}`);
          }
        }
      }
    }
    if (css.mixBlendMode !== "" && css.mixBlendMode !== "normal") {
      styles.push(`mix-blend-mode:${css.mixBlendMode}`);
    }
    clone.removeAttribute("class");
    clone.removeAttribute("style");
    clone.removeAttribute("tabindex");
    if (styles.length > 0) {
      clone.setAttribute("style", styles.join(";"));
    }
    if (tag === "text") {
      this.fonts.push({ family: css.fontFamily, weight: css.fontWeight, style: css.fontStyle, text: source.textContent ?? "" });
    }
    const sources = [...source.children];
    const clones = [...clone.children];
    sources.forEach((child, index) => {
      const copy = clones[index];
      if (copy !== undefined) {
        this.inline(child, copy, values, false);
      }
    });
    return true;
  }

  /** An svg of the page, cloned into the file where it sits. */
  emitSvg(svg: SVGSVGElement): void {
    const parent = parentOf(svg);
    const clone = svg.cloneNode(true) as SVGSVGElement;
    if (!this.inline(svg, clone, this.values(this.style(parent ?? svg)), true)) {
      return;
    }
    const css = this.style(svg);
    const own = this.cssMatrix(css);
    const rect = own === null ? svg.getBoundingClientRect() : this.untransformed(svg);
    const box = this.local(rect);
    // Its size on the page (an ancestor's CSS scale shows as the rect's size, which the viewBox then fills).
    const width = rect.width > 0 ? rect.width : svg.clientWidth;
    const height = rect.height > 0 ? rect.height : svg.clientHeight;
    clone.setAttribute("x", num(box.x));
    clone.setAttribute("y", num(box.y));
    clone.setAttribute("width", num(width));
    clone.setAttribute("height", num(height));
    if (!clone.hasAttribute("viewBox") && svg.clientWidth > 0 && svg.clientHeight > 0 && (Math.abs(svg.clientWidth - width) > 0.5 || Math.abs(svg.clientHeight - height) > 0.5)) {
      clone.setAttribute("viewBox", `0 0 ${svg.clientWidth} ${svg.clientHeight}`);
    }
    clone.setAttribute("overflow", css.overflowX === "visible" && css.overflowY === "visible" ? "visible" : "hidden");
    for (const name of ["focusable", "aria-roledescription", "data-ts-motion-state", "data-ts-motion-progress"]) {
      clone.removeAttribute(name);
    }
    let node: Element = clone;
    if (own?.is2D === true) {
      const [ox = "0", oy = "0"] = css.transformOrigin.split(" ");
      const x = box.x + (Number.parseFloat(ox) || 0);
      const y = box.y + (Number.parseFloat(oy) || 0);
      node = this.svg("g");
      node.setAttribute("transform", matrixText(new DOMMatrix().translate(x, y).multiply(own).translate(-x, -y)));
      node.append(clone);
    }
    const opacity = this.opacity(parent);
    if (opacity < 1) {
      const group = this.svg("g");
      group.setAttribute("opacity", num(opacity));
      group.append(node);
      node = group;
    }
    this.place(node, this.clip(parent));
  }

  // --- HTML -------------------------------------------------------------------------------------------------------------------------

  /** A CSS `linear-gradient()` as an svg gradient in the file's defs (its id), or null for any other image. */
  private gradient(image: string): string | null {
    const match = /^linear-gradient\(([\s\S]*)\)$/.exec(image.trim());
    if (match === null) {
      return null;
    }
    const parts: string[] = [];
    let depth = 0;
    let current = "";
    for (const char of match[1] as string) {
      if (char === "(") {
        depth += 1;
      } else if (char === ")") {
        depth -= 1;
      }
      if (char === "," && depth === 0) {
        parts.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    parts.push(current.trim());
    let degrees = 180;
    const first = parts[0] ?? "";
    if (first.startsWith("to ")) {
      const sides = first.slice(3).split(" ");
      const x = sides.includes("right") ? 1 : sides.includes("left") ? -1 : 0;
      const y = sides.includes("bottom") ? 1 : sides.includes("top") ? -1 : 0;
      degrees = (Math.atan2(x, -y) * 180) / Math.PI;
      parts.shift();
    } else if (/^-?[\d.]+(deg|turn|rad|grad)$/.test(first)) {
      const value = Number.parseFloat(first);
      degrees = first.endsWith("turn") ? value * 360 : first.endsWith("rad") && !first.endsWith("grad") ? (value * 180) / Math.PI : first.endsWith("grad") ? value * 0.9 : value;
      parts.shift();
    }
    const radians = (degrees * Math.PI) / 180;
    const dx = Math.sin(radians) / 2;
    const dy = -Math.cos(radians) / 2;
    const gradient = this.svg("linearGradient");
    const id = this.id("gradient");
    gradient.setAttribute("id", id);
    gradient.setAttribute("x1", num(0.5 - dx));
    gradient.setAttribute("y1", num(0.5 - dy));
    gradient.setAttribute("x2", num(0.5 + dx));
    gradient.setAttribute("y2", num(0.5 + dy));
    parts.forEach((part, index) => {
      const position = /\s(-?[\d.]+%)$/.exec(part);
      const color = exportColor(this.doc, position === null ? part : part.slice(0, position.index));
      if (color === null) {
        return;
      }
      const stop = this.svg("stop");
      stop.setAttribute("offset", position?.[1] ?? num(parts.length > 1 ? index / (parts.length - 1) : 0));
      stop.setAttribute("stop-color", color.hex);
      if (color.alpha < 1) {
        stop.setAttribute("stop-opacity", num(color.alpha));
      }
      gradient.append(stop);
    });
    this.defs.append(gradient);
    return id;
  }

  /** An HTML element's painted box: its background (colour or linear gradient) and its borders. */
  emitBox(element: Element, css: CSSStyleDeclaration): void {
    const background = exportColor(this.doc, css.backgroundColor);
    const gradient = css.backgroundImage.startsWith("linear-gradient(") ? this.gradient(css.backgroundImage) : null;
    const widths = [css.borderTopWidth, css.borderRightWidth, css.borderBottomWidth, css.borderLeftWidth].map((width) => Number.parseFloat(width) || 0);
    const styles = [css.borderTopStyle, css.borderRightStyle, css.borderBottomStyle, css.borderLeftStyle];
    const colors = [css.borderTopColor, css.borderRightColor, css.borderBottomColor, css.borderLeftColor].map((color) => exportColor(this.doc, color));
    const sides = widths.map((width, index) => width > 0 && styles[index] !== "none" && styles[index] !== "hidden" && (colors[index]?.alpha ?? 0) > 0);
    const filled = gradient !== null || (background !== null && background.alpha > 0);
    if (!(filled || sides.some(Boolean))) {
      return;
    }
    const opacity = this.opacity(element);
    if (opacity <= 0) {
      return;
    }
    const box = this.local(element.getBoundingClientRect());
    if (box.width <= 0 || box.height <= 0) {
      return;
    }
    const radiusOf = (value: string, size: number) => (value.endsWith("%") ? (Number.parseFloat(value) / 100) * size : Number.parseFloat(value) || 0);
    const rx = Math.min(radiusOf(css.borderTopLeftRadius, box.width), box.width / 2);
    const ry = Math.min(radiusOf(css.borderTopLeftRadius.split(" ").at(-1) ?? "0", box.height), box.height / 2);
    const clip = this.clip(parentOf(element));
    const rect = (x: number, y: number, width: number, height: number): Element => {
      const node = this.svg("rect");
      node.setAttribute("x", num(x));
      node.setAttribute("y", num(y));
      node.setAttribute("width", num(width));
      node.setAttribute("height", num(height));
      if (rx > 0) {
        node.setAttribute("rx", num(rx));
        node.setAttribute("ry", num(ry));
      }
      return node;
    };
    if (filled) {
      const node = rect(box.x, box.y, box.width, box.height);
      if (gradient === null) {
        node.setAttribute("fill", background?.hex ?? "none");
        node.setAttribute("fill-opacity", num((background?.alpha ?? 1) * opacity));
      } else {
        node.setAttribute("fill", `url(#${gradient})`);
        if (opacity < 1) {
          node.setAttribute("fill-opacity", num(opacity));
        }
      }
      this.place(node, clip);
    }
    const uniform = sides.every(Boolean) && widths.every((width) => width === widths[0]) && colors.every((color) => color?.hex === colors[0]?.hex && color?.alpha === colors[0]?.alpha);
    if (uniform) {
      const width = widths[0] as number;
      const node = rect(box.x + width / 2, box.y + width / 2, box.width - width, box.height - width);
      node.setAttribute("fill", "none");
      node.setAttribute("stroke", colors[0]?.hex ?? "none");
      node.setAttribute("stroke-opacity", num((colors[0]?.alpha ?? 1) * opacity));
      node.setAttribute("stroke-width", num(width));
      if (styles[0] === "dashed" || styles[0] === "dotted") {
        node.setAttribute("stroke-dasharray", styles[0] === "dashed" ? `${num(width * 3)} ${num(width * 2)}` : `${num(width)} ${num(width)}`);
      }
      this.place(node, clip);
      return;
    }
    // Each painted side on its own, along the box's edge.
    const edges: readonly (readonly [number, number, number, number])[] = [
      [box.x, box.y + (widths[0] ?? 0) / 2, box.x + box.width, box.y + (widths[0] ?? 0) / 2],
      [box.x + box.width - (widths[1] ?? 0) / 2, box.y, box.x + box.width - (widths[1] ?? 0) / 2, box.y + box.height],
      [box.x, box.y + box.height - (widths[2] ?? 0) / 2, box.x + box.width, box.y + box.height - (widths[2] ?? 0) / 2],
      [box.x + (widths[3] ?? 0) / 2, box.y, box.x + (widths[3] ?? 0) / 2, box.y + box.height],
    ];
    edges.forEach(([x1, y1, x2, y2], index) => {
      if (!sides[index]) {
        return;
      }
      const line = this.svg("line");
      line.setAttribute("x1", num(x1));
      line.setAttribute("y1", num(y1));
      line.setAttribute("x2", num(x2));
      line.setAttribute("y2", num(y2));
      line.setAttribute("stroke", colors[index]?.hex ?? "none");
      line.setAttribute("stroke-opacity", num((colors[index]?.alpha ?? 1) * opacity));
      line.setAttribute("stroke-width", num(widths[index] ?? 0));
      if (styles[index] === "dashed") {
        line.setAttribute("stroke-dasharray", `${num((widths[index] ?? 1) * 3)} ${num((widths[index] ?? 1) * 2)}`);
      }
      this.place(line, clip);
    });
  }

  /** A font's ascent and descent as the page lays it out (the canvas measures with the page's loaded fonts). */
  private metrics(css: CSSStyleDeclaration, text: string): { readonly ascent: number; readonly descent: number } {
    if (this.measure === undefined) {
      this.measure = this.doc.createElement("canvas").getContext("2d");
    }
    const size = Number.parseFloat(css.fontSize) || 16;
    if (this.measure === null) {
      return { ascent: size * 0.8, descent: size * 0.2 };
    }
    this.measure.font = `${css.fontStyle} ${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
    const measured = this.measure.measureText(text);
    return {
      ascent: measured.fontBoundingBoxAscent || measured.actualBoundingBoxAscent || size * 0.8,
      descent: measured.fontBoundingBoxDescent || measured.actualBoundingBoxDescent || size * 0.2,
    };
  }

  /** One run of text as the page lays it out: a `<text>` on its baseline, in its font and colour. */
  private textAt(text: string, rect: DOMRect, css: CSSStyleDeclaration, opacity: number, clip: Box | null): void {
    const color = exportColor(this.doc, css.color);
    if (color === null || color.alpha * opacity <= 0) {
      return;
    }
    const box = this.local(rect);
    const { ascent, descent } = this.metrics(css, text);
    const node = this.svg("text");
    const rtl = css.direction === "rtl";
    node.setAttribute("x", num(rtl ? box.x + box.width : box.x));
    node.setAttribute("y", num(box.y + (box.height - ascent - descent) / 2 + ascent));
    if (rtl) {
      node.setAttribute("text-anchor", "end");
    }
    node.setAttribute("fill", color.hex);
    if (color.alpha * opacity < 1) {
      node.setAttribute("fill-opacity", num(color.alpha * opacity));
    }
    node.setAttribute("font-family", css.fontFamily.replace(DOUBLE_QUOTE, "'"));
    node.setAttribute("font-size", css.fontSize);
    node.setAttribute("font-weight", css.fontWeight);
    if (css.fontStyle !== "normal") {
      node.setAttribute("font-style", css.fontStyle);
    }
    if (css.letterSpacing !== "normal" && css.letterSpacing !== "0px") {
      node.setAttribute("letter-spacing", css.letterSpacing);
    }
    const styles = INHERITED_CSS.map((name) => [name, css.getPropertyValue(name)] as const).filter(([, value]) => value !== "" && value !== "normal");
    if (styles.length > 0) {
      node.setAttribute("style", styles.map(([name, value]) => `${name}:${value}`).join(";"));
    }
    if (/\s\s/.test(text)) {
      node.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve");
    }
    node.textContent = text;
    this.fonts.push({ family: css.fontFamily, weight: css.fontWeight, style: css.fontStyle, text });
    this.place(node, clip);
  }

  /** A text node of the HTML: each line it lays out on, as a `<text>`. */
  emitText(node: Text, parent: Element): void {
    const raw = node.data;
    const first = raw.search(/\S/);
    if (first === -1) {
      return;
    }
    // NumberFlow's digit columns: only the digit shown isn't `inert` (the others roll by, masked).
    if (node.getRootNode() !== this.doc && parent.closest("[inert]") !== null) {
      return;
    }
    const css = this.style(parent);
    if (css.visibility !== "visible") {
      return;
    }
    const opacity = this.opacity(parent);
    if (opacity <= 0) {
      return;
    }
    const last = raw.length - (raw.length - raw.trimEnd().length);
    const range = this.doc.createRange();
    range.setStart(node, first);
    range.setEnd(node, last);
    const rects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
    if (rects.length === 0) {
      return;
    }
    const pre = css.whiteSpace.startsWith("pre") || css.whiteSpace === "break-spaces";
    const transform = (text: string): string => {
      const collapsed = pre ? text : text.replace(SPACE_RUN, " ");
      switch (css.textTransform) {
        case "uppercase":
          return collapsed.toUpperCase();
        case "lowercase":
          return collapsed.toLowerCase();
        case "capitalize":
          return collapsed.replace(/(^|\s)(\p{L})/gu, (_match, space: string, letter: string) => space + letter.toUpperCase());
        default:
          return collapsed;
      }
    };
    const clip = this.clip(parent);
    const lines = new Set(rects.map((rect) => Math.round(rect.top)));
    if (lines.size === 1) {
      const left = Math.min(...rects.map((rect) => rect.left));
      const right = Math.max(...rects.map((rect) => rect.right));
      const top = rects[0] as DOMRect;
      this.textAt(transform(raw.slice(first, last)), new DOMRect(left, top.top, right - left, top.height), css, opacity, clip);
      return;
    }
    // Wrapped: the characters grouped by the line each lays out on.
    let start = first;
    let lineTop: number | null = null;
    let lineRect: DOMRect | null = null;
    const flush = (end: number): void => {
      if (lineRect !== null) {
        const text = raw.slice(start, end).trim();
        if (text !== "") {
          this.textAt(transform(text), lineRect, css, opacity, clip);
        }
      }
    };
    for (let index = first; index < last; index += 1) {
      range.setStart(node, index);
      range.setEnd(node, index + 1);
      const rect = range.getBoundingClientRect();
      if (rect.height === 0) {
        continue;
      }
      const top = Math.round(rect.top);
      if (lineTop === null || Math.abs(top - lineTop) > 1) {
        flush(index);
        start = index;
        lineTop = top;
        lineRect = rect;
      } else if (lineRect !== null) {
        lineRect = new DOMRect(lineRect.left, lineRect.top, rect.right - lineRect.left, lineRect.height);
      }
    }
    flush(last);
  }

  /** An `<img>` or `<canvas>`, as an `<image>` holding its pixels (left out when another origin taints them). */
  emitImage(element: HTMLImageElement | HTMLCanvasElement): void {
    const box = this.local(element.getBoundingClientRect());
    if (box.width <= 0 || box.height <= 0) {
      return;
    }
    let href: string;
    try {
      if (element.localName === "canvas") {
        href = (element as HTMLCanvasElement).toDataURL("image/png");
      } else {
        const image = element as HTMLImageElement;
        if (!image.complete || image.naturalWidth === 0) {
          return;
        }
        const canvas = this.doc.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        canvas.getContext("2d")?.drawImage(image, 0, 0);
        href = canvas.toDataURL("image/png");
      }
    } catch {
      return;
    }
    const node = this.svg("image");
    node.setAttribute("href", href);
    node.setAttribute("x", num(box.x));
    node.setAttribute("y", num(box.y));
    node.setAttribute("width", num(box.width));
    node.setAttribute("height", num(box.height));
    node.setAttribute("preserveAspectRatio", "none");
    const opacity = this.opacity(element);
    if (opacity < 1) {
      node.setAttribute("opacity", num(opacity));
    }
    this.place(node, this.clip(parentOf(element)));
  }

  /** The root's subtree in paint order (document order, shadow trees and their slots included). */
  walk(element: Element): void {
    if (element.matches(SKIP) || DROPPED.has(element.localName)) {
      return;
    }
    if (element.namespaceURI === SVG_NS) {
      if (element.localName === "svg") {
        this.emitSvg(element as SVGSVGElement);
      }
      return;
    }
    const css = this.style(element);
    if (css.display === "none") {
      return;
    }
    if (element !== this.root && css.visibility === "visible") {
      this.emitBox(element, css);
    }
    if (element.localName === "img" || element.localName === "canvas") {
      this.emitImage(element as HTMLImageElement);
      return;
    }
    const nodes = element.shadowRoot === null ? [...element.childNodes] : [...element.shadowRoot.childNodes];
    for (const node of nodes) {
      this.visit(node, element);
    }
  }

  private visit(node: Node, parent: Element): void {
    if (node.nodeType === 3) {
      this.emitText(node as Text, parent);
    } else if (node.nodeType === 1) {
      const element = node as Element;
      if (element.localName === "slot") {
        for (const assigned of (element as HTMLSlotElement).assignedNodes({ flatten: true })) {
          this.visit(assigned, assigned.parentElement ?? parent);
        }
        return;
      }
      this.walk(element);
    }
  }
}

/** The background the chart is exported on: the option's colour, or the nearest painted ancestor's (the root's own included). */
const backgroundOf = (root: Element, option: string | undefined): { readonly hex: string; readonly alpha: number } | null => {
  const doc = root.ownerDocument;
  const view = doc.defaultView;
  if (view === null || option === "transparent") {
    return null;
  }
  if (option !== undefined) {
    // Resolved where the chart is, so a theme variable (`var(--card)`) reads as the chart's surface does.
    const probe = doc.createElement("span");
    probe.style.color = option;
    probe.style.display = "none";
    root.append(probe);
    const color = exportColor(doc, view.getComputedStyle(probe).color);
    probe.remove();
    return color;
  }
  for (let element: Element | null = root; element !== null; element = parentOf(element)) {
    const color = exportColor(doc, view.getComputedStyle(element).backgroundColor);
    if (color !== null && color.alpha > 0) {
      return color;
    }
  }
  return null;
};

/** The chart's own name: the option's title, or the first labelled chart's label. */
const titleOf = (root: Element, option: string | undefined): string | undefined =>
  option ?? root.querySelector("[role='img'][aria-label]")?.getAttribute("aria-label") ?? (root.getAttribute("aria-label") || undefined);

/** What `chartSvg` returns: the file's text and its size in CSS pixels. */
export interface ChartSvg {
  readonly svg: string;
  readonly width: number;
  readonly height: number;
  readonly title: string | undefined;
}

/** `root` and everything drawn in it, as one standalone SVG file. Call it with the chart at rest (settle.ts) for a tooltip-free file. */
export async function chartSvg(root: Element, options: Pick<ChartExportOptions, "background" | "embedFonts" | "label"> = {}): Promise<ChartSvg> {
  const exporter = new Exporter(root);
  const { width, height } = exporter.origin;
  if (!(width > 0 && height > 0)) {
    throw new Error("Chart export: the element has no size (is it rendered?).");
  }
  const out = exporter.out;
  out.setAttribute("xmlns", SVG_NS);
  out.setAttribute("width", num(width));
  out.setAttribute("height", num(height));
  out.setAttribute("viewBox", `0 0 ${num(width)} ${num(height)}`);
  out.setAttribute("role", "img");
  const title = titleOf(root, options.label);
  if (title !== undefined) {
    out.setAttribute("aria-label", title);
    const node = exporter.svg("title");
    node.textContent = title;
    out.prepend(node);
  }
  const background = backgroundOf(root, options.background);
  if (background !== null) {
    const rect = exporter.svg("rect");
    rect.setAttribute("width", "100%");
    rect.setAttribute("height", "100%");
    rect.setAttribute("fill", background.hex);
    if (background.alpha < 1) {
      rect.setAttribute("fill-opacity", num(background.alpha));
    }
    out.append(rect);
  }
  exporter.walk(root);
  if (options.embedFonts !== false) {
    const faces = await embeddedFontFaces(exporter.doc, exporter.fonts);
    if (faces !== "") {
      const style = exporter.svg("style");
      style.textContent = faces;
      exporter.defs.prepend(style);
    }
  }
  if (exporter.defs.childNodes.length === 0) {
    exporter.defs.remove();
  }
    return { svg: new XMLSerializer().serializeToString(out), width, height, title };
}
