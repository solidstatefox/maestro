import type { ChartBounds, ChartPoint, SceneNode } from "@tanstack/charts";
import { geoShape } from "@tanstack/charts/geo";
import { defineChart } from "@tanstack/charts/scene";
import { geoInterpolate, geoPath } from "d3-geo";
import type { GeoProjection } from "d3-geo";
import type { Feature, LineString, Point } from "geojson";
import { propsFor } from "../carriers/table";
import { erase } from "../erased-types";
import type { AnyMark } from "../erased-types";
import { el } from "../markup/node";
import { CHART_PALETTE } from "../palette";
import { SPATIAL_BASE_KEYS, SPATIAL_FADE_LIMIT } from "../spatial/family";
import type { SpatialBuild, SpatialBuildInput, SpatialEntrance, SpatialFamily, SpatialHoverLayer } from "../spatial/family";
import { createGeoProjectionHolder, fitTarget, geoFocus, graticuleLayer, landLayer, LAND_ID, mapCss, projectionOption, sphereLayer } from "../spatial/geo";
import type { GeoFrame, GeoProjectionHolder } from "../spatial/geo";
import { round2, skeletonDot, skeletonPlaces, skeletonStroke, spatialSkeleton } from "../spatial/loading";
import type { SpatialSkeletonLayer } from "../spatial/loading";
import { seriesLegend } from "../spatial/legend";
import { formatSpatialValue, spatialTooltipOption } from "../spatial/tooltip";
import { bklitTheme, parseAspectRatio } from "../theme";
import type { RouteMapChartProps, RouteMapGraticuleProps, RouteMapLandProps, RouteMapLegendProps, RouteMapPlace, RouteMapPlacesProps, RouteMapRoute, RouteMapRoutesProps, RouteMapTooltipProps } from "../types/route-map";
import { describeRoutes } from "../spatial/describe";

/** What the description reads of a tooltip carrier: its value label and format. */
type SpatialTip = { readonly valueLabel?: string; readonly formatValue?: (value: number) => string };

/** The route map's carrier roles. */
export const ROUTE_MAP_ROLES = {
  land: "routeMapLand",
  graticule: "routeMapGraticule",
  routes: "routeMapRoutes",
  places: "routeMapPlaces",
  tooltip: "routeMapTooltip",
  legend: "routeMapLegend",
} as const;

/** What a RouteMapChart hands its controller (the adapter keeps `className` and `children`). */
export type RouteMapProps = Omit<RouteMapChartProps<unknown>, "className" | "children">;

const ROUTES_ID = "route-map-routes";
const PLACES_ID = "route-map-places";
const SKELETON_ROUTES_ID = "skeleton-route-map-routes";
const SKELETON_PLACES_ID = "skeleton-route-map-places";
const SKELETON_PLACES = 8;
/** The skeleton's routes, as indices into its places: two hubs, each with a few spokes. */
const SKELETON_LINKS = [[0, 2], [0, 3], [0, 4], [0, 1], [1, 5], [1, 6], [1, 7], [3, 5]] as const;
/** How far a skeleton arc bows from its chord, as a share of its length. */
const ARC_BOW = 0.22;

/** The skeleton's places on the land (anywhere on the world without a geography). */
const routePlaces = (holder: GeoProjectionHolder, geography: RouteMapProps["geography"], chart: ChartBounds): readonly (readonly [number, number])[] =>
  skeletonPlaces(chart, holder.at(chart), geography, SKELETON_PLACES, 11);

