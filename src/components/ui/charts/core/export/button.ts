import { el } from "../markup/node";
import type { MarkupNode } from "../markup/node";
import type { ChartExporter, ChartExportFormat, ChartExportOptions } from "../types/export";
import { downloadChart, findChartExportTarget } from "./exporter";

/** The button's class (base.css). */
export const EXPORT_BUTTON_CLASS = "bkm-export";

/** The button's own attributes: a plain button, outside every export, named for what it saves. */
export const exportButtonAttrs = (format: ChartExportFormat, labelled: boolean): Readonly<Record<string, string>> => ({
  type: "button",
  "data-slot": "chart-export-button",
  "data-bkm-export-skip": "",
  ...(labelled ? {} : { "aria-label": `Download ${format.toUpperCase()}` }),
});

/** The default label beside the icon: the format. */
export const exportButtonText = (format: ChartExportFormat): string => format.toUpperCase();

/** A download arrow over a tray, drawn in the button's text colour. */
export const EXPORT_ICON: MarkupNode = el(
  "svg",
  {
    "aria-hidden": "true",
    fill: "none",
    height: 16,
    stroke: "currentColor",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "stroke-width": 2,
    viewBox: "0 0 24 24",
    width: 16,
  },
  [el("path", { d: "M12 4v11" }), el("path", { d: "m7 10 5 5 5-5" }), el("path", { d: "M5 20h14" })],
);

/** What `ChartExportButton` takes on every framework (besides its `class` / `className` and its children: the label). */
export interface ChartExportButtonOptions extends ChartExportOptions {
  /**
   * The file's format.
   * @default "png"
   */
  readonly format?: ChartExportFormat;
  /** The file's name, with or without its extension: the chart's label, made a file name, by default. */
  readonly filename?: string;
  /** What to export: the element `exporter.ref` is bound to. By default, the chart nearest the button (its card's content). */
  readonly exporter?: ChartExporter;
}

/** A click on `button`: exports and saves, `aria-busy` while it does. Rejects when nothing can be exported (no chart around, no size). */
export async function runExportButton(button: Element, options: ChartExportButtonOptions): Promise<void> {
  const target = options.exporter?.element() ?? findChartExportTarget(button);
  if (target === null) {
    throw new Error("ChartExportButton: no chart to export (place it in the chart's card, or pass an `exporter` bound to one).");
  }
  if (button.getAttribute("aria-busy") === "true") {
    return;
  }
  button.setAttribute("aria-busy", "true");
  try {
    const { exporter: _exporter, filename, ...download } = options;
    await downloadChart(target, filename, download);
  } finally {
    button.removeAttribute("aria-busy");
  }
}
