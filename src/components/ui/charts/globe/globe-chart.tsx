import type { CSSProperties, ReactElement, ReactNode } from "react";
import { GLOBE_FAMILY, GLOBE_ROLES } from "../core/globe/definition";
import type { GlobeGraticuleProps, GlobeLandProps, GlobeMarkersProps, GlobeSphereProps, GlobeChartProps as CoreGlobeChartProps, GlobeTooltipProps as CoreGlobeTooltipProps, GlobeChartLoadingProps } from "../core/types/globe";
import type { SpatialRow } from "../core/types/spatial";
import { defineCarrier } from "../kit/role";
import { defineSpatialChart } from "../spatial/chart";

/** Props of `GlobeChart`. */
export interface GlobeChartProps extends CoreGlobeChartProps<ReactNode> {}

/** Props of `GlobeTooltip`. */
export interface GlobeTooltipProps extends CoreGlobeTooltipProps<ReactNode, CSSProperties> {}

/**
 * A globe: the world in an orthographic projection with markers on places, rotated by dragging. Compose it with `GlobeSphere`, `GlobeLand`, `GlobeGraticule`, `GlobeMarkers` and `GlobeTooltip`. Hovering a marker dims the others; the globe grows in, then its land and markers.
 */
export const GlobeChart = /* @__PURE__ */ defineSpatialChart<GlobeChartProps>("GlobeChart", GLOBE_FAMILY);

/** The globe's ocean and rim. Renders nothing itself; `GlobeChart` reads its props. */
export const GlobeSphere = /* @__PURE__ */ defineCarrier<GlobeSphereProps>(GLOBE_ROLES.sphere, "GlobeSphere");
/** The countries: their fill and borders. Renders nothing itself; `GlobeChart` reads its props. */
export const GlobeLand = /* @__PURE__ */ defineCarrier<GlobeLandProps>(GLOBE_ROLES.land, "GlobeLand");
/** Lines of longitude and latitude. Renders nothing itself; `GlobeChart` reads its props. */
export const GlobeGraticule = /* @__PURE__ */ defineCarrier<GlobeGraticuleProps>(GLOBE_ROLES.graticule, "GlobeGraticule");
/** A dot on each place, sized by a value when given. Renders nothing itself; `GlobeChart` reads its props. */
export const GlobeMarkers = /* @__PURE__ */ defineCarrier<GlobeMarkersProps>(GLOBE_ROLES.markers, "GlobeMarkers");
/** The tooltip on a hovered or focused marker: the place's name and value, or your `content`. Renders nothing itself; `GlobeChart` reads its props. */
export const GlobeTooltip = /* @__PURE__ */ defineCarrier<GlobeTooltipProps>(GLOBE_ROLES.tooltip, "GlobeTooltip");

const NO_ROWS: readonly SpatialRow[] = [];

/** Ready-made loading placeholder for a globe: shorthand for `<GlobeChart status="loading" />` with no data, a shimmering disc under the graticule with a few skeleton markers (and the land's silhouette, with a `geography`). */
export function GlobeChartLoading({ aspectRatio, margin, label, className, geography }: Readonly<GlobeChartLoadingProps>): ReactElement {
  return (
    <GlobeChart aspectRatio={aspectRatio} className={className} data={NO_ROWS} draggable={false} geography={geography} loadingLabel={label} margin={margin} status="loading">
      <GlobeGraticule />
      <GlobeMarkers />
      {geography === undefined ? null : <GlobeLand />}
    </GlobeChart>
  );
}
