import type { MarkupNode } from "../markup/node";
import type { StyleObject } from "../style";
import { surfaceBox, surfaceHostStyle } from "../surface/surface";
import { bklitSurfaceStyle } from "../theme";
import type { LiveTooltipOptions } from "./live-tooltip";

export interface LiveLineView {
  /** A frame to draw (a width and a sample): until then the host is bare (React renders no surface), as bklit mounts under ParentSize. */
  readonly built: boolean;
  /** The host's attributes beside the adapter's `class` (`undefined` leaves one out): `data-bkm-chart` from the start, the rest once built. */
  readonly hostAttrs: Readonly<Record<string, string | undefined>>;
  /** The host's style before the reader's `style`. */
  readonly hostStyle: StyleObject;
  /** The host's style after the reader's: the chart's height, then (built) the roll's custom properties (live-host-style.ts). */
  readonly hostVars: StyleObject;
  /** The surface's host box (`ts-chart-host`): RendererChart.js:116-119 at the chart's height. */
  readonly surfaceStyle: StyleObject;
  /** The chart's pattern tiles (a Background's, the ReferenceAreas'; core/markup/live.ts), after the surface, once built; null without any.
   * The date pill's filter is the hover overlay's own (live-hover.ts). */
  readonly pill: MarkupNode | null;
  /** The tooltip body's options (live-tooltip.ts): the ChartTooltip carrier's `content` returns the framework's node. */
  readonly tooltipOptions: LiveTooltipOptions<unknown>;
}

/** The host before the first frame: full width, the reader's style, the height. */
export const BARE_HOST_STYLE: StyleObject = { width: "100%" };
export const BARE_HOST_ATTRS: LiveLineView["hostAttrs"] = { "data-bkm-chart": "liveline" };

/** The built host before the reader's style: positioned for its layers, with the surface tokens. */
export const LIVE_HOST_STYLE: StyleObject = /* @__PURE__ */ ((): StyleObject => ({ width: "100%", position: "relative", ...bklitSurfaceStyle }))();

/** bklit's LiveYAxis layer: an absolute inset-0, pointer-events-none layer over the plot (live-y-axis.tsx:188-191). */
export const LABELS_LAYER_STYLE: StyleObject = { position: "absolute", inset: 0, "pointer-events": "none" };

/** A surface's host box at `height` (RendererChart.js:116-119 with a height and no aspect ratio). */
export const liveSurfaceStyle = (height: number): StyleObject => surfaceHostStyle(surfaceBox({ height }));
