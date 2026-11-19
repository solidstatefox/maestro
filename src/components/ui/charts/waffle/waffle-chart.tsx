"use client";

import { WAFFLE_FAMILY } from "../core/waffle/waffle";
import type { WaffleChartProps as CoreWaffleChartProps, WaffleChartLoadingProps } from "../core/types/waffle";
import { createMarkChart, createMarkChartLoading } from "../mark-chart/mark-chart";
import type { MarkChartHostProps } from "../mark-chart/mark-chart";

/** Props for `WaffleChart`. */
export interface WaffleChartProps extends CoreWaffleChartProps, MarkChartHostProps {}

/**
 * Waffle chart: shares as countable units, a grid of equal cells filled category by category (cumulative rounding keeps the total).
 * Hover lights a category and dims the rest; cells past the categories' sum are a muted track. Compose it with `ChartTooltip`.
 */
export const WaffleChart = /* @__PURE__ */ createMarkChart(WAFFLE_FAMILY, "WaffleChart");

/** Ready-made loading placeholder for a waffle chart: shorthand for `<WaffleChart status="loading" />` with no data, drawing its grid of shimmering muted cells. */
export const WaffleChartLoading = /* @__PURE__ */ createMarkChartLoading<CoreWaffleChartProps, WaffleChartLoadingProps>(WAFFLE_FAMILY, WaffleChart, "WaffleChartLoading");
