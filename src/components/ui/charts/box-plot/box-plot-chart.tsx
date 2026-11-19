"use client";
// BoxPlotChart in React: the shared distribution adapter (../distribution/chart.tsx) over the box plot controller
// (core/box-plot/controller.ts), and its carriers.
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { createBoxPlotController } from "../core/box-plot/controller";
import type { BoxPlotControllerProps } from "../core/box-plot/controller";
import { NO_ROWS } from "../core/distribution/skeleton";
import type { BoxPlotAxisProps, BoxPlotChartLoadingProps, BoxPlotChartProps as CoreBoxPlotChartProps, BoxPlotProps, BoxPlotTooltipProps as CoreBoxPlotTooltipProps } from "../core/types/box-plot";
import { defineCarrier } from "../kit/role";
import { DistributionChart } from "../distribution/chart";

/** Props of {@link BoxPlotChart}. */
export interface BoxPlotChartProps extends CoreBoxPlotChartProps<ReactNode, CSSProperties> {}

/** Props of {@link BoxPlotTooltip}. */
export interface BoxPlotTooltipProps extends CoreBoxPlotTooltipProps<ReactNode> {}

/**
 * A box plot: each `BoxPlot` series' observations summarized per category (TanStack's `boxRows`: quartiles, median, 1.5 IQR whiskers, outliers), vertical or horizontal. Compose it from children: `Grid`, one or more `BoxPlot` series, `BoxPlotXAxis`, `BoxPlotYAxis` and `BoxPlotTooltip`. Boxes unfold from their middle; hovering a category dims the others and shows its summary.
 */
export function BoxPlotChart({ className, style, children, ...props }: Readonly<BoxPlotChartProps>): ReactElement {
  return (
    <DistributionChart<BoxPlotControllerProps> className={className} create={createBoxPlotController} name="BoxPlotChart" props={props} style={style}>
      {children}
    </DistributionChart>
  );
}

/** A ready-made loading placeholder: `BoxPlotChart` with no data and `status="loading"`, its skeleton boxes shimmering under an optional label. */
export function BoxPlotChartLoading({ aspectRatio = "2 / 1", margin, label, className = "", orientation }: Readonly<BoxPlotChartLoadingProps>): ReactElement {
  return <BoxPlotChart aspectRatio={aspectRatio} categoryKey="" className={className} data={NO_ROWS} loadingLabel={label} margin={margin} orientation={orientation} status="loading" />;
}

/** One series of observations, summarized per category: quartiles, median, Tukey whiskers and outliers. It renders nothing itself; place it in a `BoxPlotChart`. */
export const BoxPlot = /* @__PURE__ */ defineCarrier<BoxPlotProps>("boxPlot", "BoxPlot");
/** The axis along the bottom: the categories, or the values when horizontal. It renders nothing itself; place it in a `BoxPlotChart`. */
export const BoxPlotXAxis = /* @__PURE__ */ defineCarrier<BoxPlotAxisProps>("boxPlotXAxis", "BoxPlotXAxis");
/** The axis on the left: the values, or the categories when horizontal. It renders nothing itself; place it in a `BoxPlotChart`. */
export const BoxPlotYAxis = /* @__PURE__ */ defineCarrier<BoxPlotAxisProps>("boxPlotYAxis", "BoxPlotYAxis");
/** The hover and keyboard tooltip: the hovered category's quartiles, median, whiskers and outliers. It renders nothing itself; place it in a `BoxPlotChart`. */
export const BoxPlotTooltip = /* @__PURE__ */ defineCarrier<BoxPlotTooltipProps>("boxPlotTooltip", "BoxPlotTooltip");
