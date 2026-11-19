import type { CSSProperties, ReactElement, ReactNode } from "react";
import { DENSITY_FAMILY, DENSITY_ROLES } from "../core/density/definition";
import type { DensityAxisProps, DensityContoursProps, DensityGridProps, DensityLegendProps, DensityPointsProps, DensityChartProps as CoreDensityChartProps, DensityTooltipProps as CoreDensityTooltipProps, DensityChartLoadingProps } from "../core/types/density";
import type { SpatialRow } from "../core/types/spatial";
import { defineCarrier } from "../kit/role";
import { defineSpatialChart } from "../spatial/chart";

/** Props of `DensityChart`. */
export interface DensityChartProps extends CoreDensityChartProps<ReactNode> {}

/** Props of `DensityTooltip`. */
export interface DensityTooltipProps extends CoreDensityTooltipProps<ReactNode, CSSProperties> {}

/**
 * Density contours over a scatter: a smooth estimate of where observations concentrate, as nested filled bands (one estimate per group), with the observations as dots. Compose it with `DensityContours`, `DensityPoints`, `DensityGrid`, `DensityXAxis`, `DensityYAxis`, `DensityTooltip` and `DensityLegend`. Hovering a dot dims the rest; the bands rise level by level.
 */
export const DensityChart = /* @__PURE__ */ defineSpatialChart<DensityChartProps>("DensityChart", DENSITY_FAMILY);

/** The estimated density as nested filled bands: smoothing, levels, fill and outline. Renders nothing itself; `DensityChart` reads its props. */
export const DensityContours = /* @__PURE__ */ defineCarrier<DensityContoursProps>(DENSITY_ROLES.contours, "DensityContours");
/** The observations as dots over the bands; the tooltip and keyboard focus land on them. Renders nothing itself; `DensityChart` reads its props. */
export const DensityPoints = /* @__PURE__ */ defineCarrier<DensityPointsProps>(DENSITY_ROLES.points, "DensityPoints");
/** Dashed grid lines at the axes' ticks. Renders nothing itself; `DensityChart` reads its props. */
export const DensityGrid = /* @__PURE__ */ defineCarrier<DensityGridProps>(DENSITY_ROLES.grid, "DensityGrid");
/** Value labels under the plot. Renders nothing itself; `DensityChart` reads its props. */
export const DensityXAxis = /* @__PURE__ */ defineCarrier<DensityAxisProps>(DENSITY_ROLES.xAxis, "DensityXAxis");
/** Value labels left of the plot. Renders nothing itself; `DensityChart` reads its props. */
export const DensityYAxis = /* @__PURE__ */ defineCarrier<DensityAxisProps>(DENSITY_ROLES.yAxis, "DensityYAxis");
/** The groups and their colors under the plot. Renders nothing itself; `DensityChart` reads its props. */
export const DensityLegend = /* @__PURE__ */ defineCarrier<DensityLegendProps>(DENSITY_ROLES.legend, "DensityLegend");
/** The tooltip on a hovered or focused observation (with `DensityPoints`): its group and its x and y, or your `content`. Renders nothing itself; `DensityChart` reads its props. */
export const DensityTooltip = /* @__PURE__ */ defineCarrier<DensityTooltipProps>(DENSITY_ROLES.tooltip, "DensityTooltip");

const NO_ROWS: readonly SpatialRow[] = [];

/** Ready-made loading placeholder for a density chart: shorthand for `<DensityChart status="loading" />` with no data, clusters of skeleton contour bands breathing under an optional label. */
export function DensityChartLoading({ aspectRatio, margin, label, className }: Readonly<DensityChartLoadingProps>): ReactElement {
  return <DensityChart aspectRatio={aspectRatio} className={className} data={NO_ROWS} loadingLabel={label} margin={margin} status="loading" xDataKey="x" yDataKey="y" />;
}
