import type { FeatureCollection, Geometry } from "geojson";
import type { SpatialGraticuleProps, SpatialLandProps } from "../spatial/geo";
import type { SpatialChartBaseProps, SpatialHoverProps, SpatialMapChartLoadingProps, SpatialRow, SpatialTooltipProps } from "./spatial";

/** Props of `GlobeChart`. */
export interface GlobeChartProps<Node> extends SpatialChartBaseProps<Node> {
  /** The places to mark on the globe: one row per marker, with a longitude and a latitude. */
  readonly data?: readonly SpatialRow[];
  /** The countries to draw (GeoJSON; `GlobeLand` styles them), such as the kit's `worldCountries`. */
  readonly geography?: FeatureCollection<Geometry, Readonly<Record<string, unknown>> | null>;
  /**
   * The point that faces the reader, `[longitude, latitude]` in degrees.
   * @default [10, 20]
   */
  readonly center?: readonly [number, number];
  /**
   * Rotate the globe by dragging it (mouse, pen or touch).
   * @default true
   */
  readonly draggable?: boolean;
  /**
   * Key of each row's longitude, in degrees.
   * @default "longitude"
   */
  readonly longitudeKey?: string;
  /**
   * Key of each row's latitude, in degrees.
   * @default "latitude"
   */
  readonly latitudeKey?: string;
  /**
   * Key of each row's name, the tooltip's title.
   * @default "name"
   */
  readonly nameKey?: string;
  /**
   * Aspect ratio of the chart as "width / height".
   * @default "4 / 3"
   */
  readonly aspectRatio?: string;
}

/** Props of `GlobeChartLoading`: the chart with `status="loading"` and no data, a shimmering disc under the graticule with a few markers
 * on it (and the land's silhouette, with a `geography`). */
export interface GlobeChartLoadingProps extends SpatialMapChartLoadingProps {
  /**
   * Aspect ratio of the placeholder as "width / height".
   * @default "4 / 3"
   */
  readonly aspectRatio?: string;
}

/** Props of `GlobeSphere`: the globe's ocean and rim. */
export interface GlobeSphereProps {
  /**
   * Fill of the ocean.
   * @default "var(--chart-scale-01)"
   */
  readonly fill?: string;
  /**
   * Color of the rim.
   * @default "var(--border)"
   */
  readonly stroke?: string;
}

/** Props of `GlobeLand`: the countries (in `--chart-scale-02`, their borders in the ocean's color, unless you set them). */
export interface GlobeLandProps extends SpatialLandProps {}

/** Props of `GlobeGraticule`: lines of longitude and latitude. */
export interface GlobeGraticuleProps extends SpatialGraticuleProps {}

/** Props of `GlobeMarkers`: a dot on each place, sized by a value when given. */
export interface GlobeMarkersProps extends SpatialHoverProps {
  /** Key of each row's value: a marker's area. Without it every marker takes `radius`. */
  readonly dataKey?: string;
  /**
   * Radius of the markers (the largest, with `dataKey`), in pixels.
   * @default 5
   */
  readonly radius?: number;
  /**
   * Fill of the markers.
   * @default "var(--chart-1)"
   */
  readonly color?: string;
}

/** What `GlobeTooltip`'s `content` is called with: the marker's row under the pointer and its index in `data`. */
export interface GlobeTooltipArgs {
  readonly marker: SpatialRow;
  readonly index: number;
}

/** Props of `GlobeTooltip`: the tooltip on a hovered or focused marker. */
export interface GlobeTooltipProps<Node, Style> extends SpatialTooltipProps<Node, Style, GlobeTooltipArgs> {}
