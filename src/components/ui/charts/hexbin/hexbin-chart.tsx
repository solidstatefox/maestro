import type { CSSProperties, ReactElement, ReactNode } from "react";
import { HEXBIN_FAMILY, HEXBIN_ROLES } from "../core/hexbin/definition";
import type { HexbinAxisProps, HexbinCellsProps, HexbinChartProps as CoreHexbinChartProps, HexbinGridProps, HexbinLegendProps, HexbinTooltipProps as CoreHexbinTooltipProps, HexbinChartLoadingProps } from "../core/types/hexbin";
import type { SpatialRow } from "../core/types/spatial";
import { defineCarrier } from "../kit/role";
import { defineSpatialChart } from "../spatial/chart";

/** Props of `HexbinChart`. */
export interface HexbinChartProps extends CoreHexbinChartProps<ReactNode> {}

/** Props of `HexbinTooltip`. */
export interface HexbinTooltipProps extends CoreHexbinTooltipProps<ReactNode, CSSProperties> {}

/**
 * Hexagonal binning of a scatter: observations grouped into hexagons laid out at the chart's size, each filled by how many fall in it (or
 * the sum or mean of a value). Compose it with `HexbinCells`, `HexbinGrid`, `HexbinXAxis`, `HexbinYAxis`, `HexbinTooltip` and
 * `HexbinLegend`. Hovering a hexagon dims the others; the hexagons enter in a left-to-right wave.
 */
export const HexbinChart = /* @__PURE__ */ defineSpatialChart<HexbinChartProps>("HexbinChart", HEXBIN_FAMILY);

/** The hexagons: their bin size, the value they show, their fills and hover dimming. Renders nothing itself; `HexbinChart` reads its props. */
export const HexbinCells = /* @__PURE__ */ defineCarrier<HexbinCellsProps>(HEXBIN_ROLES.cells, "HexbinCells");
/** Dashed grid lines at the axes' ticks. Renders nothing itself; `HexbinChart` reads its props. */
export const HexbinGrid = /* @__PURE__ */ defineCarrier<HexbinGridProps>(HEXBIN_ROLES.grid, "HexbinGrid");
/** Value labels under the plot. Renders nothing itself; `HexbinChart` reads its props. */
export const HexbinXAxis = /* @__PURE__ */ defineCarrier<HexbinAxisProps>(HEXBIN_ROLES.xAxis, "HexbinXAxis");
/** Value labels left of the plot. Renders nothing itself; `HexbinChart` reads its props. */
export const HexbinYAxis = /* @__PURE__ */ defineCarrier<HexbinAxisProps>(HEXBIN_ROLES.yAxis, "HexbinYAxis");
/** The tooltip on a hovered or focused hexagon: its position and value, or your `content`. Renders nothing itself; `HexbinChart` reads its props. */
export const HexbinTooltip = /* @__PURE__ */ defineCarrier<HexbinTooltipProps>(HEXBIN_ROLES.tooltip, "HexbinTooltip");
/** The fills' steps under the plot, each with the values it covers. Renders nothing itself; `HexbinChart` reads its props. */
export const HexbinLegend = /* @__PURE__ */ defineCarrier<HexbinLegendProps>(HEXBIN_ROLES.legend, "HexbinLegend");

const NO_ROWS: readonly SpatialRow[] = [];

/** Ready-made loading placeholder for a hexbin chart: shorthand for `<HexbinChart status="loading" />` with no data, a patch of skeleton hexagons shimmering under an optional label. */
export function HexbinChartLoading({ aspectRatio, margin, label, className }: Readonly<HexbinChartLoadingProps>): ReactElement {
  return <HexbinChart aspectRatio={aspectRatio} className={className} data={NO_ROWS} loadingLabel={label} margin={margin} status="loading" xDataKey="x" yDataKey="y" />;
}
