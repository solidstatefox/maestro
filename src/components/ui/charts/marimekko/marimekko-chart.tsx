"use client";

import { MARIMEKKO_FAMILY, MARIMEKKO_ROLES } from "../core/marimekko/marimekko";
import type { MarimekkoChartProps as CoreMarimekkoChartProps, MarimekkoSegmentProps, MarimekkoLabelsProps, MarimekkoChartLoadingProps } from "../core/types/marimekko";
import { defineCarrier } from "../kit/role";
import { createMarkChart, createMarkChartLoading } from "../mark-chart/mark-chart";
import type { MarkChartHostProps } from "../mark-chart/mark-chart";

/** Props for `MarimekkoChart`. */
export interface MarimekkoChartProps extends CoreMarimekkoChartProps, MarkChartHostProps {}

/**
 * Marimekko chart: two part-to-whole dimensions, each column as wide as its total's share and its segments stacked to 100% of it.
 * Hover lights a series across the columns and dims the rest. Compose it with `MarimekkoSegment` per series, `MarimekkoLabels`, `Grid`, `XAxis`, `YAxis` and `ChartTooltip`.
 */
export const MarimekkoChart = /* @__PURE__ */ createMarkChart(MARIMEKKO_FAMILY, "MarimekkoChart");

/** Ready-made loading placeholder for a marimekko chart: shorthand for `<MarimekkoChart status="loading" />` with no data, drawing shimmering muted columns of stacked segments. */
export const MarimekkoChartLoading = /* @__PURE__ */ createMarkChartLoading<CoreMarimekkoChartProps, MarimekkoChartLoadingProps>(MARIMEKKO_FAMILY, MarimekkoChart, "MarimekkoChartLoading");

/**
 * One series of the marimekko: a segment in every column, its value read from `dataKey`. It renders nothing itself; place it inside `MarimekkoChart`.
 */
export const MarimekkoSegment = /* @__PURE__ */ defineCarrier<MarimekkoSegmentProps>(MARIMEKKO_ROLES.segment, "MarimekkoSegment");

/**
 * Each segment's share of its column, inside it where it fits. It renders nothing itself; place it inside `MarimekkoChart`.
 */
export const MarimekkoLabels = /* @__PURE__ */ defineCarrier<MarimekkoLabelsProps>(MARIMEKKO_ROLES.labels, "MarimekkoLabels");
