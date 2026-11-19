import type { StyleObject } from "../style";
import { surfaceBox, surfaceHostStyle } from "../surface/surface";
import type { RadarProviderValue } from "./context";

export interface RadarView {
  /** Nothing renders: no metrics, or a `size` under 10 px (React's RadarChart returns null). */
  readonly hidden: boolean;
  /** The host's attributes (`undefined` leaves one out), before its `class` and `style`. */
  readonly hostAttrs: Readonly<Record<string, string | undefined>>;
  /** The host's classes, before the reader's `className`. */
  readonly hostClass: string;
  /** The host's style, before the reader's `style`: its size when fixed, the entrance vars when animating. */
  readonly hostStyle: StyleObject;
  /** The surface host's box (`.ts-chart-host`). */
  readonly surfaceStyle: StyleObject;
  /** RadarProvider's value: the stable context and the hover setter (the hovered series is the controller's `hover`). */
  readonly provider: RadarProviderValue;
}

/** The host's attributes: the entrance rules' and the hover rules' scope (entrance.ts, hover-css.ts). */
export const radarHostAttrs = (animate: boolean): RadarView["hostAttrs"] => ({ "data-bkm-enter": animate ? "" : undefined, "data-bkm-radar": "" });

/** RendererChart.js:116-119 at the radar's props (width and height `size`, aspect ratio 1): `size` px square, else the full width, square. */
export const radarSurfaceStyle = (size: number | undefined): StyleObject => surfaceHostStyle(surfaceBox({ width: size, height: size, aspectRatio: 1 }));
