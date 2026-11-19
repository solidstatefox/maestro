import { afterPaint } from "../lifecycle/after-paint";

const SVG_NS = "http://www.w3.org/2000/svg";

/** How the engine draws a CSS mask on SVG content: as Blink does, not at all (WebKit), or off its content's box (Gecko). */
export type SvgCssMaskMode = "native" | "ignored" | "offset";

// The left square is masked out entirely and the right one, drawn 4px into its group, is fully shown, each by a box-sized gradient.
const PROBE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="4">' +
  '<g style="mask-image:linear-gradient(transparent,transparent);mask-size:100% 100%;mask-repeat:no-repeat;mask-origin:fill-box"><rect width="4" height="4"/></g>' +
  '<g style="mask-image:linear-gradient(#000,#000);mask-size:100% 100%;mask-repeat:no-repeat;mask-origin:fill-box"><rect x="4" width="4" height="4"/></g>' +
  "</svg>";

const probes = new WeakMap<Document, Promise<SvgCssMaskMode>>();

/** Reads the probe's two squares back: the masked-out one drawn means the mask was ignored, the shown one missing means it was misplaced. */
export const probeVerdict = (hiddenAlpha: number, shownAlpha: number): SvgCssMaskMode => {
  if (hiddenAlpha > 223) {
    return "ignored";
  }
  return shownAlpha < 32 ? "offset" : "native";
};

/** The document's engine, probed once. Resolves "native" wherever it can't tell (no canvas, the image failed to load). */
export function maskMode(doc: Document): Promise<SvgCssMaskMode> {
  let probe = probes.get(doc);
  if (probe === undefined) {
    probe = new Promise<SvgCssMaskMode>((resolve) => {
      const view = doc.defaultView;
      if (!view || typeof view.Image !== "function") {
        resolve("native");
        return;
      }
      const image = new view.Image();
      image.onload = (): void => {
        try {
          const canvas = doc.createElement("canvas");
          canvas.width = 8;
          canvas.height = 4;
          const context = canvas.getContext("2d");
          if (!context) {
            resolve("native");
            return;
          }
          context.drawImage(image, 0, 0);
          const pixels = context.getImageData(0, 0, 8, 4).data;
          resolve(probeVerdict(pixels[(2 * 8 + 1) * 4 + 3], pixels[(2 * 8 + 6) * 4 + 3]));
        } catch {
          // A canvas an SVG image taints can't be read back: only old WebKit taints it, and it ignores CSS masks on SVG content.
          resolve("ignored");
        }
      };
      image.onerror = (): void => resolve("native");
      image.src = `data:image/svg+xml,${encodeURIComponent(PROBE_SVG)}`;
    });
    probes.set(doc, probe);
  }
  return probe;
}

// --- Reading a computed mask ------------------------------------------------------------------------------------------------------

