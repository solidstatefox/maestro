import type { ChartDownloadOptions, ChartExporter, ChartExportFormat, ChartExportOptions } from "../types/export";
import { settleChart } from "./settle";
import { chartSvg } from "./svg";
import type { ChartSvg } from "./svg";

/** What marks a kit chart in the page: every family's surface host, and the sparkline's element. */
const CHART = ".ts-chart-host, [data-bkm-spark]";
/** The browsers' canvas limit on a side, kept under. */
const MAX_SIDE = 16_384;

const isElement = (value: unknown): value is Element =>
  typeof value === "object" && value !== null && (value as Node).nodeType === 1 && typeof (value as Element).getBoundingClientRect === "function";

/** What a ref hands over: an element, or a Vue component (its root element). */
const elementOf = (value: unknown): Element | null => {
  if (isElement(value)) {
    return value;
  }
  if (typeof value === "object" && value !== null && "$el" in value) {
    const root = (value as { readonly $el: unknown }).$el;
    return isElement(root) ? root : null;
  }
  return null;
};

/** `root` written as an SVG file, at rest unless `settle: false`. */
async function exportSvg(root: Element, options: ChartExportOptions): Promise<ChartSvg> {
  if (options.settle !== false) {
    await settleChart(root);
  }
  return chartSvg(root, options);
}

const loadImage = (doc: Document, url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = doc.createElement("img");
    image.decoding = "sync";
    image.onload = () => {
      resolve(image);
    };
    image.onerror = () => {
      reject(new Error("Chart export: the browser couldn't draw the chart's SVG."));
    };
    image.src = url;
  });

/** An SVG file drawn into a PNG at `scale` (its size times it, kept under the browsers' canvas limit). */
async function rasterize(doc: Document, file: ChartSvg, scale: number): Promise<Blob> {
  const view = doc.defaultView;
  if (view === null) {
    throw new Error("Chart export needs a browser document.");
  }
  const density = Math.max(0.1, Math.min(scale, MAX_SIDE / file.width, MAX_SIDE / file.height));
  const canvas = doc.createElement("canvas");
  canvas.width = Math.max(1, Math.round(file.width * density));
  canvas.height = Math.max(1, Math.round(file.height * density));
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("Chart export: no 2D canvas in this browser.");
  }
  // A data URL: the image is the file itself, fonts and all, with nothing to revoke.
  const image = await loadImage(doc, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(file.svg)}`);
  try {
    await image.decode();
  } catch {
    // Decoded already (`onload`), or the browser decodes on draw.
  }
  // Drawn two frames later: an engine may still be applying the image's embedded fonts when it reports it decoded.
  await new Promise<void>((resolve) => {
    view.requestAnimationFrame(() => {
      view.requestAnimationFrame(() => {
        resolve();
      });
    });
  });
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) {
        reject(new Error("Chart export: the browser couldn't encode the PNG."));
      } else {
        resolve(blob);
      }
    }, "image/png");
  });
}

/** `root` (an element holding a chart) as a standalone SVG file's text. */
export async function exportChartSvg(root: Element, options: ChartExportOptions = {}): Promise<string> {
  return (await exportSvg(root, options)).svg;
}

/** `root` (an element holding a chart) as a PNG, at `scale` (2 by default). */
export async function exportChartPng(root: Element, options: ChartExportOptions = {}): Promise<Blob> {
  return rasterize(root.ownerDocument, await exportSvg(root, options), options.scale ?? 2);
}

const EXTENSION = /\.(png|svg)$/i;
const UNSAFE = /[^\p{L}\p{N}]+/gu;

/** The file's name and format: the name's extension decides, else the option, else PNG; no name: the chart's title, made a file name. */
const fileOf = (filename: string | undefined, format: ChartExportFormat | undefined, title: string | undefined) => {
  const named = filename === undefined ? undefined : EXTENSION.exec(filename)?.[1]?.toLowerCase();
  const kind: ChartExportFormat = named === "svg" || named === "png" ? named : (format ?? "png");
  if (filename !== undefined && named !== undefined) {
    return { kind, name: filename };
  }
  const base = filename ?? (title?.toLowerCase().replace(UNSAFE, "-").replace(/^-+|-+$/g, "") || "chart");
  return { kind, name: `${base}.${kind}` };
};

/** Saves `blob` as `name` through a link in `doc` (its URL revoked once the download has it). */
const save = (doc: Document, blob: Blob, name: string): void => {
  const view = doc.defaultView;
  const url = URL.createObjectURL(blob);
  const link = doc.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  link.style.display = "none";
  doc.body.append(link);
  link.click();
  link.remove();
  (view ?? globalThis).setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 30_000);
};

/** Saves `root` (an element holding a chart) as `filename` (`.png` or `.svg`; without an extension, `format`'s; else the chart's title). */
export async function downloadChart(root: Element, filename?: string, options: ChartDownloadOptions = {}): Promise<void> {
  const file = await exportSvg(root, options);
  const { kind, name } = fileOf(filename, options.format, file.title);
  const blob = kind === "svg" ? new Blob([file.svg], { type: "image/svg+xml;charset=utf-8" }) : await rasterize(root.ownerDocument, file, options.scale ?? 2);
  save(root.ownerDocument, blob, name);
}

/**
 * What a control in a chart's card exports (`ChartExportButton` without an exporter): the nearest enclosing element that holds a chart,
 * as the child of it that does (from a button in a card's header: the card's content, the chart and what the demo draws around it), or
 * `null` when no chart is around.
 */
export function findChartExportTarget(from: Element): Element | null {
  for (let parent = from.parentElement; parent !== null; parent = parent.parentElement) {
    const chart = [...parent.querySelectorAll(CHART)].find((found) => !from.contains(found));
    if (chart !== undefined) {
      let holder: Element = chart;
      while (holder.parentElement !== null && holder.parentElement !== parent) {
        holder = holder.parentElement;
      }
      return holder;
    }
  }
  return null;
}

const unbound = (): Promise<never> => Promise.reject(new Error("Chart export: bind the exporter's `ref` to an element holding the chart."));

/** A chart exporter (what `useChartExport()` returns on every framework): bind `ref` to an element holding the chart, then export it. */
export function createChartExporter(): ChartExporter {
  let bound: Element | null = null;
  return {
    ref(value) {
      const element = elementOf(value);
      bound = element;
      return () => {
        if (bound === element) {
          bound = null;
        }
      };
    },
    element: () => bound,
    toSvg: (options) => (bound === null ? unbound() : exportChartSvg(bound, options)),
    toPng: (options) => (bound === null ? unbound() : exportChartPng(bound, options)),
    download: (filename, options) => (bound === null ? unbound() : downloadChart(bound, filename, options)),
  };
}
