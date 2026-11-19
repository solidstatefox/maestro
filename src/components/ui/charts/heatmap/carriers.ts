"use client";
// Config carriers for HeatmapChart. They render nothing: the chart reads their props
// (see ../kit/read-children) and folds them into one native definition.
import type { CSSProperties } from "react";
import type { HeatmapCellsProps, HeatmapSeparatorProps, HeatmapTooltipProps as CoreHeatmapTooltipProps, HeatmapXAxisProps, HeatmapYAxisProps } from "../core/types/heatmap";
import { defineCarrier } from "../kit/role";

/** Props of `HeatmapTooltip`. */
interface HeatmapTooltipProps extends CoreHeatmapTooltipProps<CSSProperties> {}

/** Configures the grid of cells (corner radius, hover dimming, row opacity). Renders nothing itself; `HeatmapChart` reads its props. Required for the grid to draw. */
const HeatmapCells = /* @__PURE__ */ defineCarrier<HeatmapCellsProps>("heatmapCells", "HeatmapCells");
/** Shows month labels above the grid. Renders nothing itself; `HeatmapChart` reads its presence. */
const HeatmapXAxis = /* @__PURE__ */ defineCarrier<HeatmapXAxisProps>("heatmapXAxis", "HeatmapXAxis");
/** Shows weekday labels left of the grid; they follow `weekStartDay` on `HeatmapChart`. Renders nothing itself; `HeatmapChart` reads its props. */
const HeatmapYAxis = /* @__PURE__ */ defineCarrier<HeatmapYAxisProps>("heatmapYAxis", "HeatmapYAxis");
/** Enables the hover and keyboard tooltip showing the date and contribution count of a cell. Renders nothing itself; `HeatmapChart` reads its props. */
const HeatmapTooltip = /* @__PURE__ */ defineCarrier<HeatmapTooltipProps>("heatmapTooltip", "HeatmapTooltip");
/** Draws vertical separators between groups of columns (every N columns or per quarter), with optional quarter labels. Renders nothing itself; `HeatmapChart` reads its props. */
const HeatmapSeparator = /* @__PURE__ */ defineCarrier<HeatmapSeparatorProps>("heatmapSeparator", "HeatmapSeparator");


export { HeatmapCells, HeatmapSeparator, HeatmapTooltip, HeatmapXAxis, HeatmapYAxis };
export type { HeatmapTooltipProps };