/** The skeleton's arcs: each link bowed upward from its chord, as a great circle reads on a world map. */
const routeSkeleton = (holder: GeoProjectionHolder, geography: RouteMapProps["geography"], width: number) => (chart: ChartBounds): SceneNode[] => {
  const places = routePlaces(holder, geography, chart);
  const nodes: SceneNode[] = [];
  for (const [i, [from, to]] of SKELETON_LINKS.entries()) {
    const a = places[from];
    const b = places[to];
    if (a === undefined || b === undefined) {
      continue;
    }
    const [ax, ay] = a;
    const [bx, by] = b;
    const length = Math.hypot(bx - ax, by - ay);
    // The normal on the chord's upper side.
    const sign = bx >= ax ? 1 : -1;
    const nx = (sign * (by - ay)) / (length || 1);
    const ny = (sign * -(bx - ax)) / (length || 1);
    const cx = (ax + bx) / 2 + nx * length * ARC_BOW;
    const cy = (ay + by) / 2 + ny * length * ARC_BOW;
    nodes.push(skeletonStroke(`${SKELETON_ROUTES_ID}:${i}`, `M${round2(ax)},${round2(ay)}Q${round2(cx)},${round2(cy)} ${round2(bx)},${round2(by)}`, { strokeWidth: width, strokeOpacity: 0.8 }));
  }
  return nodes;
};

/** The skeleton's places: a dot on each. */
const placeSkeleton = (holder: GeoProjectionHolder, geography: RouteMapProps["geography"], radius: number) => (chart: ChartBounds): SceneNode[] =>
  routePlaces(holder, geography, chart).map(([x, y], i) => skeletonDot(`${SKELETON_PLACES_ID}:${i}`, x, y, radius, { stroke: "var(--chart-background)", strokeWidth: 1.5 }));
const WIDTH_CLASSES = 4;
/** How close the pointer must come to a route, in pixels. */
const ROUTE_REACH_PX = 6;
/** Points sampled along each great circle for the hit test. */
const ARC_SAMPLES = 32;

interface RouteProperties {
  readonly route: RouteMapRoute;
  readonly index: number;
  readonly width: number;
  readonly color: string;
  /** The route's great circle, sampled (`[longitude, latitude]`). */
  readonly arc: readonly (readonly [number, number])[];
}

interface PlaceProperties {
  readonly place: RouteMapPlace;
  readonly index: number;
  readonly routes: number;
}

const lastOf = <T>(table: SpatialBuildInput<RouteMapProps>["table"], role: string): T | undefined => propsFor<T>(table, role).at(-1);

/** The distance from (x, y) to the segment (ax, ay)-(bx, by), squared. */
const segmentDistance2 = (x: number, y: number, ax: number, ay: number, bx: number, by: number): number => {
  const dx = bx - ax;
  const dy = by - ay;
  const length2 = dx * dx + dy * dy;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length2));
  const px = ax + t * dx - x;
  const py = ay + t * dy - y;
  return px * px + py * py;
};

