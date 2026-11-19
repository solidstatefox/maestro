import { defineChart } from "@tanstack/charts/scene";
import { geoShape } from "@tanstack/charts/geo";
import type { ChartBounds, DomChartDefinition } from "@tanstack/charts";
import { erase } from "../erased-types";
import type { FeatureCollection, Geometry } from "geojson";
import type { GeoProjection } from "d3-geo";
import { bklitTooltip } from "../tooltip/bklit-tooltip";
import { TOOLTIP_MOTION, TOOLTIP_OFFSET } from "../theme";
import type { createLayerMotion } from "./enter";
import { FEATURES_ID, featureKey, GRATICULE_ID, graticuleFeature, makeProjection, MARKERS_ID, resolveFill } from "./projection";
import type { ProjectionOptions } from "./projection";
import { tooltipAnchor } from "./tooltip-anchor";
import type { TooltipFollow } from "./tooltip-follow";
import { createGeoContainmentFocus } from "./focus";
import type { GeoGeometry, ProjectionHolder } from "./focus";
import type { ChoroplethFeatureProps, ChoroplethTooltipProps, ChoroplethFeature, ChoroplethFeatureProperties, ChoroplethGraticuleProps, ChoroplethMarkerProps, Margin } from "../types/choropleth";

interface DefinitionInput {
  readonly data: FeatureCollection<Geometry, ChoroplethFeatureProperties>;
  readonly margin: Margin;
  readonly center: [number, number];
  readonly scale: number | undefined;
  readonly translate: [number, number] | undefined;
  readonly holder: ProjectionHolder;
  readonly geometry: GeoGeometry;
  readonly patternPrefix: string;
  readonly featureConfig: ChoroplethFeatureProps | undefined;
  readonly graticuleConfig: ChoroplethGraticuleProps | undefined;
  readonly tooltipConfig: ChoroplethTooltipProps | undefined;
  readonly layerMotion: ReturnType<typeof createLayerMotion>;
  /** A dot grid draws the map without a `ChoroplethFeatureComponent`: the features stay (hover, keyboard, tooltip) but aren't painted. */
  readonly unpainted: boolean;
  /** The markers: an unpainted point each, which their hover focuses so the tooltip is the chart's own (markers.ts). */
  readonly markers: readonly ChoroplethMarkerProps[];
  /** The tooltip's placement, which the controller moves with the map (tooltip-follow.ts). */
  readonly follow: TooltipFollow;
}

/** A marker's point of the hidden markers mark: a GeoJSON Point carrying its tooltip data. */
const markerFeature = ({ label, coordinates }: ChoroplethMarkerProps): ChoroplethFeature => ({
  geometry: { coordinates, type: "Point" },
  properties: { marker: { coordinates, label }, name: label },
  type: "Feature",
});

/** The chart definition: features geoShape, optional graticule layer, and the built-in tooltip (the hovered-feature highlight is an owned svg, highlight.ts). */
export const createDefinition = (input: DefinitionInput): DomChartDefinition<ChoroplethFeature, number, number> => {
  const { data, margin, center, scale, translate, holder, geometry, patternPrefix, featureConfig, graticuleConfig, tooltipConfig, layerMotion, unpainted, markers, follow } = input;
  const projectionOptions: ProjectionOptions = { center, k: 1, scale, translate, tx: 0, ty: 0 };
  const projection = (context: { chart: ChartBounds }): GeoProjection => {
    // The same chart area and options keep the projection and its per-feature geometry.
    const { x, y, width, height } = context.chart;
    const key = [x, y, width, height, center.join(), scale, translate?.join()].join("|");
    if (holder.projection !== undefined && holder.projectionKey === key) {return holder.projection;}
    holder.projection = makeProjection(context.chart, projectionOptions);
    holder.projectionKey = key;
    holder.chart = context.chart;
    // Hit-test geometry is built with the projection (load), not on the first hover moves.
    geometry.warm(data.features);
    return holder.projection;
  };
  const stroke = featureConfig?.stroke ?? "var(--bkm-background)";
  const features = geoShape(data.features, {
    // Documented geo `className` hook (reference/marks/geo.md): the CSS selects the group by class.
    className: unpainted ? "bkm-choro-features bkm-choro-unpainted" : "bkm-choro-features",
    fill: unpainted ? "none" : (feature, context) => resolveFill(feature, context.index, featureConfig, patternPrefix),
    id: FEATURES_ID,
    key: featureKey,
    motion: layerMotion,
    projection,
    stroke: unpainted ? "none" : stroke,
    strokeWidth: featureConfig?.strokeWidth ?? 0.5,
  });
  const markerPoints = markers.length === 0
    ? []
    : [geoShape(markers.map(markerFeature), {
        className: "bkm-choro-unpainted",
        fill: "none",
        id: MARKERS_ID,
        key: (feature) => `marker:${feature.properties?.name ?? ""}`,
        projection,
        stroke: "none",
      })];
  const graticule = graticuleConfig
    ? [geoShape([graticuleFeature(graticuleConfig.step)], {
        className: graticuleConfig.hideOnFocus === false ? "bkm-choro-graticule" : "bkm-choro-graticule bkm-choro-hide-on-focus",
        fill: "none",
        id: GRATICULE_ID,
        key: () => GRATICULE_ID,
        motion: layerMotion,
        projection,
        // Divergence: bklit's default is `rgba(255,255,255,0.1)` (choropleth/choropleth-graticule.tsx:17), white on any surface, so it vanishes on a light
        // card. `--chart-graticule` is the theme's `--border` (styles.css), which on shadcn's dark theme is that same white at 10%.
        stroke: graticuleConfig.stroke ?? "var(--chart-graticule)",
        strokeWidth: graticuleConfig.strokeWidth ?? 0.5,
      })]
    : [];
  return erase(defineChart({
    focus: createGeoContainmentFocus<ChoroplethFeature>(FEATURES_ID, holder, geometry),
    focusRing: false,
    guides: false,
    margin,
    // The graticule paints first, behind the features (its docs). bklit paints its svg children in the order written
    // (choropleth/choropleth-chart.tsx:231), and its docs write `<ChoroplethGraticule />` before `<ChoroplethFeature />`.
    marks: [...graticule, features, ...markerPoints],
    maxFocusDistance: 0,
    scales: { x: null, y: null },
    // `portal`: the native placement without the per-paint size read (gap #21, kit/tooltip/sized-tooltip-placement.ts), kept so it follows the map.
    tooltip: tooltipConfig
      ? { anchor: follow.anchor(tooltipAnchor(holder, geometry)), className: "bkm-choro-tooltip", motion: TOOLTIP_MOTION, offset: TOOLTIP_OFFSET, placement: ["right", "left"], portal: follow.portal(), sticky: false, use: bklitTooltip }
      : false,
  }));
};
