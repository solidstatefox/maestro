"use client";

import { TREEMAP_FAMILY, TREEMAP_ROLES } from "../core/treemap/treemap";
import type { TreemapChartProps as CoreTreemapChartProps, TreemapLabelsProps, TreemapChartLoadingProps } from "../core/types/treemap";
import { defineCarrier } from "../kit/role";
import { createMarkChart, createMarkChartLoading } from "../mark-chart/mark-chart";
import type { MarkChartHostProps } from "../mark-chart/mark-chart";

/** Props for `TreemapChart`. */
export interface TreemapChartProps extends CoreTreemapChartProps, MarkChartHostProps {}

/**
 * Treemap: a hierarchy as nested rectangles, each cell's area its value, each branch a tinted frame with a header. Hover lights a cell
 * and dims the rest; click a branch to zoom into it, the breadcrumb zooms back out. Compose it with `TreemapLabels` and `ChartTooltip`.
 */
export const TreemapChart = /* @__PURE__ */ createMarkChart(TREEMAP_FAMILY, "TreemapChart");

/** Ready-made loading placeholder for a treemap: shorthand for `<TreemapChart status="loading" />` with no data, drawing shimmering muted tiles. */
export const TreemapChartLoading = /* @__PURE__ */ createMarkChartLoading<CoreTreemapChartProps, TreemapChartLoadingProps>(TREEMAP_FAMILY, TreemapChart, "TreemapChartLoading");

/** Names and values inside the cells and on the branch headers. It renders nothing itself; place it inside `TreemapChart`. */
export const TreemapLabels = /* @__PURE__ */ defineCarrier<TreemapLabelsProps>(TREEMAP_ROLES.labels, "TreemapLabels");