/** Splits a computed value on its top-level separators (commas, or whitespace), not those inside parentheses or quotes. */
export function splitTopLevel(value: string, separator: "," | " " = ","): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (quote) {
      if (ch === quote) {
        quote = "";
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth--;
    } else if (depth === 0 && (separator === " " ? /\s/.test(ch) : ch === separator)) {
      parts.push(value.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(value.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** A computed colour's alpha: `transparent`, `#rgba` / `#rrggbbaa`, the slash or fourth argument of a colour function; else opaque. */
export function colorAlpha(color: string): number {
  const c = color.trim().toLowerCase();
  if (c === "transparent") {
    return 0;
  }
  const hex = /^#([0-9a-f]{3,8})$/.exec(c);
  if (hex) {
    const digits = hex[1];
    if (digits.length === 4) {
      return Number.parseInt(digits[3] + digits[3], 16) / 255;
    }
    return digits.length === 8 ? Number.parseInt(digits.slice(6), 16) / 255 : 1;
  }
  const fn = /^[a-z-]+\((.*)\)$/.exec(c);
  if (!fn) {
    return 1;
  }
  const body = fn[1];
  const slash = body.lastIndexOf("/");
  const args = body.split(",");
  let alpha: string | undefined;
  if (slash >= 0) {
    alpha = body.slice(slash + 1);
  } else if (args.length === 4) {
    alpha = args[3];
  }
  if (alpha === undefined) {
    return 1;
  }
  const n = Number.parseFloat(alpha);
  if (!Number.isFinite(n)) {
    return 1;
  }
  return clamp01(alpha.trim().endsWith("%") ? n / 100 : n);
}

/** A length or percentage (or a `calc()` sum of them) as a fraction of `length` px; null when it has another unit, or px with no length. */
export function lengthFraction(token: string, length: number): number | null {
  const t = token.trim();
  const calc = /^calc\((.*)\)$/i.exec(t);
  const terms = (calc ? calc[1] : t).replaceAll(/\s+-\s+/g, " + -").split(/\s+\+\s+/);
  let total = 0;
  for (const term of terms) {
    const m = /^(-?\s*\d*\.?\d+(?:e[+-]?\d+)?)(%|px)?$/i.exec(term.trim().replaceAll(/\s+/g, ""));
    if (!m) {
      return null;
    }
    const n = Number.parseFloat(m[1]);
    if (m[2] === "%") {
      total += n / 100;
    } else if (m[2] === "px" || n === 0) {
      if (n !== 0 && !(length > 0)) {
        return null;
      }
      total += n === 0 ? 0 : n / length;
    } else {
      return null;
    }
  }
  return total;
}

const SIDES: Readonly<Record<string, number>> = { "to top": 0, "to right": 90, "to bottom": 180, "to left": 270 };
const ANGLE_UNITS: Readonly<Record<string, number>> = { deg: 1, grad: 0.9, rad: 180 / Math.PI, turn: 360 };

/** A gradient's direction as a CSS angle (0 = to top, clockwise) in a `width` × `height` box; null when the token is not a direction. */
export function gradientAngle(token: string, width = 1, height = 1): number | null {
  const t = token.trim().toLowerCase().replaceAll(/\s+/g, " ");
  if (t in SIDES) {
    return SIDES[t];
  }
  const corner = /^to (top|bottom) (left|right)$/.exec(t) ?? /^to (left|right) (top|bottom)$/.exec(t);
  if (corner) {
    const vertical = corner[1] === "top" || corner[1] === "bottom" ? corner[1] : corner[2];
    const horizontal = vertical === corner[1] ? corner[2] : corner[1];
    // The 50% line runs through the two other corners (CSS Images 3 §3.1.1).
    const dy = vertical === "top" ? width : -width;
    const dx = horizontal === "right" ? height : -height;
    return (Math.atan2(dx, dy) * 180) / Math.PI;
  }
  const m = /^(-?\d*\.?\d+(?:e[+-]?\d+)?)(deg|grad|rad|turn)$/.exec(t);
  return m ? Number.parseFloat(m[1]) * ANGLE_UNITS[m[2]] : null;
}

/** One colour stop as written: its alpha and its zero, one or two positions. */
interface RawStop {
  readonly alpha: number;
  readonly positions: readonly string[];
}

/** A linear gradient as computed: repeating or not, its direction token (or none: to bottom) and its stops. */
export interface ParsedGradient {
  readonly repeating: boolean;
  readonly direction: string | null;
  readonly stops: readonly RawStop[];
}

/** `linear-gradient(…)` / `repeating-linear-gradient(…)`; null for any other image (or a gradient with a colour hint, which isn't mirrored). */
export function parseLinearGradient(image: string): ParsedGradient | null {
  const m = /^(repeating-)?linear-gradient\((.*)\)$/i.exec(image.trim());
  if (!m) {
    return null;
  }
  const args = splitTopLevel(m[2]);
  let direction: string | null = null;
  if (args.length > 0 && gradientAngle(args[0]) !== null) {
    direction = args[0];
    args.shift();
  }
  const stops: RawStop[] = [];
  for (const arg of args) {
    const tokens = splitTopLevel(arg, " ");
    const color = tokens.find((token) => lengthFraction(token, 1) === null);
    if (color === undefined) {
      return null;
    }
    stops.push({ alpha: colorAlpha(color), positions: tokens.filter((token) => token !== color) });
  }
  return stops.length >= 2 ? { repeating: m[1] !== undefined, direction, stops } : null;
}

/** A resolved stop: its offset along the gradient line (a fraction of it) and its alpha. */
export interface MaskStop {
  readonly offset: number;
  readonly alpha: number;
}

/** CSS Images 3 §3.5.3: the stops' positions as fractions of a `length` px gradient line, the missing ones filled in and each clamped up to
 * the one before it. Null when a position can't be resolved. */
export function resolveStops(stops: readonly RawStop[], length: number): MaskStop[] | null {
  const flat: { alpha: number; offset: number | null }[] = [];
  for (const stop of stops) {
    if (stop.positions.length === 0) {
      flat.push({ alpha: stop.alpha, offset: null });
    }
    for (const position of stop.positions.slice(0, 2)) {
      const offset = lengthFraction(position, length);
      if (offset === null) {
        return null;
      }
      flat.push({ alpha: stop.alpha, offset });
    }
  }
  if (flat[0].offset === null) {
    flat[0].offset = 0;
  }
  const last = flat.at(-1);
  if (last && last.offset === null) {
    last.offset = 1;
  }
  let max = Number.NEGATIVE_INFINITY;
  for (const stop of flat) {
    if (stop.offset !== null) {
      stop.offset = Math.max(stop.offset, max);
      max = stop.offset;
    }
  }
  for (let i = 1; i < flat.length - 1; i++) {
    if (flat[i].offset !== null) {
      continue;
    }
    let j = i;
    while (flat[j].offset === null) {
      j++;
    }
    const from = flat[i - 1].offset ?? 0;
    const to = flat[j].offset ?? from;
    for (let k = i; k < j; k++) {
      flat[k].offset = from + ((to - from) * (k - i + 1)) / (j - i + 1);
    }
  }
  return flat.map((stop) => ({ offset: stop.offset ?? 0, alpha: stop.alpha }));
}

/** A gradient's line in a `width` × `height` box (CSS Images 3 §3.1.1): its start and end, and its length. */
export function gradientLine(angle: number, width: number, height: number): { x1: number; y1: number; x2: number; y2: number; length: number } {
  const radians = (angle * Math.PI) / 180;
  const sin = Math.sin(radians);
  const cos = Math.cos(radians);
  const length = Math.abs(width * sin) + Math.abs(height * cos);
  const dx = (sin * length) / 2;
  const dy = (-cos * length) / 2;
  // Rounded off the float noise of sin/cos, so a side's vector writes as whole numbers.
  const round = (n: number): number => Math.round(n * 1e6) / 1e6 + 0;
  return { x1: round(width / 2 - dx), y1: round(height / 2 - dy), x2: round(width / 2 + dx), y2: round(height / 2 + dy), length: round(length) };
}

/** A mask layer's paint: a gradient on its rect (its own box, or a vector in tile px for a tile) or an image. */
export type MaskPaint =
  | { readonly kind: "gradient"; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number; readonly units: "box" | "tile"; readonly repeat: boolean; readonly stops: readonly MaskStop[] }
  | { readonly kind: "image"; readonly href: string };

/** A mask layer: a rect in fractions of the element's box, or a tile repeated in user space from (x, y) (`fromBox`: from the box's corner). */
export type MaskLayer =
  | { readonly kind: "box"; readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly paint: MaskPaint }
  | { readonly kind: "tile"; readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly fromBox: boolean; readonly paint: MaskPaint };

/** A rect in the element's user space: the svg viewport a `view-box` origin lays box layers out on. */
export interface MaskRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** What to mirror: the layers top first and how each composites onto the ones under it; `view` when the box layers are laid out on the svg
 * viewport (`mask-origin: view-box`) rather than on the element's box. */
export interface MaskPlan {
  readonly layers: readonly MaskLayer[];
  readonly ops: readonly ("add" | "intersect")[];
  readonly view?: MaskRect;
}

/** The mask properties a plan is read from, as computed (comma lists, one entry per layer, repeated as CSS repeats them). */
export interface ComputedMask {
  readonly image: string;
  readonly size: string;
  readonly position: string;
  readonly repeat: string;
  readonly origin: string;
  readonly composite: string;
  readonly mode: string;
  /** The kit's `--bkm-mask-origin`, set beside a `view-box` origin: WebKit drops that value, so its computed origin can't tell. */
  readonly originHint?: string;
}

const COMPOSITE: Readonly<Record<string, "add" | "intersect" | undefined>> = { add: "add", "source-over": "add", intersect: "intersect", "source-in": "intersect" };

const entry = (list: readonly string[], i: number, fallback: string): string => (list.length === 0 ? fallback : list[i % list.length]);

const urlOf = (image: string): string | null => {
  const m = /^url\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^)]*))\s*\)$/i.exec(image.trim());
  if (!m) {
    return null;
  }
  return (m[1] ?? m[2] ?? m[3] ?? "").replaceAll(/\\(.)/g, "$1").trim();
};

