import type { ChartMarkRenderer as MarkRenderer } from "@tanstack/charts";

declare const CANVAS_RENDERER: unique symbol;

/** The kit's canvas renderer, `canvasRenderer`: TanStack's Canvas renderer with the kit's mount (core/canvas/mark-renderer.ts). */
export type ChartCanvasRenderer = MarkRenderer & {
  readonly [CANVAS_RENDERER]: true;
  /** A gradient's stops as the canvas paints them (the cartesian series' fills and strokes, core/cartesian/series-marks.ts). */
  readonly paintStops: <T extends { readonly opacity: number }>(stops: readonly T[]) => T[];
};

/** Where a dense mark draws: `"svg"` (the default, one element per shape) or `canvasRenderer` (one bitmap for the chart's canvas marks). */
export type ChartMarkRenderer = "svg" | ChartCanvasRenderer;

/** Whether a mark draws on the canvas (`renderer={canvasRenderer}`). */
export const onCanvas = (renderer: ChartMarkRenderer | undefined): renderer is ChartCanvasRenderer => typeof renderer === "object" && renderer !== null;

/** The mark option that puts a mark on the canvas; none for SVG. */
export const markRendererOption = (renderer: ChartMarkRenderer | undefined): { renderer?: MarkRenderer } => (onCanvas(renderer) ? { renderer } : {});
