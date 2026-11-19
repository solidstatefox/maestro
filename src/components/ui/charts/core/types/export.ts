export type ChartExportFormat = "png" | "svg";

/** How a chart is exported. Every option has a default that exports the chart as it looks on the page, at rest. */
export interface ChartExportOptions {
  /**
   * What the export is painted on: the surface the chart sits on by default (its nearest painted ancestor's background, such as its
   * card's, resolved for the current theme), any CSS colour (`var(--card)` too), or `"transparent"`.
   */
  readonly background?: string;
  /**
   * Pixel density of a PNG: its size is the chart's times `scale`.
   * @default 2
   */
  readonly scale?: number;
  /**
   * Embed the web fonts the chart's text is set in (each `@font-face` it uses, as data), so the file renders in them anywhere. A PNG is
   * drawn from the same svg, so it needs them too.
   * @default true
   */
  readonly embedFonts?: boolean;
  /**
   * Export the chart at rest: leave a hover or keyboard focus on it (tooltip, crosshair, dimmed series) and wait for its running
   * transitions and entrance to finish (up to 2 s) before reading it. `false` exports it exactly as it is now.
   * @default true
   */
  readonly settle?: boolean;
  /** The file's accessible name (its `<title>` and `aria-label`): the chart's own (`ariaLabel`) by default. */
  readonly label?: string;
}

/** `download`'s options: an export's, and its format when the file name has no extension. */
export interface ChartDownloadOptions extends ChartExportOptions {
  /**
   * The file's format: the file name's extension (`.png` or `.svg`) by default, else `"png"`.
   */
  readonly format?: ChartExportFormat;
}

/** What `useChartExport()` returns: bind `ref` to an element holding the chart, then export it. */
export interface ChartExporter {
  /**
   * Bind the exporter to an element holding the chart (its card's content, a wrapper, the chart's own element): everything drawn
   * inside it is exported, the chart and the legends, labels and centres around it. A callback ref (React, Solid), a function ref
   * (Vue `:ref`, which may hand it a component: its root element is taken) or an attachment (Svelte `{@attach}`); it returns its
   * cleanup.
   */
  readonly ref: (element: unknown) => () => void;
  /** The element `ref` is bound to, or `null`. */
  readonly element: () => Element | null;
  /** The chart as a standalone SVG file's text: every layer, the theme's colours resolved, its fonts and its background. */
  readonly toSvg: (options?: ChartExportOptions) => Promise<string>;
  /** The chart as a PNG, at `scale` (2 by default). */
  readonly toPng: (options?: ChartExportOptions) => Promise<Blob>;
  /**
   * Saves the chart as a file: `filename` (`.png` or `.svg`, or without an extension, then `format`'s) or the chart's label, made a
   * file name.
   */
  readonly download: (filename?: string, options?: ChartDownloadOptions) => Promise<void>;
}