/** A tile's or a box layer's gradient paint. In a box the gradient's vector is in the rect's own units (exact for sides and corners; an
 * angle reads as if the box were square); in a tile it is in tile px, a repeating gradient's one period with the vector repeating. */
function gradientPaint(gradient: ParsedGradient, units: "box" | "tile", width: number, height: number): MaskPaint | null {
  const direction = gradient.direction ?? "to bottom";
  const angle = gradientAngle(direction, width, height);
  if (angle === null) {
    return null;
  }
  if (units === "box") {
    // The vector in the unit square: a side or a corner maps onto the box exactly (the corners' 50% line is affine), an angle as if square.
    const unit = gradientLine(gradientAngle(direction) ?? angle, 1, 1);
    const linePx = gradientLine(angle, width, height).length;
    const stops = resolveStops(gradient.stops, linePx);
    if (!stops || gradient.repeating) {
      return null;
    }
    return { kind: "gradient", x1: unit.x1, y1: unit.y1, x2: unit.x2, y2: unit.y2, units, repeat: false, stops };
  }
  const line = gradientLine(angle, width, height);
  const stops = resolveStops(gradient.stops, line.length);
  if (!stops) {
    return null;
  }
  if (!gradient.repeating) {
    return { kind: "gradient", ...line, units, repeat: false, stops };
  }
  const first = stops[0].offset;
  const period = (stops.at(-1)?.offset ?? first) - first;
  if (!(period > 0)) {
    return null;
  }
  const ux = (line.x2 - line.x1) / (line.length || 1);
  const uy = (line.y2 - line.y1) / (line.length || 1);
  const start = first * line.length;
  const span = period * line.length;
  return {
    kind: "gradient",
    x1: line.x1 + ux * start,
    y1: line.y1 + uy * start,
    x2: line.x1 + ux * (start + span),
    y2: line.y1 + uy * (start + span),
    units,
    repeat: true,
    stops: stops.map((stop) => ({ offset: (stop.offset - first) / period, alpha: stop.alpha })),
  };
}