const createRouteMapBuilder = () => {
  let frame: GeoFrame = { projection: "equal-earth", rotate: [0, 0], fit: { type: "Sphere" }, inset: 4 };
  const holder = createGeoProjectionHolder(() => frame);
  // Each route's projected arc, for the projection it was projected with (a resize or a new frame projects again).
  let projected: { readonly projection: GeoProjection; readonly arcs: Map<number, readonly (readonly [number, number])[]> } | null = null;
  const arcOf = (properties: RouteProperties, projection: GeoProjection): readonly (readonly [number, number])[] => {
    if (projected?.projection !== projection) {
      projected = { projection, arcs: new Map() };
    }
    let arc = projected.arcs.get(properties.index);
    if (arc === undefined) {
      const out: [number, number][] = [];
      for (const lonLat of properties.arc) {
        const at = projection([lonLat[0], lonLat[1]]);
        if (at !== null) { out.push([at[0], at[1]]); }
      }
      arc = out;
      projected.arcs.set(properties.index, arc);
    }
    return arc;
  };
  return (input: SpatialBuildInput<RouteMapProps>): SpatialBuild => {
    const { props, table, loading } = input;
    const { data, geography } = props;
    const land = lastOf<RouteMapLandProps>(table, ROUTE_MAP_ROLES.land);
    const graticule = lastOf<RouteMapGraticuleProps>(table, ROUTE_MAP_ROLES.graticule);
    const routesProps = lastOf<RouteMapRoutesProps>(table, ROUTE_MAP_ROLES.routes);
    const placesProps = lastOf<RouteMapPlacesProps>(table, ROUTE_MAP_ROLES.places);
    const legendProps = lastOf<RouteMapLegendProps>(table, ROUTE_MAP_ROLES.legend);
    const hasTooltip = table.has(ROUTE_MAP_ROLES.tooltip) && (routesProps !== undefined || placesProps !== undefined);
    const aspectRatio = parseAspectRatio(props.aspectRatio ?? "2 / 1");

    const placeById = new Map(data.places.map((place) => [place.id, place] as const));
    const routes = data.routes.filter((route) => placeById.has(route.from) && placeById.has(route.to));
    const nameOf = (id: string): string => placeById.get(id)?.name ?? id;

    // Widths by value, in up to four classes (geoShape takes one width per mark).
    const [minWidth, maxWidth] = routesProps?.widthRange ?? [1, 4];
    let maxValue = 0;
    for (const route of routes) { maxValue = Math.max(maxValue, route.value ?? 0); }
    const widthOf = (route: RouteMapRoute): number => {
      if (maxValue <= 0) { return minWidth; }
      const share = Math.sqrt(Math.max(0, route.value ?? 0) / maxValue);
      const step = Math.round(share * (WIDTH_CLASSES - 1)) / (WIDTH_CLASSES - 1);
      return minWidth + step * (maxWidth - minWidth);
    };
    const colorKey = routesProps?.colorKey;
    const categories: string[] = [];
    if (colorKey !== undefined) {
      for (const route of routes) {
        const category = String(route[colorKey] ?? "");
        if (!categories.includes(category)) { categories.push(category); }
      }
    }
    const colorOf = (route: RouteMapRoute): string => {
      if (colorKey === undefined) { return routesProps?.color ?? "var(--chart-1)"; }
      return CHART_PALETTE[categories.indexOf(String(route[colorKey] ?? "")) % CHART_PALETTE.length] ?? "var(--chart-1)";
    };

    const routeFeatures: Feature<LineString, RouteProperties>[] = routes.map((route, index) => {
      const from = placeById.get(route.from) as RouteMapPlace;
      const to = placeById.get(route.to) as RouteMapPlace;
      const a: [number, number] = [from.longitude, from.latitude];
      const b: [number, number] = [to.longitude, to.latitude];
      const between = geoInterpolate(a, b);
      const arc = Array.from({ length: ARC_SAMPLES + 1 }, (_, i) => between(i / ARC_SAMPLES));
      return { type: "Feature", geometry: { type: "LineString", coordinates: [a, b] }, properties: { route, index, width: widthOf(route), color: colorOf(route), arc } };
    });
    const routeCount = new Map<string, number>();
    for (const route of routes) {
      routeCount.set(route.from, (routeCount.get(route.from) ?? 0) + 1);
      routeCount.set(route.to, (routeCount.get(route.to) ?? 0) + 1);
    }
    const placeFeatures: Feature<Point, PlaceProperties>[] = data.places.map((place, index) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [place.longitude, place.latitude] },
      properties: { place, index, routes: routeCount.get(place.id) ?? 0 },
    }));

    const fitData = props.fit === "data";
    frame = {
      projection: props.projection ?? "equal-earth",
      rotate: props.rotate ?? [0, 0],
      fit: fitTarget(props.fit, geography, data.places.map((place) => [place.longitude, place.latitude] as const)),
      inset: fitData ? 24 : 4,
    };

    const marks: AnyMark[] = [];
    if (graticule !== undefined && graticule.outline !== false) {
      marks.push(sphereLayer(holder, "none", graticule.stroke ?? "var(--chart-graticule)"));
    }
    if (geography !== undefined && land !== undefined) {
      marks.push(landLayer(geography, holder, land));
    }
    if (graticule !== undefined) {
      marks.push(graticuleLayer(holder, graticule));
    }
    const routeMarkIds: string[] = [];
    const skeleton: SpatialSkeletonLayer[] = [];
    if (loading) {
      const landGeography = land === undefined ? undefined : geography;
      const arcs = spatialSkeleton(SKELETON_ROUTES_ID, routeSkeleton(holder, landGeography, (minWidth + maxWidth) / 2), { low: 0.25 });
      const dots = spatialSkeleton(SKELETON_PLACES_ID, placeSkeleton(holder, landGeography, placesProps?.radius ?? 3.5), { low: 0.35 });
      marks.push(arcs.mark, dots.mark);
      skeleton.push(arcs.layer, dots.layer);
    }
    if (routesProps !== undefined && !loading) {
      const widths = [...new Set(routeFeatures.map((feature) => feature.properties.width))].sort((a, b) => a - b);
      for (const [k, width] of widths.entries()) {
        const id = `${ROUTES_ID}-${k}`;
        routeMarkIds.push(id);
        marks.push(geoShape(erase(routeFeatures.filter((feature) => feature.properties.width === width)), erase({
          id,
          projection: projectionOption(holder),
          key: (feature: Feature<LineString, RouteProperties>) => feature.properties.index,
          fill: "none",
          stroke: (feature: Feature<LineString, RouteProperties>) => feature.properties.color,
          strokeWidth: width,
          strokeOpacity: routesProps.opacity ?? 0.8,
        })));
      }
    }
    if (placesProps !== undefined && !loading) {
      marks.push(geoShape(erase(placeFeatures), erase({
        id: PLACES_ID,
        projection: projectionOption(holder),
        key: (feature: Feature<Point, PlaceProperties>) => feature.properties.place.id,
        r: placesProps.radius ?? 3.5,
        fill: placesProps.color ?? "var(--chart-foreground)",
        stroke: "var(--chart-background)",
        strokeWidth: 1.5,
        anchor: (feature: Feature<Point, PlaceProperties>) => feature.geometry.coordinates,
      })));
    }
    const routeMarks = new Set(routeMarkIds);
    const focusMarks = new Set([...routeMarkIds, ...(placesProps === undefined ? [] : [PLACES_ID])]);
    const placeRadius = placesProps?.radius ?? 3.5;
    // SAFETY: a route mark's datum is its route feature, the places mark's its place feature (geoFocus keeps no other mark's points).
    const routeOf = (point: ChartPoint): Feature<LineString, RouteProperties> => point.datum as Feature<LineString, RouteProperties>;
    const placeOf = (point: ChartPoint): Feature<Point, PlaceProperties> => point.datum as Feature<Point, PlaceProperties>;
    const pick = (points: readonly ChartPoint[], x: number, y: number): ChartPoint | null => {
      const projection = holder.current();
      let best: ChartPoint | null = null;
      let bestD = (placeRadius + 4) ** 2;
      // A place under the pointer first.
      for (const point of points) {
        if (point.markId === PLACES_ID) {
          const d = (point.x - x) ** 2 + (point.y - y) ** 2;
          if (d <= bestD) {
            best = point;
            bestD = d;
          }
        }
      }
      if (best !== null || projection === null) {
        return best;
      }
      bestD = ROUTE_REACH_PX ** 2;
      // A width of the plot: a segment longer than it crosses the antimeridian (drawn in two pieces), never a hit.
      const jump = (projection.translate()[0] ?? 0) * 0.9;
      for (const point of points) {
        if (!routeMarks.has(point.markId)) { continue; }
        const arc = arcOf(routeOf(point).properties, projection);
        for (let i = 1; i < arc.length; i += 1) {
          const [ax, ay] = arc[i - 1] ?? [0, 0];
          const [bx, by] = arc[i] ?? [0, 0];
          if (Math.abs(bx - ax) > jump) { continue; }
          const d = segmentDistance2(x, y, ax, ay, bx, by);
          if (d <= bestD) {
            best = point;
            bestD = d;
          }
        }
      }
      return best;
    };
    const definition = defineChart(erase({
      marks,
      scales: { x: null, y: null },
      margin: { top: 0, right: 0, bottom: 0, left: 0, ...props.margin },
      theme: bklitTheme,
      focus: geoFocus(focusMarks, pick),
      maxFocusDistance: Number.POSITIVE_INFINITY,
      focusRing: false,
      tooltip: spatialTooltipOption(hasTooltip && !loading),
    }));

    const fade = routeFeatures.length + placeFeatures.length <= SPATIAL_FADE_LIMIT;
    const hoverLayers: SpatialHoverLayer[] = routesProps !== undefined && routesProps.fadeOnHover !== false
      ? routeMarkIds.map((markId) => ({ markId, inactiveOpacity: routesProps.inactiveOpacity ?? 0.25, fade }))
      : [];
    const entrance: SpatialEntrance[] = [];
    if (geography !== undefined && land !== undefined) {
      entrance.push({ markId: LAND_ID, kind: "fade", duration: 500 });
    }
    for (const markId of routeMarkIds) {
      entrance.push({ markId, kind: "draw", delay: 150, duration: 700 });
    }
    if (placesProps !== undefined) {
      entrance.push({ markId: PLACES_ID, kind: "grow", fromScale: 0, delay: 500, duration: 400 });
    }
    return {
      definition,
      aspectRatio,
      describeData: () => describeRoutes(data, propsFor<SpatialTip>(table, ROUTE_MAP_ROLES.tooltip).at(-1)?.valueLabel, propsFor<SpatialTip>(table, ROUTE_MAP_ROLES.tooltip).at(-1)?.formatValue),
      ariaLabel: props.ariaLabel ?? "Route map",
      ariaDescription: props.ariaDescription,
      hoverLayers,
      focusMarks,
      lift: (point) => {
        const projection = holder.current();
        if (point.markId === PLACES_ID) {
          return el("circle", { cx: point.x, cy: point.y, fill: placesProps?.color ?? "var(--chart-foreground)", r: placeRadius * 1.6, stroke: "var(--chart-background)", "stroke-width": 2 });
        }
        if (projection === null) {
          return null;
        }
        const feature = routeOf(point);
        const d = geoPath(projection)(feature);
        return d === null ? null : el("path", { d, fill: "none", stroke: feature.properties.color, "stroke-linecap": "round", "stroke-width": feature.properties.width + 1.5 });
      },
      entrance,
      skeleton,
      hostVars: {},
      hostAttrs: {},
      legend: legendProps === undefined || colorKey === undefined ? null : seriesLegend(legendProps, categories.map((label, i) => ({ label, color: CHART_PALETTE[i % CHART_PALETTE.length] ?? "var(--chart-1)" }))),
      describe: hasTooltip
        ? (points, carrier) => {
            const point = points.at(0);
            if (point === undefined || !focusMarks.has(point.markId)) {
              return undefined;
            }
            // SAFETY: the tooltip carrier's props are RouteMapTooltipProps.
            const tooltip = carrier as RouteMapTooltipProps<unknown, unknown>;
            const format = tooltip.formatValue ?? formatSpatialValue;
            if (point.markId === PLACES_ID) {
              const { place, index, routes: count } = placeOf(point).properties;
              return {
                args: { route: null, place, index },
                title: place.name ?? place.id,
                rows: [{ color: placesProps?.color ?? "var(--chart-foreground)", label: "Routes", value: String(count) }],
              };
            }
            const { route, index, color } = routeOf(point).properties;
            return {
              args: { route, place: null, index },
              title: `${nameOf(route.from)} → ${nameOf(route.to)}`,
              rows: route.value === undefined ? [] : [{ color, label: tooltip.valueLabel ?? "Value", value: format(route.value) }],
            };
          }
        : null,
      drag: null,
    };
  };
};

/** The route map family for the spatial controller. */
export const ROUTE_MAP_FAMILY: SpatialFamily<RouteMapProps> = {
  chart: "route-map",
  css: /* @__PURE__ */ mapCss("route-map"),
  definitionRoles: [ROUTE_MAP_ROLES.land, ROUTE_MAP_ROLES.graticule, ROUTE_MAP_ROLES.routes, ROUTE_MAP_ROLES.places, ROUTE_MAP_ROLES.legend],
  tooltipRole: ROUTE_MAP_ROLES.tooltip,
  definitionProps: ["data", "geography", "projection", "rotate", "fit", "aspectRatio", "margin", "revealSignature", "ariaLabel", "ariaDescription"],
  keys: ["data", "geography", "projection", "rotate", "fit", ...SPATIAL_BASE_KEYS],
  createBuilder: createRouteMapBuilder,
};
