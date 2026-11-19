export interface ExportColor {
  readonly hex: string;
  /** 0 to 1. */
  readonly alpha: number;
}

const RGB = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i;
const TRANSPARENT: ExportColor = { hex: "#000000", alpha: 0 };

const hex2 = (value: number): string => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, "0");

let cache: Map<string, ExportColor | null> | undefined;
let probe: CanvasRenderingContext2D | null | undefined;

const fromCanvas = (doc: Document, color: string): ExportColor | null => {
  if (probe === undefined) {
    const canvas = doc.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    probe = canvas.getContext("2d", { willReadFrequently: true });
  }
  if (probe === null) {
    return null;
  }
  // An invalid colour leaves the fill style as it was: a sentinel tells it apart from black.
  probe.fillStyle = "#010203";
  probe.fillStyle = color;
  if (probe.fillStyle === "#010203" && color.replaceAll(" ", "").toLowerCase() !== "#010203") {
    return null;
  }
  probe.clearRect(0, 0, 1, 1);
  probe.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0, a = 0] = probe.getImageData(0, 0, 1, 1).data;
  return { hex: `#${hex2(r)}${hex2(g)}${hex2(b)}`, alpha: Math.round((a / 255) * 1000) / 1000 };
};

/** A computed colour as `#rrggbb` and an alpha, or `null` when it isn't one (`none`, a `url(…)` paint). */
export function exportColor(doc: Document, color: string): ExportColor | null {
  const text = color.trim();
  if (text === "" || text === "none" || text.startsWith("url(") || text === "context-fill" || text === "context-stroke") {
    return null;
  }
  if (text === "transparent") {
    return TRANSPARENT;
  }
  cache ??= new Map();
  const cached = cache.get(text);
  if (cached !== undefined) {
    return cached;
  }
  const rgb = RGB.exec(text);
  let resolved: ExportColor | null;
  if (rgb === null) {
    resolved = fromCanvas(doc, text);
  } else {
    const alpha = rgb[4] === undefined ? 1 : rgb[4].endsWith("%") ? Number.parseFloat(rgb[4]) / 100 : Number.parseFloat(rgb[4]);
    resolved = { hex: `#${hex2(Number(rgb[1]))}${hex2(Number(rgb[2]))}${hex2(Number(rgb[3]))}`, alpha: Math.round(alpha * 1000) / 1000 };
  }
  cache.set(text, resolved);
  return resolved;
}

/** A computed paint (`fill`, `stroke`): a colour resolved, or a `url(#id)` reference as SVG writes it (no quotes, no fallback). */
export function exportPaint(doc: Document, paint: string): { readonly value: string; readonly alpha: number } {
  const text = paint.trim();
  if (text.startsWith("url(")) {
    const id = /url\(\s*["']?([^"')]*)["']?\s*\)/.exec(text)?.[1] ?? "";
    const hash = id.indexOf("#");
    return { value: `url(${hash === -1 ? id : id.slice(hash)})`, alpha: 1 };
  }
  const color = exportColor(doc, text);
  if (color === null) {
    return { value: text === "" ? "none" : text, alpha: 1 };
  }
  return color.alpha === 0 ? { value: "none", alpha: 1 } : { value: color.hex, alpha: color.alpha };
}