/** The plan for a computed mask on an element whose box is `boxWidth` × `boxHeight` px; null when any part of it isn't mirrored. */
export function planMask(mask: ComputedMask, boxWidth: number, boxHeight: number, viewport?: MaskRect): MaskPlan | null {
  if (mask.mode !== "" && mask.mode !== "match-source" && mask.mode !== "alpha") {
    return null;
  }
  const images = splitTopLevel(mask.image);
  if (images.length === 0 || images.some((image) => image === "none" || image.startsWith("url(#") || image.startsWith('url("#') || image.startsWith("url('#"))) {
    return null;
  }
  const sizes = splitTopLevel(mask.size);
  const positions = splitTopLevel(mask.position);
  const repeats = splitTopLevel(mask.repeat);
  const origins = splitTopLevel(mask.origin);
  const composites = splitTopLevel(mask.composite);
  const layers: MaskLayer[] = [];
  const ops: ("add" | "intersect")[] = [];
  let onView: boolean | null = null;
  for (const [i, image] of images.entries()) {
    const [sizeX = "auto", sizeY = "auto"] = splitTopLevel(entry(sizes, i, "auto"), " ");
    const [posX = "0%", posY = "0%"] = splitTopLevel(entry(positions, i, "0% 0%"), " ");
    const repeat = entry(repeats, i, "repeat");
    const origin = mask.originHint || entry(origins, i, "border-box");
    const gradient = parseLinearGradient(image);
    const href = gradient ? null : urlOf(image);
    if (!gradient && !href) {
      return null;
    }
    const pxX = /px$/.test(sizeX) ? Number.parseFloat(sizeX) : null;
    const pxY = /px$/.test(sizeY) ? Number.parseFloat(sizeY) : null;
    if (pxX !== null && pxY !== null) {
      // A tile: repeated in user space, as an image of its size or a gradient drawn over it.
      if (!(pxX > 0 && pxY > 0) || !/^repeat( repeat)?$/.test(repeat)) {
        return null;
      }
      const x = lengthFraction(posX, 1);
      const y = lengthFraction(posY, 1);
      const offsetX = /px$/.test(posX.trim()) ? Number.parseFloat(posX) : x === 0 ? 0 : null;
      const offsetY = /px$/.test(posY.trim()) ? Number.parseFloat(posY) : y === 0 ? 0 : null;
      const paint = gradient ? gradientPaint(gradient, "tile", pxX, pxY) : { kind: "image" as const, href: href ?? "" };
      if (!paint || offsetX === null || offsetY === null) {
        return null;
      }
      layers.push({ kind: "tile", x: offsetX, y: offsetY, width: pxX, height: pxY, fromBox: origin !== "view-box", paint });
    } else {
      // A box layer: a share of the element's box, or of the svg viewport from a `view-box` origin (auto is all of it for a gradient; an
      // image needs a size to be mirrored). Every box layer of a mask is laid out on the same one.
      const view = origin === "view-box";
      if ((onView !== null && onView !== view) || (view && viewport === undefined)) {
        return null;
      }
      onView = view;
      const refWidth = view && viewport ? viewport.width : boxWidth;
      const refHeight = view && viewport ? viewport.height : boxHeight;
      const shareX = sizeX === "auto" ? (gradient ? 1 : null) : lengthFraction(sizeX, refWidth);
      const shareY = sizeY === "auto" ? (gradient ? 1 : null) : lengthFraction(sizeY, refHeight);
      if (shareX === null || shareY === null || !(shareX > 0 && shareY > 0)) {
        return null;
      }
      // A position percentage places the layer's same point on the box's (background-position): (1 - share) × p.
      const at = (token: string, share: number, length: number): number | null => {
        const percent = lengthFraction(token, 1);
        if (/%\s*$/.test(token.trim()) && percent !== null) {
          return (1 - share) * percent;
        }
        return lengthFraction(token, length);
      };
      const x = at(posX, shareX, refWidth);
      const y = at(posY, shareY, refHeight);
      const paint = gradient ? gradientPaint(gradient, "box", refWidth * shareX, refHeight * shareY) : { kind: "image" as const, href: href ?? "" };
      if (!paint || x === null || y === null) {
        return null;
      }
      const covers = shareX >= 1 && shareY >= 1 && x <= 0 && y <= 0 && x + shareX >= 1 && y + shareY >= 1;
      if (!covers && repeat !== "no-repeat" && repeat !== "no-repeat no-repeat") {
        return null;
      }
      layers.push({ kind: "box", x, y, width: shareX, height: shareY, paint });
    }
    if (i < images.length - 1) {
      const op = COMPOSITE[entry(composites, i, "add")];
      if (op === undefined) {
        return null;
      }
      ops.push(op);
    }
  }
  // A tile repeats in user space while a box layer is in box units: one mask can't nest both, so only a lone tile is mirrored.
  if (layers.length > 1 && layers.some((layer) => layer.kind === "tile")) {
    return null;
  }
  return onView && viewport ? { layers, ops, view: viewport } : { layers, ops };
}

