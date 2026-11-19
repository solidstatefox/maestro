import type { ChartPoint } from "@tanstack/charts";
import type { ChildTable } from "../carriers/table";
import type { MarkupNode, MarkupTree } from "../markup/node";
import type { StyleObject } from "../style";
import type { TooltipRow } from "../types/tooltip";
import type { SpatialSkeletonLayer } from "./loading";
import type { ChartDescriber } from "../a11y/describe";

/** A mark the hover dims (its group, `g[data-ts-key="<id>"]`) while one of its points is focused. */
export interface SpatialHoverLayer {
  /** The mark's id. */
  readonly markId: string;
  /** Opacity of the layer while a point of a hover layer is focused. */
  readonly inactiveOpacity: number;
  /** Fade into and out of the dim (the hover profile's transition). Off for a chart of many marks: an animated group effect re-layerizes
   * every paint chunk of the chart each frame (`SPATIAL_FADE_LIMIT`). */
  readonly fade: boolean;
}

/** The most marks a chart fades its dim over: past it the dim snaps (a transition costs ~3 ms a frame at 4x throttle on 500 marks). */
export const SPATIAL_FADE_LIMIT = 320;

/** What the hover draws over the chart for a focused point (the "lift": the hovered mark redrawn on top), in the chart svg's coordinates. */
export type SpatialLift = (point: ChartPoint) => MarkupNode | null;

/** How a mark's elements enter (entrance.ts): `wave` sweeps across x, `radial` out from the plot's center, `grow` from each mark's own
 * center in data order, `levels` one after another (contour bands), `draw` traces each path's stroke, `fade` the whole layer at once. */
export type SpatialEntranceKind = "wave" | "radial" | "grow" | "levels" | "draw" | "fade";

/** One mark's entrance. */
export interface SpatialEntrance {
  readonly markId: string;
  readonly kind: SpatialEntranceKind;
  /** Delay before this mark's first element starts (ms). */
  readonly delay?: number;
  /** One element's own animation (ms). */
  readonly duration?: number;
  /** Starting scale of a growing element (`wave`, `radial`, `grow`, `levels`). */
  readonly fromScale?: number;
}

/** The tooltip's content for focused points: what the reader's `content` gets, and the default title and rows. */
export interface SpatialTooltipShown {
  readonly args: Readonly<Record<string, unknown>>;
  readonly title: string;
  readonly rows: readonly TooltipRow[];
}

/** The tooltip carrier's props as the framework's tooltip leaf reads them (`content`, `className`, `panelStyle`, `backgroundColor`, the
 * family's own), and what to show for the focused points. */
export interface SpatialTooltipPlan {
  readonly carrier: Readonly<Record<string, unknown>>;
  /** The content for the focused points; undefined: the renderer's default body. */
  readonly shown: (points: readonly ChartPoint[]) => SpatialTooltipShown | undefined;
}

/** The tooltip content for the focused points, given the tooltip carrier's props (undefined: the renderer's default body). */
export type SpatialDescribe = (points: readonly ChartPoint[], carrier: Readonly<Record<string, unknown>>) => SpatialTooltipShown | undefined;

/** A pointer drag the family handles (the globe's rotation): `move` returns whether the chart must draw again. With `draw`, the frames
 * in between are the family's own, drawn into an svg over the plot (the renderer's marks hidden), and the renderer draws once on release:
 * a full scene a frame is too slow for a drag. */
export interface SpatialDrag {
  start(): void;
  move(dx: number, dy: number): boolean;
  end(): void;
  /** Draws the current drag frame into `svg` (the plot's viewBox, emptied by the family as it likes). */
  draw?(svg: SVGSVGElement): void;
}

/** One pass: everything a family derives from its props and carrier table. */
export interface SpatialBuild {
  /** The TanStack definition (`defineChart`). */
  readonly definition: object;
  /** The parsed aspect ratio. */
  readonly aspectRatio: number;
  readonly ariaLabel: string;
  readonly ariaDescription: string | undefined;
  /** The chart's data for screen readers (core/a11y/describe.ts): the svg's summary, a `<ChartDataTable>`'s rows. */
  readonly describeData?: ChartDescriber;
  /** The layers the hover dims; empty: no dim. */
  readonly hoverLayers: readonly SpatialHoverLayer[];
  /** The marks whose points are hoverable (their focus dims `hoverLayers` and draws the lift). */
  readonly focusMarks: ReadonlySet<string>;
  readonly lift: SpatialLift | null;
  readonly entrance: readonly SpatialEntrance[];
  /** Host custom properties (the family's colors, sizes). */
  readonly hostVars: StyleObject;
  /** Host attributes beside the chart's own. */
  readonly hostAttrs: Readonly<Record<string, string | undefined>>;
  /** The legend under the plot; null: none. */
  readonly legend: MarkupTree | null;
  /** What the tooltip shows for focused points with the tooltip carrier's props; null without a tooltip carrier. */
  readonly describe: SpatialDescribe | null;
  /** A pointer drag on the plot (the globe); null: none. */
  readonly drag: SpatialDrag | null;
  /** While loading: the skeleton's layers (`spatialSkeleton`, their marks in `definition` in place of the data's); how each pulses. */
  readonly skeleton?: readonly SpatialSkeletonLayer[];
}

/** What a build reads. */
export interface SpatialBuildInput<Props> {
  readonly props: Props;
  readonly table: ChildTable;
  /** The chart's id (svg ids are prefixed with it). */
  readonly uid: string;
  /** Bumped by the controller when the family's drag asks for a redraw (`SpatialDrag.move`): a new value means a new definition. */
  readonly frame: number;
  /** `status="loading"`: the definition draws the family's skeleton (loading.ts `spatialSkeleton`) and the chrome (axes, grid, land),
   * not the data's marks, and takes no focus or tooltip. */
  readonly loading: boolean;
}

/** The props every spatial chart's controller reads beside its family's (core/types/spatial.ts `SpatialChartBaseProps`). */
export const SPATIAL_BASE_KEYS = ["aspectRatio", "margin", "animate", "animationDuration", "revealSignature", "status", "loadingLabel", "ariaLabel", "ariaDescription"] as const;

/** A spatial family: its name and its pass builder. */
export interface SpatialFamily<Props> {
  /** `data-bkm-chart` on the host. */
  readonly chart: string;
  /** The family's static rules, written once in the chart's owned <style> (scoped by `[data-bkm-chart="<chart>"]`). */
  readonly css: string;
  /** The carrier roles a definition reads: the tooltip's are left out, so a new `content` function never rebuilds the marks. */
  readonly definitionRoles: readonly string[];
  /** The tooltip carrier's role: whether there is one rebuilds the definition, its props only the tooltip's plan. */
  readonly tooltipRole: string;
  /** The props a definition reads (the rest, such as `className`, never rebuild it). */
  readonly definitionProps: readonly string[];
  /** Every prop the controller takes (the ports read these off their props). */
  readonly keys: readonly string[];
  /** A builder, made once per chart (it may keep memo cells and per-chart state). */
  readonly createBuilder: () => (input: SpatialBuildInput<Props>) => SpatialBuild;
}
