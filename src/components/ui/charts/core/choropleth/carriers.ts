import { propsFor } from "../carriers/table";
import type { ChildTable } from "../carriers/table";
import type { ChoroplethBackgroundProps, ChoroplethDotGridProps, ChoroplethFeatureProps, ChoroplethGraticuleProps, ChoroplethMarkerProps, ChoroplethTooltipProps } from "../types/choropleth";

export const CHOROPLETH_ROLES = {
  background: "choroplethBackground",
  dotGrid: "choroplethDotGrid",
  feature: "choroplethFeature",
  graticule: "choroplethGraticule",
  marker: "choroplethMarker",
  tooltip: "choroplethTooltip",
} as const;

const ROLE_NAMES: ReadonlySet<string> = /* @__PURE__ */ new Set(/* @__PURE__ */ Object.values(CHOROPLETH_ROLES));

/** Whether `role` is one of the choropleth's carriers (anything else among its children is an overlay). */
export const isChoroplethRole = (role: string | undefined): role is string => role !== undefined && ROLE_NAMES.has(role);

export interface ChoroplethConfig<Node, Style> {
  readonly featureConfig: ChoroplethFeatureProps<Node> | undefined;
  readonly tooltipConfig: ChoroplethTooltipProps<Node, Style> | undefined;
  readonly graticuleConfig: ChoroplethGraticuleProps | undefined;
  /** `ChoroplethDotGrid`'s props (the last one); without a `ChoroplethFeatureComponent` it draws the map alone. */
  readonly dotGridConfig: ChoroplethDotGridProps | undefined;
  /** Every `ChoroplethMarker`, in order. */
  readonly markers: readonly ChoroplethMarkerProps[];
  readonly backgroundConfig: ChoroplethBackgroundProps | undefined;
}

const NO_MARKERS: readonly ChoroplethMarkerProps[] = [];

/** The chart's configuration from its carrier table (each carrier's props object as given). */
export const choroplethConfigOf = <Node, Style>(table: ChildTable): ChoroplethConfig<Node, Style> => {
  const markers = propsFor<ChoroplethMarkerProps>(table, CHOROPLETH_ROLES.marker);
  return {
    backgroundConfig: propsFor<ChoroplethBackgroundProps>(table, CHOROPLETH_ROLES.background).at(-1),
    dotGridConfig: propsFor<ChoroplethDotGridProps>(table, CHOROPLETH_ROLES.dotGrid).at(-1),
    featureConfig: propsFor<ChoroplethFeatureProps<Node>>(table, CHOROPLETH_ROLES.feature).at(-1),
    graticuleConfig: propsFor<ChoroplethGraticuleProps>(table, CHOROPLETH_ROLES.graticule).at(-1),
    markers: markers.length === 0 ? NO_MARKERS : markers,
    tooltipConfig: propsFor<ChoroplethTooltipProps<Node, Style>>(table, CHOROPLETH_ROLES.tooltip).at(-1),
  };
};
