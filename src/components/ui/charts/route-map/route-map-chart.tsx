import type { CSSProperties, ReactElement, ReactNode } from "react";
import { ROUTE_MAP_FAMILY, ROUTE_MAP_ROLES } from "../core/route-map/definition";
import type { RouteMapGraticuleProps, RouteMapLandProps, RouteMapLegendProps, RouteMapPlacesProps, RouteMapRoutesProps, RouteMapChartProps as CoreRouteMapChartProps, RouteMapTooltipProps as CoreRouteMapTooltipProps, RouteMapChartLoadingProps, RouteMapData } from "../core/types/route-map";
import { defineCarrier } from "../kit/role";
import { defineSpatialChart } from "../spatial/chart";

/** Props of `RouteMapChart`. */
export interface RouteMapChartProps extends CoreRouteMapChartProps<ReactNode> {}

/** Props of `RouteMapTooltip`. */
export interface RouteMapTooltipProps extends CoreRouteMapTooltipProps<ReactNode, CSSProperties> {}

/**
 * A route map: routes between places drawn as great circles over a world (or regional) map, heavier routes wider. Compose it with `RouteMapLand`, `RouteMapGraticule`, `RouteMapRoutes`, `RouteMapPlaces`, `RouteMapTooltip` and `RouteMapLegend`. Hovering a route or a place dims the other routes; the routes trace themselves in.
 */
export const RouteMapChart = /* @__PURE__ */ defineSpatialChart<RouteMapChartProps>("RouteMapChart", ROUTE_MAP_FAMILY);

/** The countries under the routes: their fill and borders. Renders nothing itself; `RouteMapChart` reads its props. */
export const RouteMapLand = /* @__PURE__ */ defineCarrier<RouteMapLandProps>(ROUTE_MAP_ROLES.land, "RouteMapLand");
/** Lines of longitude and latitude, and the world's outline. Renders nothing itself; `RouteMapChart` reads its props. */
export const RouteMapGraticule = /* @__PURE__ */ defineCarrier<RouteMapGraticuleProps>(ROUTE_MAP_ROLES.graticule, "RouteMapGraticule");
/** The routes: their color, widths by value and hover dimming. Renders nothing itself; `RouteMapChart` reads its props. */
export const RouteMapRoutes = /* @__PURE__ */ defineCarrier<RouteMapRoutesProps>(ROUTE_MAP_ROLES.routes, "RouteMapRoutes");
/** A dot on each place. Renders nothing itself; `RouteMapChart` reads its props. */
export const RouteMapPlaces = /* @__PURE__ */ defineCarrier<RouteMapPlacesProps>(ROUTE_MAP_ROLES.places, "RouteMapPlaces");
/** The route categories and their colors, under the map. Renders nothing itself; `RouteMapChart` reads its props. */
export const RouteMapLegend = /* @__PURE__ */ defineCarrier<RouteMapLegendProps>(ROUTE_MAP_ROLES.legend, "RouteMapLegend");
/** The tooltip on a hovered or focused route (its places and value) or place (its name and routes), or your `content`. Renders nothing itself; `RouteMapChart` reads its props. */
export const RouteMapTooltip = /* @__PURE__ */ defineCarrier<RouteMapTooltipProps>(ROUTE_MAP_ROLES.tooltip, "RouteMapTooltip");

const NO_ROUTES: RouteMapData = { places: [], routes: [] };

/** Ready-made loading placeholder for a route map: shorthand for `<RouteMapChart status="loading" />` with no data, skeleton routes and places shimmering on the graticule, and on the land when you pass a `geography`. */
export function RouteMapChartLoading({ aspectRatio, margin, label, className, geography }: Readonly<RouteMapChartLoadingProps>): ReactElement {
  return (
    <RouteMapChart aspectRatio={aspectRatio} className={className} data={NO_ROUTES} geography={geography} loadingLabel={label} margin={margin} status="loading">
      <RouteMapGraticule />
      {geography === undefined ? null : <RouteMapLand />}
    </RouteMapChart>
  );
}
