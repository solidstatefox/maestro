import type { StyleObject } from "../style";
import { surfaceBox, surfaceHostStyle } from "../surface/surface";

/** The carrier roles the controller reads from its table: React's `parseChildren` (react/sunburst/carriers.ts) files the carriers under them by
 * display name, a port's carriers register under them. `SunburstBreadcrumb` and `SunburstHint` are not carriers: they render, placed by the adapter. */
export const SUNBURST_ROLES = { center: "sunburstCenter", labels: "sunburstLabels", segment: "sunburstSegment" } as const;

export interface SunburstView {
  /** False when the tree has no focus: the chart renders nothing (no host). */
  readonly shown: boolean;
  /** A definition exists (the tree has depth): the stage holds the surface, and the adapter attaches once it rendered it. */
  readonly drawn: boolean;
  /** The host's attributes (`undefined` leaves one out), after the adapter's own `class` and hydration marker. */
  readonly hostAttrs: Readonly<Record<string, string | undefined>>;
  /** The host's style: `size` wide at most, the entrance's vars while it plays. */
  readonly hostStyle: StyleObject;
  /** The square stage (`bk-sb-stage`) the surface sits in, between the breadcrumbs and the hints. */
  readonly stageStyle: StyleObject;
  /** The surface's host box (`ts-chart-host`): RendererChart.js:116-119 at aspect ratio 1. */
  readonly surfaceStyle: StyleObject;
  /** The renderer's options: a new definition is a new view, so the adapter's next commit hands it over. */
  readonly surface: object | null;
}

/** The surface box TanStack's RendererChart wrote for `aspectRatio={1}` (no height: the aspect ratio sizes it), in its key order. */
export const SUNBURST_SURFACE_STYLE: StyleObject = /* @__PURE__ */ surfaceHostStyle(/* @__PURE__ */ surfaceBox({ aspectRatio: 1 }));
