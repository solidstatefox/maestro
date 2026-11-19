import type { ChartBounds, ChartPoint } from "@tanstack/charts";
import type { GeoGeometry, ProjectionHolder } from "./focus";
import { centroidOf } from "./focus";
import { MARKERS_ID } from "./projection";
import type { ChoroplethFeature } from "../types/choropleth";

interface ScreenPoint {
  x: number;
  y: number;
}

const TOOLTIP_CLAMP = 60;

const clamp = (value: number, min: number, size: number): number => Math.max(min + TOOLTIP_CLAMP, Math.min(min + size - TOOLTIP_CLAMP, value));

// bklit's tooltip point: the projected geographic centroid (path.centroid skews toward Alaska/Russia), clamped to the unzoomed map so edge
// features keep their tooltip inside it, in base (unzoomed) space; bklit applies the zoom transform to it afterwards.
export const baseTooltipPoint = (holder: Readonly<ProjectionHolder>, feature: ChoroplethFeature): ScreenPoint | undefined => {
  const { chart, projection } = holder;
  const [lon, lat] = centroidOf(feature);
  const base = projection?.([lon, lat]);
  if (!chart || !base || !Number.isFinite(base[0]) || !Number.isFinite(base[1])) {return undefined;}
  return { x: clamp(base[0], chart.x, chart.width), y: clamp(base[1], chart.y, chart.height) };
};

// Hover anchors where bklit does (the zoomed base point). A keyboard stop is any feature with a visible piece, whose centroid can sit
// off screen while zoomed: then the anchor is the centre of the feature's largest visible piece, so the tooltip is next to what is drawn.
export const tooltipAnchor = (holder: Readonly<ProjectionHolder>, geometry: GeoGeometry) =>
  (points: readonly ChartPoint<ChoroplethFeature>[], context: { focus: { source: string }; plot: ChartBounds }): ScreenPoint | undefined => {
    const first = points.at(0);
    if (first === undefined) {return undefined;}
    const { k, x: tx, y: ty } = holder.transform;
    // Map space to the chart box: the camera and the zoom, then the tilted plane's projection when there is one.
    const zoomed = (point: Readonly<ScreenPoint>): ScreenPoint => {
      const flat = { x: point.x * k + tx, y: point.y * k + ty };
      return holder.plane?.project(flat) ?? flat;
    };
    if (first.markId === MARKERS_ID) {
      // A marker's tooltip sits at the marker (it keeps its size, so no clamp: it is where it is drawn).
      const [lon, lat] = centroidOf(first.datum);
      const p = holder.projection?.([lon, lat]);
      return p ? zoomed({ x: p[0], y: p[1] }) : undefined;
    }
    const base = baseTooltipPoint(holder, first.datum);
    const anchor = zoomed(base ?? { x: first.x, y: first.y });
    if (context.focus.source !== "keyboard") {return anchor;}
    const { plot } = context;
    if (anchor.x >= plot.x && anchor.x <= plot.x + plot.width && anchor.y >= plot.y && anchor.y <= plot.y + plot.height) {return anchor;}
    const piece = geometry.visibleCenter(first.datum);
    return piece ? zoomed({ x: piece[0], y: piece[1] }) : anchor;
  };
