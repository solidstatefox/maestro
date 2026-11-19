import type { CSSProperties, ReactElement, ReactNode } from "react";
import { VECTOR_FIELD_FAMILY, VECTOR_FIELD_ROLES } from "../core/vector-field/definition";
import type { VectorFieldArrowsProps, VectorFieldAxisProps, VectorFieldGridProps, VectorFieldLegendProps, VectorFieldChartProps as CoreVectorFieldChartProps, VectorFieldTooltipProps as CoreVectorFieldTooltipProps, VectorFieldChartLoadingProps } from "../core/types/vector-field";
import type { SpatialRow } from "../core/types/spatial";
import { defineCarrier } from "../kit/role";
import { defineSpatialChart } from "../spatial/chart";

/** Props of `VectorFieldChart`. */
export interface VectorFieldChartProps extends CoreVectorFieldChartProps<ReactNode> {}

/** Props of `VectorFieldTooltip`. */
export interface VectorFieldTooltipProps extends CoreVectorFieldTooltipProps<ReactNode, CSSProperties> {}

/**
 * A vector field: an arrow at each sample pointing its direction, as long and as dark as its magnitude, from `u` and `v` components or an angle and a magnitude. Compose it with `VectorFieldArrows`, `VectorFieldGrid`, `VectorFieldXAxis`, `VectorFieldYAxis`, `VectorFieldTooltip` and `VectorFieldLegend`. Hovering an arrow dims the others; the arrows grow in as a left-to-right wave.
 */
export const VectorFieldChart = /* @__PURE__ */ defineSpatialChart<VectorFieldChartProps>("VectorFieldChart", VECTOR_FIELD_FAMILY);

/** The arrows: where their direction and magnitude come from, their length, colors and hover dimming. Renders nothing itself; `VectorFieldChart` reads its props. */
export const VectorFieldArrows = /* @__PURE__ */ defineCarrier<VectorFieldArrowsProps>(VECTOR_FIELD_ROLES.arrows, "VectorFieldArrows");
/** Dashed grid lines at the axes' ticks. Renders nothing itself; `VectorFieldChart` reads its props. */
export const VectorFieldGrid = /* @__PURE__ */ defineCarrier<VectorFieldGridProps>(VECTOR_FIELD_ROLES.grid, "VectorFieldGrid");
/** Value labels under the plot. Renders nothing itself; `VectorFieldChart` reads its props. */
export const VectorFieldXAxis = /* @__PURE__ */ defineCarrier<VectorFieldAxisProps>(VECTOR_FIELD_ROLES.xAxis, "VectorFieldXAxis");
/** Value labels left of the plot. Renders nothing itself; `VectorFieldChart` reads its props. */
export const VectorFieldYAxis = /* @__PURE__ */ defineCarrier<VectorFieldAxisProps>(VECTOR_FIELD_ROLES.yAxis, "VectorFieldYAxis");
/** The magnitude steps and their colors, under the plot. Renders nothing itself; `VectorFieldChart` reads its props. */
export const VectorFieldLegend = /* @__PURE__ */ defineCarrier<VectorFieldLegendProps>(VECTOR_FIELD_ROLES.legend, "VectorFieldLegend");
/** The tooltip on a hovered or focused arrow: its position, magnitude and direction, or your `content`. Renders nothing itself; `VectorFieldChart` reads its props. */
export const VectorFieldTooltip = /* @__PURE__ */ defineCarrier<VectorFieldTooltipProps>(VECTOR_FIELD_ROLES.tooltip, "VectorFieldTooltip");

const NO_ROWS: readonly SpatialRow[] = [];

/** Ready-made loading placeholder for a vector field: shorthand for `<VectorFieldChart status="loading" />` with no data, a field of skeleton arrows shimmering under an optional label. */
export function VectorFieldChartLoading({ aspectRatio, margin, label, className }: Readonly<VectorFieldChartLoadingProps>): ReactElement {
  return <VectorFieldChart aspectRatio={aspectRatio} className={className} data={NO_ROWS} loadingLabel={label} margin={margin} status="loading" xDataKey="x" yDataKey="y" />;
}