/** The element's computed mask, unprefixed or (an engine that has only those) prefixed. */
export function computedMask(style: CSSStyleDeclaration): ComputedMask {
  const read = (name: string, prefixed: string): string => style.getPropertyValue(name) || style.getPropertyValue(prefixed);
  return {
    image: read("mask-image", "-webkit-mask-image"),
    size: read("mask-size", "-webkit-mask-size"),
    position: read("mask-position", "-webkit-mask-position"),
    repeat: read("mask-repeat", "-webkit-mask-repeat"),
    origin: read("mask-origin", "-webkit-mask-origin"),
    composite: read("mask-composite", "-webkit-mask-composite"),
    mode: style.getPropertyValue("mask-mode"),
    originHint: style.getPropertyValue("--bkm-mask-origin").trim(),
  };
}

// --- Drawing the mirror ------------------------------------------------------------------------------------------------------------

const BIG = 100_000;

type Attrs = Record<string, string | number>;

const svgEl = (doc: Document, tag: string, attrs: Attrs, children: readonly Element[] = []): Element => {
  const node = doc.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) {
    node.setAttribute(name, String(value));
  }
  node.append(...children);
  return node;
};

const gradientEl = (doc: Document, id: string, paint: Extract<MaskPaint, { kind: "gradient" }>): Element =>
  svgEl(
    doc,
    "linearGradient",
    {
      id,
      x1: paint.x1,
      y1: paint.y1,
      x2: paint.x2,
      y2: paint.y2,
      ...(paint.units === "tile" ? { gradientUnits: "userSpaceOnUse" } : {}),
      ...(paint.repeat ? { spreadMethod: "repeat" } : {}),
    },
    paint.stops.map((stop) => svgEl(doc, "stop", { offset: stop.offset, "stop-color": "#fff", "stop-opacity": stop.alpha })),
  );

