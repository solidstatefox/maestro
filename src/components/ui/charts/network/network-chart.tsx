"use client";

import { NETWORK_FAMILY, NETWORK_ROLES } from "../core/network/network";
import type { NetworkChartProps as CoreNetworkChartProps, NetworkLabelsProps, NetworkChartLoadingProps } from "../core/types/network";
import { defineCarrier } from "../kit/role";
import { createMarkChart, createMarkChartLoading } from "../mark-chart/mark-chart";
import type { MarkChartHostProps } from "../mark-chart/mark-chart";

/** Props for `NetworkChart`. */
export interface NetworkChartProps extends CoreNetworkChartProps, MarkChartHostProps {}

/**
 * Network chart: a force-directed graph of nodes and links, laid out by TanStack's force layout.
 * Hover lights a node, its neighbours and its links; drag a node and the graph settles around where you drop it. Compose it with `NetworkLabels` and `ChartTooltip`.
 */
export const NetworkChart = /* @__PURE__ */ createMarkChart(NETWORK_FAMILY, "NetworkChart");

/** Ready-made loading placeholder for a network chart: shorthand for `<NetworkChart status="loading" />` with no data, drawing shimmering muted clusters of nodes and links. */
export const NetworkChartLoading = /* @__PURE__ */ createMarkChartLoading<CoreNetworkChartProps, NetworkChartLoadingProps>(NETWORK_FAMILY, NetworkChart, "NetworkChartLoading");

/** Each node's name beside it. It renders nothing itself; place it inside `NetworkChart`. */
export const NetworkLabels = /* @__PURE__ */ defineCarrier<NetworkLabelsProps>(NETWORK_ROLES.labels, "NetworkLabels");
