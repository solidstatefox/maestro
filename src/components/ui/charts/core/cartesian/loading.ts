import type { StyleObject } from "../style";

export const DEFAULT_LOADING_STROKE = "var(--bkm-foreground)";
export const DEFAULT_LOADING_GRID_STROKE = "color-mix(in oklch, var(--chart-grid) 50%, transparent)";
export const DEFAULT_LOADING_GRID_SHIMMER_STROKE = "color-mix(in oklch, var(--bkm-foreground) 68%, transparent)";
export const DEFAULT_LOADING_STROKE_OPACITY = 0.5;

/** bklit line-loading-timing.ts: 2.2s pulse cycle + 280ms pause; the shimmer loops on the same period at `shimmerSpeed` 1. */
const SHIMMER_CYCLE_S = 2.48;

export interface LoadingGrid {
  readonly shimmer?: boolean;
  readonly shimmerSpeed?: number;
}

export const loadingHostAttrs = (grid: LoadingGrid | undefined): { "data-bkm-status": string; "data-bkm-loading-shimmer": string | undefined } => ({
  "data-bkm-status": "loading",
  "data-bkm-loading-shimmer": grid?.shimmer === true ? "" : undefined,
});

/** The loading host's custom properties: the grid shimmer's period. */
export const loadingHostVars = (grid: LoadingGrid | undefined): StyleObject => ({
  "--bkm-loading-shimmer-duration": `${SHIMMER_CYCLE_S / Math.max(0.1, grid?.shimmerSpeed ?? 1)}s`,
});