/** The defs that draw `plan` as the mask `id` (alpha masks, their content in the element's box units, or in user space for a tile). */
export function mirrorDefs(doc: Document, id: string, plan: MaskPlan, box: { x: number; y: number }): Element[] {
  const defs: Element[] = [];
  const { layers, ops } = plan;
  // Box layers are laid out on the element's box (its units, 0…1) or on the svg viewport (user space).
  const frame: MaskRect = plan.view ?? { x: 0, y: 0, width: 1, height: 1 };
  const paintOf = (paint: MaskPaint, key: string): string => {
    if (paint.kind === "image") {
      return "";
    }
    defs.push(gradientEl(doc, `${id}-${key}`, paint));
    return `url(#${id}-${key})`;
  };
  const layerContent = (layer: MaskLayer, key: string): Element => {
    if (layer.kind === "tile") {
      const tile =
        layer.paint.kind === "image"
          ? svgEl(doc, "image", { href: layer.paint.href, width: layer.width, height: layer.height, preserveAspectRatio: "none" })
          : svgEl(doc, "rect", { width: layer.width, height: layer.height, fill: paintOf(layer.paint, `${key}g`) });
      defs.push(
        svgEl(
          doc,
          "pattern",
          { id: `${id}-${key}p`, patternUnits: "userSpaceOnUse", x: layer.x + (layer.fromBox ? box.x : 0), y: layer.y + (layer.fromBox ? box.y : 0), width: layer.width, height: layer.height },
          [tile],
        ),
      );
      return svgEl(doc, "rect", { x: -BIG, y: -BIG, width: 2 * BIG, height: 2 * BIG, fill: `url(#${id}-${key}p)` });
    }
    const rect = { x: frame.x + layer.x * frame.width, y: frame.y + layer.y * frame.height, width: layer.width * frame.width, height: layer.height * frame.height };
    return layer.paint.kind === "image"
      ? svgEl(doc, "image", { href: layer.paint.href, ...rect, preserveAspectRatio: "none" })
      : svgEl(doc, "rect", { ...rect, fill: paintOf(layer.paint, `${key}g`) });
  };
  const maskEl = (maskId: string, units: "box" | "user", content: readonly Element[]): Element =>
    svgEl(
      doc,
      "mask",
      units === "box"
        ? { id: maskId, maskContentUnits: "objectBoundingBox", style: "mask-type:alpha" }
        : { id: maskId, maskUnits: "userSpaceOnUse", x: -BIG, y: -BIG, width: 2 * BIG, height: 2 * BIG, style: "mask-type:alpha" },
      content,
    );
  const units = layers[0].kind === "tile" || plan.view ? "user" : "box";
  // Layer k composited over the result of the layers under it (k + 1…): `intersect` draws it through that result's mask, `add` draws both.
  let under: string | null = null;
  for (let k = layers.length - 1; k >= 0; k--) {
    const maskId = k === 0 ? id : `${id}-m${k}`;
    const content = layerContent(layers[k], `l${k}`);
    let children: Element[];
    if (under === null) {
      children = [content];
    } else if (ops[k] === "intersect") {
      // The group's box is pinned to the frame (the element's 0…1), so a nested box-unit mask's units are the element's too.
      children = [svgEl(doc, "g", { mask: `url(#${under})` }, [svgEl(doc, "rect", { ...frame, fill: "none" }), content])];
    } else {
      children = [svgEl(doc, "rect", { ...frame, fill: "#fff", mask: `url(#${under})` }), content];
    }
    defs.push(maskEl(maskId, units, children));
    under = maskId;
  }
  return defs;
}

// --- Mounting it on a surface ------------------------------------------------------------------------------------------------------

/** Set on the surface container while it mirrors: the engine's mode, for a stylesheet to swap what isn't mirrored (an animated mask). */
export const MASK_MIRROR_ATTR = "data-bkm-mask-mirror";
/** The chart root's own token, scoping its mirror's rules. */
const SCOPE_ATTR = "data-bkm-mask-scope";
const SCAN_GAP_MS = 120;

let nextId = 0;

/** Whether one of the element's animations moves a mask property (a loading sweep): such a mask is left to CSS. */
const masksAnimate = (element: Element): boolean =>
  (element.getAnimations?.() ?? []).some((animation) => {
    const effect = animation.effect as KeyframeEffect | null;
    return (effect?.getKeyframes?.() ?? []).some((frame) => Object.keys(frame).some((key) => /^(webkit)?mask/i.test(key)));
  });

/** The element's fill box, or null when it has no area to lay a box mask on (a lone horizontal grid line). */
const boxOf = (element: SVGGraphicsElement): DOMRect | null => {
  try {
    const box = element.getBBox();
    return box.width > 0 && box.height > 0 ? box : null;
  } catch {
    return null;
  }
};

