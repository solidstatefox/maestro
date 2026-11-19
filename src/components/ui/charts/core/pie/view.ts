import { el } from "../markup/node";
import type { MarkupNode } from "../markup/node";
import type { StyleObject } from "../style";
import { surfaceBox, surfaceHostStyle } from "../surface/surface";

/** The PieSlice carriers' role in the chart's table (React reads the PieSlice elements, a port registers each PieSlice under it). */
export const PIE_SLICE_ROLE = "pieSlice";

export interface PieView {
  /** Under 10 px (bklit pie-chart.tsx's fallback box): the host renders with no children, neither the chart nor its defs or centre. */
  readonly collapsed: boolean;
  /** The host's attributes (`undefined` leaves one out), after the adapter's own `class`: `data-bkm-chart`, `data-bkm-grow`, `data-slot`. */
  readonly hostAttrs: Readonly<Record<string, string | undefined>>;
  /** The host's style before the reader's `style`: the box while collapsed, else centred, with the hover geometry vars and the box. */
  readonly hostStyle: StyleObject;
  /** The owned `<style>`, the host's first child: the dim and pop rules keyed on the host's `data-hover` (null while collapsed). */
  readonly ownedStyle: MarkupNode | null;
  /** The surface's host box (`ts-chart-host`) while the chart is drawn (on the client, measured, not collapsed); null before. */
  readonly surfaceStyle: StyleObject | null;
  /** The renderer's options: a new definition or size is a new view, so the adapter's next commit hands it over. */
  readonly surface: object;
}

/** The host's attributes: the pie's CSS scope, the slices whose grown donut outline the CSS swaps in, the chart slot. */
export const pieHostAttrs = (grow: string | undefined): PieView["hostAttrs"] => ({ "data-bkm-chart": "pie", "data-bkm-grow": grow, "data-slot": "chart" });

/** The owned `<style>` holding `css`. */
export const pieOwnedStyle = (css: string): MarkupNode => el("style", {}, [css]);

/** RendererChart.js:116-119 for a chart `size` px square: React's host box for the `width` and `height` the pie hands it. */
export const pieSurfaceStyle = (size: number): StyleObject => surfaceHostStyle(surfaceBox({ width: size, height: size }));
