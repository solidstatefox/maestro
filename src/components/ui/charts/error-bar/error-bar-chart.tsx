"use client";
// bklit-style ErrorBarChart on native TanStack Charts: React's adapter over its controller (core/error-bar/controller.ts on core/plot/controller.ts).
// The chart reads its carriers (`ErrorBar`); `Grid`, `BarXAxis`, `BarYAxis` and `ChartTooltip` are the bar and cartesian layers'.
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { createErrorBarController } from "../core/error-bar/controller";
import type { ErrorBarChartProps as CoreErrorBarChartProps, ErrorBarChartLoadingProps, ErrorBarProps } from "../core/types/uncertainty";
import { defineCarrier } from "../kit/role";
import { PlotChart } from "../plot/plot-chart";

/** Props of {@link ErrorBarChart}. */
export interface ErrorBarChartProps extends CoreErrorBarChartProps<ReactNode, CSSProperties> {}

/**
 * Estimates with their uncertainty: per category a dot on the estimate and an interval from its low bound to its high one, capped at both
 * ends, standing up or, `horizontal`, running down a list (a forest plot), with an optional dashed `reference`. Compose it from children:
 * `ErrorBar`, `Grid`, `BarXAxis`, `BarYAxis` and `ChartTooltip`. Hovering a row dims the others; its tooltip gives the estimate and the interval.
 */
export const ErrorBarChart = /* @__PURE__ */ Object.assign(
  function ErrorBarChart(props: Readonly<ErrorBarChartProps>): ReactElement {
    return <PlotChart create={createErrorBarController} name="ErrorBarChart" props={props} />;
  },
  { displayName: "ErrorBarChart" },
);

const NO_DATA: Record<string, unknown>[] = [];

/** Ready-made loading placeholder for an error bar chart: shorthand for `<ErrorBarChart status="loading" />` with no data, drawing its shimmering skeleton. */
export const ErrorBarChartLoading = ({ margin, aspectRatio, label, loadingLabel, className }: Readonly<ErrorBarChartLoadingProps>): ReactElement => (
  <ErrorBarChart aspectRatio={aspectRatio} className={className} data={NO_DATA} loadingLabel={label ?? loadingLabel} margin={margin} status="loading" />
);

/** The estimates: a dot on each row's value and its interval from the low bound to the high one. It renders nothing itself; place it in a `ErrorBarChart`. */
export const ErrorBar = /* @__PURE__ */ defineCarrier<ErrorBarProps>("errorBar", "ErrorBar");