const escapeValue = (value: string): string => value.replaceAll(/["\\]/g, "\\$&");

/** A selector for `element` within `container` (the chart root): its TanStack key (or its nearest keyed ancestor's, then the path down by tag and position),
 * climbing on until it picks the element alone; the marks' own identity across redraws. (TanStack's reconcile drops attributes it didn't
 * write, so the mirror can't mark the element itself.) Null when nothing picks it alone. */
function selectorFor(element: Element, container: Element): string | null {
  const unique = (selector: string): boolean => {
    try {
      const matches = container.querySelectorAll(selector);
      return matches.length === 1 && matches[0] === element;
    } catch {
      return false;
    }
  };
  const steps: string[] = [];
  for (let node: Element | null = element; node && node !== container; node = node.parentElement) {
    // An empty key (the live line's area and fill groups) names nothing: such a node goes by its position.
    const key = node.getAttribute("data-ts-key") || null;
    if (key === null) {
      let index = 1;
      for (let sibling = node.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
        index += sibling.localName === node.localName ? 1 : 0;
      }
      steps.unshift(`${node.localName}:nth-of-type(${index})`);
    } else {
      steps.unshift(`${node.localName}[data-ts-key="${escapeValue(key)}"]`);
      if (unique(steps.join(" > "))) {
        return steps.join(" > ");
      }
    }
    if (node.parentElement === container) {
      const selector = `:scope > ${steps.join(" > ")}`;
      return unique(selector) ? selector : null;
    }
  }
  return null;
}

/** The element's svg viewport in its user space: the viewBox, else the svg's own size (a `view-box` origin's box). */
const viewportOf = (element: SVGGraphicsElement): MaskRect | undefined => {
  const svg = element.ownerSVGElement;
  if (!svg) {
    return undefined;
  }
  const box = svg.viewBox?.baseVal;
  if (box && box.width > 0 && box.height > 0) {
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  }
  const rect = svg.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? { x: 0, y: 0, width: rect.width, height: rect.height } : undefined;
};

interface Mirrored {
  readonly signature: string;
  readonly id: string;
  readonly defs: readonly Element[];
}

/** A surface's mirror: `refresh` after the surface draws (a render, a redraw), `detach` when it unmounts. */
export interface SvgMaskMirror {
  refresh(): void;
  detach(): void;
}

const NOOP_MIRROR: SvgMaskMirror = { refresh: () => undefined, detach: () => undefined };

/** One chart root's mirror: every masked SVG element under it (the surfaces', and what sits beside them, as the choropleth's backdrop). */
function createRootMirror(root: Element, doc: Document): SvgMaskMirror {
  const scope = String(nextId++);
  let detached = false;
  let active = false;
  let observer: MutationObserver | null = null;
  let host: SVGSVGElement | null = null;
  let sheet: HTMLStyleElement | null = null;
  let cancelScan: (() => void) | null = null;
  let lastScan = 0;
  // By selector: a redraw that replaces a mark keeps its mirror.
  const mirrored = new Map<string, Mirrored>();

  // The defs and the rules live outside the chart (TanStack owns the surfaces' children, the framework the rest): in the document's
  // body and head, or in the shadow root the chart renders in, so the url(#id) references resolve.
  const defsOf = (): Element => {
    if (!host?.isConnected || !sheet?.isConnected) {
      host?.remove();
      sheet?.remove();
      const tree = root.getRootNode();
      const shadow = tree instanceof (doc.defaultView as Window & typeof globalThis).ShadowRoot ? tree : null;
      host = doc.createElementNS(SVG_NS, "svg");
      host.setAttribute("aria-hidden", "true");
      host.setAttribute("focusable", "false");
      host.setAttribute("width", "0");
      host.setAttribute("height", "0");
      host.setAttribute("style", "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none");
      host.append(doc.createElementNS(SVG_NS, "defs"));
      sheet = doc.createElement("style");
      (shadow ?? doc.body).append(host);
      (shadow ?? doc.head).append(sheet);
    }
    return host.firstElementChild as Element;
  };

  const drop = (selector: string, entry: Mirrored): void => {
    for (const node of entry.defs) {
      node.remove();
    }
    mirrored.delete(selector);
  };

  const scan = (): void => {
    cancelScan = null;
    lastScan = performance.now();
    const view = doc.defaultView;
    if (detached || !root.isConnected || !view) {
      return;
    }
    if (host !== null && (!host.isConnected || !sheet?.isConnected)) {
      for (const [selector, entry] of mirrored) {
        drop(selector, entry);
      }
    }
    // Each element's own CSS mask, read with the mirror's rules lifted (one style pass), so a changed mask is seen.
    if (sheet) {
      sheet.disabled = true;
    }
    const found: { element: SVGGraphicsElement; mask: ComputedMask }[] = [];
    for (const element of root.querySelectorAll("svg *")) {
      const style = view.getComputedStyle(element);
      const image = style.getPropertyValue("mask-image") || style.getPropertyValue("-webkit-mask-image");
      if (image && image !== "none" && element instanceof view.SVGGraphicsElement) {
        found.push({ element, mask: computedMask(style) });
      }
    }
    if (sheet) {
      sheet.disabled = false;
    }
    let changed = false;
    const seen = new Set<string>();
    for (const { element, mask } of found) {
      const selector = selectorFor(element, root);
      if (selector === null || masksAnimate(element)) {
        continue;
      }
      const signature = Object.values(mask).join("|");
      const entry = mirrored.get(selector);
      if (entry?.signature === signature) {
        seen.add(selector);
        continue;
      }
      if (entry) {
        drop(selector, entry);
        changed = true;
      }
      const box = boxOf(element);
      const plan = box ? planMask(mask, box.width, box.height, viewportOf(element)) : null;
      if (!(box && plan)) {
        continue;
      }
      const id = `bkm-svgmask-${scope}-${nextId++}`;
      const defs = mirrorDefs(doc, id, plan, box);
      defsOf().append(...defs);
      mirrored.set(selector, { signature, id, defs });
      seen.add(selector);
      changed = true;
    }
    for (const [selector, entry] of mirrored) {
      if (!seen.has(selector)) {
        drop(selector, entry);
        changed = true;
      }
    }
    if (changed && sheet) {
      const prefix = `[${SCOPE_ATTR}="${scope}"]`;
      sheet.textContent = [...mirrored].map(([selector, { id }]) => `${prefix} ${selector.replace(":scope >", ">")}{mask:url(#${id}) !important}`).join("\n");
    }
  };

  const schedule = (): void => {
    if (detached || !active || cancelScan) {
      return;
    }
    const wait = SCAN_GAP_MS - (performance.now() - lastScan);
    if (wait > 0) {
      const timer = setTimeout(() => {
        cancelScan = afterPaint(scan);
      }, wait);
      cancelScan = (): void => clearTimeout(timer);
      return;
    }
    cancelScan = afterPaint(scan);
  };

  maskMode(doc).then((mode) => {
    if (detached || mode === "native") {
      return;
    }
    active = true;
    root.setAttribute(SCOPE_ATTR, scope);
    // New or removed nodes may carry (or have carried) a mask, and a mark's key or class picks its mask rule.
    observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "data-ts-key"] });
    schedule();
  }, () => undefined);

  return {
    refresh: schedule,
    detach(): void {
      detached = true;
      cancelScan?.();
      cancelScan = null;
      observer?.disconnect();
      observer = null;
      for (const [selector, entry] of mirrored) {
        drop(selector, entry);
      }
      host?.remove();
      sheet?.remove();
      host = null;
      sheet = null;
      root.removeAttribute(SCOPE_ATTR);
    },
  };
}

