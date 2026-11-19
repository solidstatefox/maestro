import type { CSSProperties, ReactElement, ReactNode } from "react";
import { BUBBLE_MAP_FAMILY, BUBBLE_MAP_ROLES } from "../core/bubble-map/definition";
import type { BubbleMapBubblesProps, BubbleMapGraticuleProps, BubbleMapLandProps, BubbleMapLegendProps, BubbleMapChartProps as CoreBubbleMapChartProps, BubbleMapTooltipProps as CoreBubbleMapTooltipProps, BubbleMapChartLoadingProps } from "../core/types/bubble-map";
import type { SpatialRow } from "../core/types/spatial";
import { defineCarrier } from "../kit/role";
import { defineSpatialChart } from "../spatial/chart";

/** Props of `BubbleMapChart`. */
export interface BubbleMapChartProps extends CoreBubbleMapChartProps<ReactNode> {}

/** Props of `BubbleMapTooltip`. */
export interface BubbleMapTooltipProps extends CoreBubbleMapTooltipProps<ReactNode, CSSProperties> {}

/**
 * A bubble map: places as circles on a world (or regional) map, each circle's area proportional to its value, the largest drawn first so none hides a smaller one. Compose it with `BubbleMapLand`, `BubbleMapGraticule`, `BubbleMapBubbles`, `BubbleMapTooltip` and `BubbleMapLegend`. Hovering a bubble dims the others; the bubbles grow in from the largest down.
 */
export const BubbleMapChart = /* @__PURE__ */ defineSpatialChart<BubbleMapChartProps>("BubbleMapChart", BUBBLE_MAP_FAMILY);

/** The countries under the bubbles: their fill and borders. Renders nothing itself; `BubbleMapChart` reads its props. */
export const BubbleMapLand = /* @__PURE__ */ defineCarrier<BubbleMapLandProps>(BUBBLE_MAP_ROLES.land, "BubbleMapLand");
/** Lines of longitude and latitude, and the world's outline. Renders nothing itself; `BubbleMapChart` reads its props. */
export const BubbleMapGraticule = /* @__PURE__ */ defineCarrier<BubbleMapGraticuleProps>(BUBBLE_MAP_ROLES.graticule, "BubbleMapGraticule");
/** The bubbles: the value that sizes them, their color and hover dimming. Renders nothing itself; `BubbleMapChart` reads its props. */
export const BubbleMapBubbles = /* @__PURE__ */ defineCarrier<BubbleMapBubblesProps>(BUBBLE_MAP_ROLES.bubbles, "BubbleMapBubbles");
/** Three bubble sizes and the values they stand for, under the map. Renders nothing itself; `BubbleMapChart` reads its props. */
export const BubbleMapLegend = /* @__PURE__ */ defineCarrier<BubbleMapLegendProps>(BUBBLE_MAP_ROLES.legend, "BubbleMapLegend");
/** The tooltip on a hovered or focused bubble: the place's name and value, or your `content`. Renders nothing itself; `BubbleMapChart` reads its props. */
export const BubbleMapTooltip = /* @__PURE__ */ defineCarrier<BubbleMapTooltipProps>(BUBBLE_MAP_ROLES.tooltip, "BubbleMapTooltip");

const NO_ROWS: readonly SpatialRow[] = [];

/** Ready-made loading placeholder for a bubble map: shorthand for `<BubbleMapChart status="loading" />` with no data, skeleton bubbles shimmering on the graticule, and on the land when you pass a `geography`. */
export function BubbleMapChartLoading({ aspectRatio, margin, label, className, geography }: Readonly<BubbleMapChartLoadingProps>): ReactElement {
  return (
    <BubbleMapChart aspectRatio={aspectRatio} className={className} data={NO_ROWS} geography={geography} loadingLabel={label} margin={margin} status="loading">
      <BubbleMapGraticule />
      {geography === undefined ? null : <BubbleMapLand />}
    </BubbleMapChart>
  );
}
