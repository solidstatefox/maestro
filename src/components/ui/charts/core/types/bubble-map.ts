import type { FeatureCollection, Geometry } from "geojson";
import type { SpatialGraticuleProps, SpatialLandProps, SpatialProjection } from "../spatial/geo";
import type { SpatialChartBaseProps, SpatialHoverProps, SpatialLegendProps, SpatialMapChartLoadingProps, SpatialRow, SpatialTooltipProps } from "./spatial";

export type { SpatialProjection } from "../spatial/geo";

/** Props of `BubbleMapChart`. */
export interface BubbleMapChartProps<Node> extends SpatialChartBaseProps<Node> {
  /** The places: one row per bubble, with a longitude, a latitude and a value. */
  readonly data: readonly SpatialRow[];
  /** The countries to draw under the bubbles (GeoJSON; `BubbleMapLand` styles them), such as the kit's `worldCountries`. */
  readonly geography?: FeatureCollection<Geometry, Readonly<Record<string, unknown>> | null>;
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
   * The map projection.
   * @default "equal-earth"
   */
  readonly projection?: SpatialProjection;
  /** Rotation of the projection, `[longitude, latitude]` in degrees: `[-10, 0]` centers 10° east. */
  readonly rotate?: readonly [number, number];
  /**
   * What fills the plot: the whole world, the `geography`'s features (a region), or the places in `data` (with room for the bubbles).
   * @default "sphere"
   */
  readonly fit?: "sphere" | "geography" | "data";
  /**
   * Aspect ratio of the chart as "width / height".
   * @default "2 / 1"
   */
  readonly aspectRatio?: string;
}

/** Props of `BubbleMapChartLoading`: the chart with `status="loading"` and no data, its skeleton on the graticule (and the land, with a `geography`). */
export interface BubbleMapChartLoadingProps extends SpatialMapChartLoadingProps {}

/** Props of `BubbleMapLand`: the countries under the bubbles. */
export interface BubbleMapLandProps extends SpatialLandProps {}

/** Props of `BubbleMapGraticule`: lines of longitude and latitude, and the world's outline. */
export interface BubbleMapGraticuleProps extends SpatialGraticuleProps {
  /**
   * Draw the world's outline too.
   * @default true
   */
  readonly outline?: boolean;
}

/** Props of `BubbleMapBubbles`: one circle per row, its area proportional to its value. */
export interface BubbleMapBubblesProps extends SpatialHoverProps {
  /** Key of each row's value: the bubble's area. */
  readonly dataKey: string;
  /**
   * Radius of the largest bubble, in pixels.
   * @default 22
   */
  readonly maxRadius?: number;
  /**
   * Radius of the smallest, in pixels.
   * @default 2
   */
  readonly minRadius?: number;
  /** Key of each row's category: each category takes the palette in order of appearance (`--chart-1`, `--chart-2`…). */
  readonly colorKey?: string;
  /** The bubbles' fill without `colorKey`. */
  readonly color?: string;
  /**
   * Opacity of the bubbles' fill.
   * @default 0.65
   */
  readonly fillOpacity?: number;
  /**
   * Color of the bubbles' outline.
   * @default "var(--chart-background)"
   */
  readonly stroke?: string;
}

/** What `BubbleMapTooltip`'s `content` is called with: the row under the pointer and its index in `data`. */
export interface BubbleMapTooltipArgs {
  readonly bubble: SpatialRow;
  readonly index: number;
}

/** Props of `BubbleMapTooltip`: the tooltip on a hovered or focused bubble. */
export interface BubbleMapTooltipProps<Node, Style> extends SpatialTooltipProps<Node, Style, BubbleMapTooltipArgs> {}

/** Props of `BubbleMapLegend`: three bubble sizes and the values they stand for (and the categories, with `colorKey`). */
export interface BubbleMapLegendProps extends SpatialLegendProps {}