const roots = new WeakMap<Element, { count: number; mirror: SvgMaskMirror }>();

/** Mirrors the CSS masks on the SVG content of the chart `container` draws in (its nearest `[data-bkm-chart]` / `[data-bkm-kit]` root, one
 * mirror for all the root's surfaces) where the engine needs it (`maskMode`), and marks the container `data-bkm-mask-mirror` with the
 * engine's mode; a no-op in Blink and off the DOM. */
export function attachSvgMaskMirror(container: HTMLElement): SvgMaskMirror {
  const doc = container.ownerDocument;
  if (typeof MutationObserver === "undefined" || !doc?.defaultView) {
    return NOOP_MIRROR;
  }
  const root = container.closest("[data-bkm-chart], [data-bkm-kit]") ?? container;
  let shared = roots.get(root);
  if (shared === undefined) {
    shared = { count: 0, mirror: createRootMirror(root, doc) };
    roots.set(root, shared);
  }
  shared.count++;
  const entry = shared;
  let done = false;
  maskMode(doc).then((mode) => {
    if (!done && mode !== "native") {
      container.setAttribute(MASK_MIRROR_ATTR, mode);
    }
  }, () => undefined);
  return {
    refresh: entry.mirror.refresh,
    detach(): void {
      if (done) {
        return;
      }
      done = true;
      container.removeAttribute(MASK_MIRROR_ATTR);
      entry.count--;
      if (entry.count === 0) {
        entry.mirror.detach();
        roots.delete(root);
      }
    },
  };
}
