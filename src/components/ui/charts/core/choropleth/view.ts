import type { StyleObject } from "../style";
import { surfaceBox, surfaceHostStyle } from "../surface/surface";
import type { ChoroplethFeatureProps, Margin, TransformMatrix } from "../types/choropleth";
import type { TooltipCardConfig } from "./tooltip-body";
import { identityMatrix } from "./zoom";

export interface ChoroplethView<Node = unknown, Style = unknown> {
  /** The host's attributes (`undefined` leaves one out), beside the adapter's own `class` and hydration marker. */
  readonly hostAttrs: Readonly<Record<string, string | undefined>>;
  /** The host's style; an adapter writes it when it changes (a new object). */
  readonly hostStyle: StyleObject;
  /** The surface's host box (`ts-chart-host`): RendererChart.js:116-119 at the chart's aspect ratio. */
  readonly surfaceStyle: StyleObject;
  /** `ChoroplethFeature`'s `patterns` (the framework's nodes) and the prefix their `id`s take, so `getFeaturePattern` resolves them per chart; rendered
   * in a hidden svg's defs (`PATTERN_DEFS_STYLE`) before the surface. Null without patterns. */
  readonly patterns: { readonly nodes: Node; readonly prefix: string } | null;
  /** The `ChoroplethTooltip` carrier's props with their defaults (tooltip-body.ts), for the tooltip body; undefined without one (the chart has no tooltip). */
  readonly tooltip: TooltipCardConfig<Node, Style> | undefined;
}

export const DEFAULT_CENTER: [number, number] = [0, 20];
export const DEFAULT_INITIAL_ZOOM: TransformMatrix = /* @__PURE__ */ identityMatrix();
const DEFAULT_MARGIN: Margin = { bottom: 0, left: 0, right: 0, top: 0 };
const DEFAULT_FADED_OPACITY = 0.4;

/** The chart's margin, a side left out at its default. */
export const resolveMargin = (margin: Partial<Margin> | undefined): Margin => ({ ...DEFAULT_MARGIN, ...margin });

interface HostStyleInput {
  /** The parsed `aspectRatio`. */
  readonly ratio: number;
  readonly zoomEnabled: boolean;
  /** The 3D camera's edge fade, % per side (camera.ts `edgeFadeOf`); 0 for none. */
  readonly edgeFade: number;
  /** The layers' CSS fade (enter.ts `computeFadeVars`). */
  readonly fadeVars: Readonly<Record<string, string>>;
  /** `ChoroplethFeature`'s `fadedOpacity`. */
  readonly fadedOpacity: number | undefined;
}

/** The host's style: the box at the chart's aspect ratio, the zoom's grab cursor and touch capture, the fade, the hover dim and the edge fade. */
export const choroplethHostStyle = ({ ratio, zoomEnabled, edgeFade, fadeVars, fadedOpacity }: HostStyleInput): StyleObject => ({
  "aspect-ratio": String(ratio),
  contain: "layout style paint",
  ...(zoomEnabled ? { cursor: "grab" } : {}),
  overflow: "hidden",
  position: "relative",
  ...(zoomEnabled ? { "touch-action": "none" } : {}),
  width: "100%",
  ...fadeVars,
  // bklit's hover dim of the features group (`fadedOpacity`), read by styles.css.
  "--bkm-choro-dim": fadedOpacity ?? DEFAULT_FADED_OPACITY,
  ...(edgeFade > 0 ? { "--bkm-choro-edge": `${edgeFade}%` } : {}),
});

/** The surface's host box at `ratio` (`surfaceBox`), in RendererChart.js:116-119's order. */
export const choroplethSurfaceStyle = (ratio: number): StyleObject => surfaceHostStyle(surfaceBox({ aspectRatio: ratio }));

/** Whether `ChoroplethFeature`'s `patterns` gives defs to render. */
export const hasPatterns = (featureConfig: ChoroplethFeatureProps | undefined): boolean =>
  !(featureConfig?.patterns === undefined || featureConfig.patterns === null || featureConfig.patterns === false);

/** The hidden svg the pattern defs render in (`aria-hidden`, out of flow, no box). */
export const PATTERN_DEFS_STYLE: StyleObject = { height: 0, position: "absolute", width: 0 };
