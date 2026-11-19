"use client";
// HistogramChart in React: the shared distribution adapter (../distribution/chart.tsx) over the histogram controller
// (core/histogram/controller.ts), and its carriers.
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { createHistogramController } from "../core/histogram/controller";
import type { HistogramControllerProps } from "../core/histogram/controller";
import { NO_ROWS } from "../core/distribution/skeleton";
import type { HistogramAxisProps, HistogramChartLoadingProps, HistogramChartProps as CoreHistogramChartProps, HistogramProps, HistogramTooltipProps as CoreHistogramTooltipProps } from "../core/types/histogram";
import { defineCarrier } from "../kit/role";
import { DistributionChart } from "../distribution/chart";

/** Props of {@link HistogramChart}. */
export interface HistogramChartProps extends CoreHistogramChartProps<ReactNode, CSSProperties> {}

/** Props of {@link HistogramTooltip}. */
export interface HistogramTooltipProps extends CoreHistogramTooltipProps<ReactNode> {}

/**
 * A histogram: each `Histogram` series' observations counted in shared bins (TanStack's `binX`), stacked or overlapping. Compose it from
 * children: `Grid`, one or more `Histogram` series, `HistogramXAxis`, `HistogramYAxis` and `HistogramTooltip`. Bars grow in from the
 * baseline; hovering a bin's column dims the others and shows each series' count.
 */
export function HistogramChart({ className, style, children, ...props }: Readonly<HistogramChartProps>): ReactElement {
  return (
    <DistributionChart<HistogramControllerProps> className={className} create={createHistogramController} name="HistogramChart" props={props} style={style}>
      {children}
    </DistributionChart>
  );
}

/** A ready-made loading placeholder: `HistogramChart` with no data and `status="loading"`, its skeleton bins shimmering under an optional label. */
export function HistogramChartLoading({ aspectRatio = "2 / 1", margin, label, className = "" }: Readonly<HistogramChartLoadingProps>): ReactElement {
  return <HistogramChart aspectRatio={aspectRatio} className={className} data={NO_ROWS} loadingLabel={label} margin={margin} status="loading" />;
}

/** One series of observations, binned on the chart's shared bins: its `dataKey` column of every row. It renders nothing itself; place it in a `HistogramChart`. */
export const Histogram = /* @__PURE__ */ defineCarrier<HistogramProps>("histogram", "Histogram");
/** The histogram's value axis along the bottom. It renders nothing itself; place it in a `HistogramChart`. */
export const HistogramXAxis = /* @__PURE__ */ defineCarrier<HistogramAxisProps>("histogramXAxis", "HistogramXAxis");
/** The histogram's count axis on the left. It renders nothing itself; place it in a `HistogramChart`. */
export const HistogramYAxis = /* @__PURE__ */ defineCarrier<HistogramAxisProps>("histogramYAxis", "HistogramYAxis");
/** The hover and keyboard tooltip: the hovered bin's range and each series' count. It renders nothing itself; place it in a `HistogramChart`. */
export const HistogramTooltip = /* @__PURE__ */ defineCarrier<HistogramTooltipProps>("histogramTooltip", "HistogramTooltip");
