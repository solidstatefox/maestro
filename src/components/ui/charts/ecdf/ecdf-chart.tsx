"use client";
// EcdfChart in React: the shared distribution adapter (../distribution/chart.tsx) over the ecdf controller
// (core/ecdf/controller.ts), and its carriers.
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { createEcdfController } from "../core/ecdf/controller";
import type { EcdfControllerProps } from "../core/ecdf/controller";
import { NO_ROWS } from "../core/distribution/skeleton";
import type { EcdfAxisProps, EcdfChartLoadingProps, EcdfChartProps as CoreEcdfChartProps, EcdfProps, EcdfTooltipProps as CoreEcdfTooltipProps } from "../core/types/ecdf";
import { defineCarrier } from "../kit/role";
import { DistributionChart } from "../distribution/chart";

/** Props of {@link EcdfChart}. */
export interface EcdfChartProps extends CoreEcdfChartProps<ReactNode, CSSProperties> {}

/** Props of {@link EcdfTooltip}. */
export interface EcdfTooltipProps extends CoreEcdfTooltipProps<ReactNode> {}

/**
 * An empirical cumulative distribution (ECDF): for each `Ecdf` series, the share of observations at or below each value, as a step line from 0 to 1. Compose it from children: `Grid`, one or more `Ecdf` series, `EcdfXAxis`, `EcdfYAxis` and `EcdfTooltip`. Lines draw in left to right; hovering shows a crosshair with each series' share at that value.
 */
export function EcdfChart({ className, style, children, ...props }: Readonly<EcdfChartProps>): ReactElement {
  return (
    <DistributionChart<EcdfControllerProps> className={className} create={createEcdfController} name="EcdfChart" props={props} style={style}>
      {children}
    </DistributionChart>
  );
}

/** A ready-made loading placeholder: `EcdfChart` with no data and `status="loading"`, its skeleton staircase shimmering under an optional label. */
export function EcdfChartLoading({ aspectRatio = "2 / 1", margin, label, className = "" }: Readonly<EcdfChartLoadingProps>): ReactElement {
  return <EcdfChart aspectRatio={aspectRatio} className={className} data={NO_ROWS} loadingLabel={label} margin={margin} status="loading" />;
}

/** One series of observations, drawn as its empirical cumulative distribution: a step up at every observation. It renders nothing itself; place it in a `EcdfChart`. */
export const Ecdf = /* @__PURE__ */ defineCarrier<EcdfProps>("ecdf", "Ecdf");
/** The value axis along the bottom. It renders nothing itself; place it in a `EcdfChart`. */
export const EcdfXAxis = /* @__PURE__ */ defineCarrier<EcdfAxisProps>("ecdfXAxis", "EcdfXAxis");
/** The share axis on the left, 0 to 100%. It renders nothing itself; place it in a `EcdfChart`. */
export const EcdfYAxis = /* @__PURE__ */ defineCarrier<EcdfAxisProps>("ecdfYAxis", "EcdfYAxis");
/** The hover and keyboard tooltip: each series' share of observations at or below the hovered value. It renders nothing itself; place it in a `EcdfChart`. */
export const EcdfTooltip = /* @__PURE__ */ defineCarrier<EcdfTooltipProps>("ecdfTooltip", "EcdfTooltip");
