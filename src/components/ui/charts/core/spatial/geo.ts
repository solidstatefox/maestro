import type { ChartBounds, ChartFocusStrategy, ChartPoint } from "@tanstack/charts";
import { geoShape } from "@tanstack/charts/geo";
import { decorative } from "@tanstack/charts/mark/decorative";
import { geoCentroid, geoEqualEarth, geoGraticule, geoMercator, geoNaturalEarth1, geoOrthographic } from "d3-geo";
import type { GeoPermissibleObjects, GeoProjection } from "d3-geo";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { erase } from "../erased-types";
import type { AnyMark } from "../erased-types";
import type { SpatialRow } from "../types/spatial";

/** The projections a map can use. */
export type SpatialProjection = "equal-earth" | "natural-earth" | "mercator" | "orthographic";

/** The world, as a fit target. */
const SPHERE: GeoPermissibleObjects = { type: "Sphere" };

const FACTORIES: Readonly<Record<SpatialProjection, () => GeoProjection>> = {
  "equal-earth": geoEqualEarth,
  mercator: geoMercator,
  "natural-earth": geoNaturalEarth1,
  orthographic: geoOrthographic,
};

/** How a chart's projection is made: its kind, rotation and what it fits into the plot. */
export interface GeoFrame {
  readonly projection: SpatialProjection;
  /** `[λ, φ]` or `[λ, φ, γ]` in degrees. */
  readonly rotate: readonly number[];
  /** The world (`"sphere"`), or the geography's features (a region). */
  readonly fit: GeoPermissibleObjects;
  /** Space between the fitted shape and the plot's edge, in px. */
  readonly inset: number;
}

/** One chart's projection, rebuilt only when the plot's box or the frame changes; the layers and the hover read the same instance. */
export interface GeoProjectionHolder {
  /** The projection for the plot `chart` (what every layer's `projection` callback returns). */
  at(chart: ChartBounds): GeoProjection;
  /** The last projection built (the hover's), or null before the first draw. */
  current(): GeoProjection | null;
}

export const createGeoProjectionHolder = (frame: () => GeoFrame): GeoProjectionHolder => {
  let built: { readonly key: string; readonly projection: GeoProjection; readonly frame: GeoFrame } | null = null;
  return {
    at(chart) {
      const f = frame();
      const key = `${chart.x}|${chart.y}|${chart.width}|${chart.height}`;
      if (built !== null && built.key === key && built.frame === f) {
        return built.projection;
      }
      const [l = 0, p = 0, g = 0] = f.rotate;
      const projection = FACTORIES[f.projection]().rotate([l, p, g]);
      const { inset } = f;
      projection.fitExtent([[chart.x + inset, chart.y + inset], [chart.x + chart.width - inset, chart.y + chart.height - inset]], f.fit);
      built = { key, projection, frame: f };
      return projection;
    },
    current: () => built?.projection ?? null,
  };
};

/** A layer's `projection` option: the holder's projection for the plot TanStack resolved. */
export const projectionOption = (holder: GeoProjectionHolder) => (context: { readonly chart: ChartBounds }): GeoProjection => holder.at(context.chart);

/** What a map fits: the geography or the data's places when asked (and there are some), else the world. */
export const fitTarget = (fit: "sphere" | "geography" | "data" | undefined, geography: FeatureCollection | undefined, places: readonly (readonly [number, number])[]): GeoPermissibleObjects => {
  if (fit === "geography" && geography !== undefined) {
    return erase(geography);
  }
  if (fit === "data" && places.length > 0) {
    return { type: "MultiPoint", coordinates: places.map(([lon, lat]) => [lon, lat]) };
  }
  return SPHERE;
};

/** A map family's rules: the land past the plot (a region's neighbours) never spills over the card. */
export const mapCss = (chart: string): string => `[data-bkm-chart="${chart}"] svg.ts-chart{overflow:hidden!important}`;

/** Props of a map's land layer (`BubbleMapLand`, `RouteMapLand`, `GlobeLand`). */
export interface SpatialLandProps {
  /**
   * Fill of the land.
   * @default "var(--muted)"
   */
  readonly fill?: string;
  /**
   * Color of the borders between countries.
   * @default "var(--chart-background)"
   */
  readonly stroke?: string;
  /**
   * Width of the borders, in pixels.
   * @default 0.5
   */
  readonly strokeWidth?: number;
}

/** Props of a map's graticule (`BubbleMapGraticule`, `RouteMapGraticule`, `GlobeGraticule`). */
export interface SpatialGraticuleProps {
  /**
   * Degrees between the lines, `[longitude, latitude]`.
   * @default [20, 20]
   */
  readonly step?: readonly [number, number];
  /**
   * Color of the lines.
   * @default "var(--chart-graticule)"
   */
  readonly stroke?: string;
  /**
   * Width of the lines, in pixels.
   * @default 0.5
   */
  readonly strokeWidth?: number;
}

