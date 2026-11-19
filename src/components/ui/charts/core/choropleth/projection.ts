import { geoGraticule, geoMercator } from "d3-geo";
import type { GeoProjection } from "d3-geo";
import type { ChartBounds } from "@tanstack/charts";
import type { ChoroplethFeature, ChoroplethFeatureProps } from "../types/choropleth";

const FEATURES_ID = "choropleth";
const GRATICULE_ID = "choropleth-graticule";
/** The markers' hidden mark: one point per `ChoroplethMarker`, so a hovered marker's tooltip is the chart's own (definition.ts). */
const MARKERS_ID = "choropleth-markers";
const DEFAULT_COLORS = ["var(--chart-scale-01)", "var(--chart-scale-02)", "var(--chart-scale-03)", "var(--chart-scale-04)", "var(--chart-scale-05)"];
const REFERENCE_WIDTH = 630;
const BASE_SCALE = 100;
const TRANSLATE_Y_OFFSET = 50;

const resolveFill = (feature: ChoroplethFeature, index: number, config: Readonly<ChoroplethFeatureProps> | undefined, idPrefix = ""): string => {
  const patternId = config?.getFeaturePattern?.(feature, index);
  // bklit's truthiness test (choropleth/choropleth-feature.tsx:44): `null`, `undefined` and "" all fall through to the colour.
  if (patternId !== undefined && patternId !== null && patternId !== "") {return `url(#${idPrefix}${patternId})`;}
  if (config?.fill !== undefined && config.fill !== "") {return config.fill;}
  if (config?.getFeatureColor !== undefined) {return config.getFeatureColor(feature, index);}
  return DEFAULT_COLORS[index % DEFAULT_COLORS.length] ?? "var(--chart-1)";
};

const featureKey = (feature: Readonly<Pick<ChoroplethFeature, "properties" | "id">>): string => feature.properties?.name ?? String(feature.id ?? "");

interface ProjectionOptions {
  readonly scale: number | undefined;
  readonly center: [number, number];
  readonly translate: [number, number] | undefined;
  readonly k: number;
  readonly tx: number;
  readonly ty: number;
}

// Single projection recipe shared by the geoShape layers and the context helpers.
// Zoom rides the projection (scale*k, translate*k+t) so geoShape repaints natively.
const makeProjection = (bounds: Readonly<ChartBounds>, o: Readonly<ProjectionOptions>): GeoProjection => {
  const baseScale = o.scale ?? (bounds.width > 0 ? (bounds.width / REFERENCE_WIDTH) * BASE_SCALE : BASE_SCALE);
  const baseTranslate = o.translate ?? [bounds.x + bounds.width / 2, bounds.y + bounds.height / 2 + TRANSLATE_Y_OFFSET];
  return geoMercator()
    .center(o.center)
    .scale(baseScale * o.k)
    .translate([o.k * baseTranslate[0] + o.tx, o.k * baseTranslate[1] + o.ty]);
};

const graticuleFeature = (step: [number, number] | undefined): ChoroplethFeature => ({
  geometry: (step ? geoGraticule().step(step) : geoGraticule())(),
  properties: { name: "graticule" },
  type: "Feature",
});

export { DEFAULT_COLORS, FEATURES_ID, featureKey, GRATICULE_ID, graticuleFeature, makeProjection, MARKERS_ID, resolveFill };
export type { ProjectionOptions };
