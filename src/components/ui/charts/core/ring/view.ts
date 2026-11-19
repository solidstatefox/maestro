import type { StyleObject } from "../style";
import { surfaceBox, surfaceHostStyle } from "../surface/surface";

export interface RingView {
  /** The host's attributes beside the adapter's own `class`. */
  readonly hostAttrs: Readonly<Record<string, string>>;
  /** The host's style before the reader's `style`: centred with the entrance vars and the box, or the box alone while collapsed. */
  readonly hostStyle: StyleObject;
  /** Under 10 px: the host renders empty (no surface, no centre overlay). */
  readonly collapsed: boolean;
  /** The surface is mounted: the chart's width is known (a fixed `size`, or the first measure delivered, bklit ring-chart.tsx:465) and the
   * chart is not collapsed. The adapter renders the surface elements and hands the surface element to `setSurface`. */
  readonly showSurface: boolean;
  /** The surface's host box (`ts-chart-host`): `size` px square, as RendererChart.js:116-119 writes `width` / `height`. */
  readonly surfaceStyle: StyleObject;
  /** The renderer's options: a new definition is a new view. */
  readonly surface: object;
}

/** The host's attributes: the chart's family (the scoped hover and entrance CSS key on it) and shadcn's chart slot. */
export const RING_HOST_ATTRS: RingView["hostAttrs"] = { "data-bkm-chart": "ring", "data-slot": "chart" };

/** The surface's host box at `size` px square: RendererChart.js:116-119 with `width` and `height` given (no aspect ratio). */
export const ringSurfaceStyle = (size: number): StyleObject => surfaceHostStyle(surfaceBox({ width: size, height: size }));
