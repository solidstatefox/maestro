"use client";

import { TREE_FAMILY, TREE_ROLES } from "../core/tree/tree";
import type { TreeChartProps as CoreTreeChartProps, TreeLabelsProps, TreeChartLoadingProps } from "../core/types/tree";
import { defineCarrier } from "../kit/role";
import { createMarkChart, createMarkChartLoading } from "../mark-chart/mark-chart";
import type { MarkChartHostProps } from "../mark-chart/mark-chart";

/** Props for `TreeChart`. */
export interface TreeChartProps extends CoreTreeChartProps, MarkChartHostProps {}

/**
 * Tree chart: a hierarchy as nodes and links, a tidy tree or a dendrogram, horizontal, vertical or radial.
 * Hover lights a node's lineage to the root; click a branch to fold it away and back. Compose it with `TreeLabels` and `ChartTooltip`.
 */
export const TreeChart = /* @__PURE__ */ createMarkChart(TREE_FAMILY, "TreeChart");

/** Ready-made loading placeholder for a tree chart: shorthand for `<TreeChart status="loading" />` with no data, drawing shimmering muted nodes and links. */
export const TreeChartLoading = /* @__PURE__ */ createMarkChartLoading<CoreTreeChartProps, TreeChartLoadingProps>(TREE_FAMILY, TreeChart, "TreeChartLoading");

/** Each node's name beside it. It renders nothing itself; place it inside `TreeChart`. */
export const TreeLabels = /* @__PURE__ */ defineCarrier<TreeLabelsProps>(TREE_ROLES.labels, "TreeLabels");
