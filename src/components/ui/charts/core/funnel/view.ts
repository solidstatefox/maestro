import type { StyleObject } from "../style";
import type { FunnelPatternTile } from "./model";

/** The stage patterns' tiles and their resource host's id prefix (model.ts `funnelPatternTiles`), laid out at the plot width the last draw measured. */
export interface FunnelPatterns {
  readonly prefix: string;
  readonly tiles: readonly FunnelPatternTile[];
}

export interface FunnelView {
  /** The host's attributes, beside the reader's class and the adapter's hydration marker. */
  readonly hostAttrs: Readonly<Record<string, string>>;
  /** The host's style before the reader's own: its box, the hover pop-out and the entrance variables. */
  readonly hostStyle: StyleObject;
  /** The surface's host box (`ts-chart-host`, dist/react/RendererChart.js:104-110). */
  readonly surfaceStyle: StyleObject;
  /** Present when a `renderPattern` is given. */
  readonly patterns: FunnelPatterns | null;
}

/** funnel.css keys on `data-bkm-chart="funnel"`; `data-slot` is shadcn's chart slot. */
export const FUNNEL_HOST_ATTRS: FunnelView["hostAttrs"] = { "data-bkm-chart": "funnel", "data-slot": "chart" };
