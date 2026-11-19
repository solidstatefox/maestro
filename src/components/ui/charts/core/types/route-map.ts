import type { FeatureCollection, Geometry } from "geojson";
import type { SpatialGraticuleProps, SpatialLandProps, SpatialProjection } from "../spatial/geo";
import type { SpatialChartBaseProps, SpatialHoverProps, SpatialLegendProps, SpatialMapChartLoadingProps, SpatialTooltipProps } from "./spatial";

/** A place routes start or end at. */
export interface RouteMapPlace {
  /** What routes name it by in their `from` and `to`. */
  readonly id: string;
  /** Its name in the tooltip; defaults to `id`. */
  readonly name?: string;
  readonly longitude: number;
  readonly latitude: number;
  readonly [key: string]: unknown;
}

/** A route between two places, by their `id`s. */
export interface RouteMapRoute {
  readonly from: string;
  readonly to: string;
  /** Its weight: a heavier route is drawn wider. */
  readonly value?: number;
  readonly [key: string]: unknown;
}

/** The places and the routes between them. */
export interface RouteMapData {
  readonly places: readonly RouteMapPlace[];
  readonly routes: readonly RouteMapRoute[];
}

/** Props of `RouteMapChart`. */
export interface RouteMapChartProps<Node> extends SpatialChartBaseProps<Node> {
  /** The places and the routes between them. A route naming a place that isn't there is left out. */
  readonly data: RouteMapData;
  /** The countries to draw under the routes (GeoJSON; `RouteMapLand` styles them), such as the kit's `worldCountries`. */
  readonly geography?: FeatureCollection<Geometry, Readonly<Record<string, unknown>> | null>;
  /**
   * The map projection.
   * @default "equal-earth"
   */
  readonly projection?: SpatialProjection;
  /** Rotation of the projection, `[longitude, latitude]` in degrees. */
  readonly rotate?: readonly [number, number];
  /**
   * What fills the plot: the whole world, the `geography`'s features, or the places (a region's routes).
   * @default "sphere"
   */
  readonly fit?: "sphere" | "geography" | "data";
  /**
   * Aspect ratio of the chart as "width / height".
   * @default "2 / 1"
   */
  readonly aspectRatio?: string;
}

/** Props of `RouteMapChartLoading`: the chart with `status="loading"` and no data, its skeleton on the graticule (and the land, with a `geography`). */
export interface RouteMapChartLoadingProps extends SpatialMapChartLoadingProps {}

/** Props of `RouteMapLand`: the countries under the routes. */
export interface RouteMapLandProps extends SpatialLandProps {}

/** Props of `RouteMapGraticule`: lines of longitude and latitude, and the world's outline. */
export interface RouteMapGraticuleProps extends SpatialGraticuleProps {
  /**
   * Draw the world's outline too.
   * @default true
   */
  readonly outline?: boolean;
}

/** Props of `RouteMapRoutes`: each route as the shortest path over the globe between its places (a great circle). */
export interface RouteMapRoutesProps extends SpatialHoverProps {
  /**
   * Color of the routes.
   * @default "var(--chart-1)"
   */
  readonly color?: string;
  /** Key of each route's category: each category takes the palette in order of appearance (`--chart-1`, `--chart-2`…). */
  readonly colorKey?: string;
  /**
   * Width of the lightest and the heaviest route, in pixels (by `value`).
   * @default [1, 4]
   */
  readonly widthRange?: readonly [number, number];
  /**
   * Opacity of the routes at rest.
   * @default 0.8
   */
  readonly opacity?: number;
  /**
   * Opacity of the other marks while one is hovered or focused.
   * @default 0.25
   */
  readonly inactiveOpacity?: number;
}

/** Props of `RouteMapPlaces`: a dot on each place. */
export interface RouteMapPlacesProps {
  /**
   * Radius of the dots, in pixels.
   * @default 3.5
   */
  readonly radius?: number;
  /**
   * Fill of the dots.
   * @default "var(--chart-foreground)"
   */
  readonly color?: string;
}

/** What `RouteMapTooltip`'s `content` is called with: the route or the place under the pointer (the other one null) and its index. */
export interface RouteMapTooltipArgs {
  readonly route: RouteMapRoute | null;
  readonly place: RouteMapPlace | null;
  readonly index: number;
}

/** Props of `RouteMapTooltip`: the tooltip on a hovered or focused route or place. */
export interface RouteMapTooltipProps<Node, Style> extends SpatialTooltipProps<Node, Style, RouteMapTooltipArgs> {}

/** Props of `RouteMapLegend`: the route categories and their colors (with `colorKey`). */
export interface RouteMapLegendProps extends SpatialLegendProps {}
