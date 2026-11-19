"use client";

import { DIVERGING_FAMILY, DIVERGING_ROLES } from "../core/diverging/diverging";
import type { DivergingBarChartProps as CoreDivergingBarChartProps, DivergingSegmentProps, DivergingLabelsProps, DivergingBarChartLoadingProps } from "../core/types/diverging";
import { defineCarrier } from "../kit/role";
import { createMarkChart, createMarkChartLoading } from "../mark-chart/mark-chart";
import type { MarkChartHostProps } from "../mark-chart/mark-chart";

/** Props for `DivergingBarChart`. */
export interface DivergingBarChartProps extends CoreDivergingBarChartProps, MarkChartHostProps {}

/**
 * Diverging bar chart: one horizontal bar per row, its ordered segments centred on a neutral point (a Likert scale), split by a zero rule.
 * Hover lights a segment's series in every bar. Compose it with a `DivergingSegment` per response, `DivergingLabels`, `Grid`, `XAxis`, `YAxis` and `ChartTooltip`.
 */
export const DivergingBarChart = /* @__PURE__ */ createMarkChart(DIVERGING_FAMILY, "DivergingBarChart");

/** Ready-made loading placeholder for a diverging bar chart: shorthand for `<DivergingBarChart status="loading" />` with no data, drawing shimmering muted bars either side of the centre line. */
export const DivergingBarChartLoading = /* @__PURE__ */ createMarkChartLoading<CoreDivergingBarChartProps, DivergingBarChartLoadingProps>(DIVERGING_FAMILY, DivergingBarChart, "DivergingBarChartLoading");

/**
 * One ordered segment of the diverging bars (a response on the scale), its values read from `dataKey`. It renders nothing itself; place it inside `DivergingBarChart`.
 */
export const DivergingSegment = /* @__PURE__ */ defineCarrier<DivergingSegmentProps>(DIVERGING_ROLES.segment, "DivergingSegment");

/** Each segment's share inside it, where it fits. It renders nothing itself; place it inside `DivergingBarChart`. */
export const DivergingLabels = /* @__PURE__ */ defineCarrier<DivergingLabelsProps>(DIVERGING_ROLES.labels, "DivergingLabels");