export const LAND_ID = "geo-land";
export const GRATICULE_ID = "geo-graticule";
export const SPHERE_ID = "geo-sphere";

const landKey = (feature: Feature<Geometry, { readonly name?: unknown } | null>, index: number): string => String(feature.properties?.name ?? feature.id ?? index);

// A feature's spherical centroid, once: geoShape computes one per feature per draw unless given an `anchor`, the most of a redraw's
// time on a dragged globe.
const centroids = /* @__PURE__ */ new WeakMap<object, readonly [number, number]>();
const anchorOf = (feature: GeoPermissibleObjects): readonly [number, number] => {
  let found = centroids.get(feature);
  if (found === undefined) {
    found = geoCentroid(feature);
    centroids.set(feature, found);
  }
  return found;
};

/** The land: one path per country, decorative (it never takes focus), no motion on a redraw (a drag redraws every frame). */
export const landLayer = (geography: FeatureCollection, holder: GeoProjectionHolder, props: SpatialLandProps): AnyMark =>
  decorative(geoShape(erase(geography.features), erase({
    id: LAND_ID,
    projection: projectionOption(holder),
    key: (feature: Feature<Geometry, { readonly name?: unknown } | null>, context: { readonly index: number }) => landKey(feature, context.index),
    anchor: anchorOf,
    fill: props.fill ?? "var(--muted)",
    stroke: props.stroke ?? "var(--chart-background)",
    strokeWidth: props.strokeWidth ?? 0.5,
    motion: false,
  })));

/** The graticule: one path of meridians and parallels. */
export const graticuleLayer = (holder: GeoProjectionHolder, props: SpatialGraticuleProps): AnyMark => {
  const [lon, lat] = props.step ?? [20, 20];
  return decorative(geoShape(erase([geoGraticule().step([lon, lat])()]), erase({
    id: GRATICULE_ID,
    projection: projectionOption(holder),
    key: () => GRATICULE_ID,
    anchor: () => [0, 0],
    fill: "none",
    stroke: props.stroke ?? "var(--chart-graticule)",
    strokeWidth: props.strokeWidth ?? 0.5,
    motion: false,
  })));
};

/** The sphere: the world's outline, filled (the globe's ocean) or not. */
export const sphereLayer = (holder: GeoProjectionHolder, fill: string, stroke: string): AnyMark =>
  decorative(geoShape(erase([SPHERE]), erase({
    id: SPHERE_ID,
    projection: projectionOption(holder),
    key: () => SPHERE_ID,
    anchor: () => [0, 0],
    fill,
    stroke,
    strokeWidth: 1,
    motion: false,
  })));

/** A row's `[longitude, latitude]`, or null when either is missing. */
export const lonLatOf = (row: SpatialRow, longitudeKey: string, latitudeKey: string): [number, number] | null => {
  const lon = row[longitudeKey];
  const lat = row[latitudeKey];
  return typeof lon === "number" && Number.isFinite(lon) && typeof lat === "number" && Number.isFinite(lat) ? [lon, lat] : null;
};

/**
 * A focus over the family's own marks only (`marks`): `pick` chooses among them for a pointer (null: nothing), and the keyboard steps
 * through them west to east. TanStack's other points (the land's centroids) are never focused.
 */
export const geoFocus = (marks: ReadonlySet<string>, pick: (points: readonly ChartPoint[], x: number, y: number) => ChartPoint | null): ChartFocusStrategy =>
  erase({
    group: (_points: readonly ChartPoint[], context: { readonly point: ChartPoint }) => [context.point],
    navigation: (points: readonly ChartPoint[]) => points.filter((point) => marks.has(point.markId)).sort((a, b) => a.x - b.x || a.y - b.y),
    resolve: (points: readonly ChartPoint[], context: { readonly x: number; readonly y: number }) => {
      const own = points.filter((point) => marks.has(point.markId));
      const point = pick(own, context.x, context.y);
      return point === null ? [] : [point];
    },
  });

/** The nearest point within `max` px, or null. */
export const nearestWithin = (points: readonly ChartPoint[], x: number, y: number, max: number): ChartPoint | null => {
  let best: ChartPoint | null = null;
  let bestD = max * max;
  for (const point of points) {
    const d = (point.x - x) ** 2 + (point.y - y) ** 2;
    if (d <= bestD) {
      best = point;
      bestD = d;
    }
  }
  return best;
};
