import type { MarkupChild, MarkupNode } from "../markup/node";
import { resourceHost } from "../markup/resources";
import type { StyleObject } from "../style";
import { surfaceBox, surfaceHostStyle } from "../surface/surface";
import type { HeatmapTooltipBody } from "./tooltip";

/** The chart's elements while it is drawn (measured, large enough, with a `HeatmapCells` carrier), inside the host in this order. */
export interface HeatmapChartView {
  /** The inner box (a `<div>`, the host's only child): the surface, the defs host, the loading label, then the reader's children. */
  readonly innerStyle: StyleObject;
  /** The surface's host box (`<div>` around the `ts-chart-surface` the renderer mounts in) as RendererChart.js:113-119 renders it: its class
   * `ts-chart-host` then this (`surfaceHostClass`, RendererChart's `className`), its style the box for the chart's size. */
  readonly surfaceClassName: string;
  readonly surfaceStyle: StyleObject;
  /** The hidden defs host beside the surface (the level patterns, the separator gradient), or null when neither is configured. */
  readonly resources: MarkupNode | null;
  /** The loading label (`LoadingLabel`) in its box over the plot area (`<div class="ts-bkm-heatmap-loading-box">`), or null. */
  readonly loadingLabel: { readonly text: string; readonly boxStyle: StyleObject } | null;
}

export interface HeatmapView<Style> {
  /** The host's attributes, after the adapter's own `class`: `data-bkm-chart`, `data-hm-id` (the hover rule's scope), `data-slot`. */
  readonly hostAttrs: Readonly<Record<string, string | undefined>>;
  /** The host's style: its box, the loading opacity var and, when interactive, the hover vars. */
  readonly hostStyle: StyleObject;
  /** The chart's elements while it is drawn; null before the width arrives (bklit's ParentSize chain) and while it can't draw. */
  readonly chart: HeatmapChartView | null;
  /** The hovered cell's tooltip as text (`HeatmapTooltipView`): the adapter's tooltip leaf renders it into the target `tooltip` reports. */
  readonly tooltipBody: HeatmapTooltipBody<Style>;
}

/** The renderer surface's style after its box. */
const HEATMAP_SVG_STYLE: StyleObject = { overflow: "visible" };

/** The surface host's class after TanStack's `ts-chart-host` (styles.css `.ts-bkm-heatmap-svg`). */
export const HEATMAP_SURFACE_CLASS_NAME = "ts-bkm-heatmap-svg";

/** The host's attributes for the chart's id. */
export const heatmapHostAttrs = (uid: string): HeatmapView<unknown>["hostAttrs"] => ({ "data-bkm-chart": "heatmap", "data-hm-id": uid, "data-slot": "chart" });

/** RendererChart.js:104-119 for the chart's `width` and `height`, the heatmap's svg style after the box. */
export const heatmapSurfaceStyle = (width: number, height: number): StyleObject => surfaceHostStyle(surfaceBox({ width, height }), HEATMAP_SVG_STYLE);

/** The defs host of the pass's resources (React's ResourceHost around them), or null without any. */
export const heatmapResourceHost = (uid: string, resources: readonly MarkupChild[] | null): MarkupNode | null => (resources === null ? null : resourceHost(uid, resources));
