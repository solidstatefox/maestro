"use client";
// RidgelineChart in React: the shared distribution adapter (../distribution/chart.tsx) over the ridgeline controller
// (core/ridgeline/controller.ts), and its carriers.
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { createRidgelineController } from "../core/ridgeline/controller";
import type { RidgelineControllerProps } from "../core/ridgeline/controller";
import { NO_ROWS } from "../core/distribution/skeleton";
import type { RidgelineAxisProps, RidgelineChartLoadingProps, RidgelineChartProps as CoreRidgelineChartProps, RidgelineProps, RidgelineTooltipProps as CoreRidgelineTooltipProps } from "../core/types/ridgeline";
import { defineCarrier } from "../kit/role";
import { DistributionChart } from "../distribution/chart";

/** Props of {@link RidgelineChart}. */
export interface RidgelineChartProps extends CoreRidgelineChartProps<ReactNode, CSSProperties> {}

/** Props of {@link RidgelineTooltip}. */
export interface RidgelineTooltipProps extends CoreRidgelineTooltipProps<ReactNode> {}

/**
 * A ridgeline plot: each category's observations as a smoothed density ridge (TanStack's `binX` and `normalize`) on its own baseline, the ridges overlapping like a mountain range. Compose it from children: `Grid`, a `Ridgeline` series, `RidgelineXAxis`, `RidgelineYAxis` and `RidgelineTooltip`. Ridges rise in one after another; hovering one dims the rest and shows its summary.
 */
export function RidgelineChart({ className, style, children, ...props }: Readonly<RidgelineChartProps>): ReactElement {
  return (
    <DistributionChart<RidgelineControllerProps> className={className} create={createRidgelineController} name="RidgelineChart" props={props} style={style}>
      {children}
    </DistributionChart>
  );
}

/** A ready-made loading placeholder: `RidgelineChart` with no data and `status="loading"`, its skeleton ridges shimmering under an optional label. */
export function RidgelineChartLoading({ aspectRatio = "2 / 1", margin, label, className = "" }: Readonly<RidgelineChartLoadingProps>): ReactElement {
  return <RidgelineChart aspectRatio={aspectRatio} categoryKey="" className={className} data={NO_ROWS} loadingLabel={label} margin={margin} status="loading" />;
}

/** One series of observations, drawn per category as a smoothed density ridge on its category's baseline. It renders nothing itself; place it in a `RidgelineChart`. */
export const Ridgeline = /* @__PURE__ */ defineCarrier<RidgelineProps>("ridgeline", "Ridgeline");
/** The value axis along the bottom. It renders nothing itself; place it in a `RidgelineChart`. */
export const RidgelineXAxis = /* @__PURE__ */ defineCarrier<RidgelineAxisProps>("ridgelineXAxis", "RidgelineXAxis");
/** The category axis on the left, one ridge per category. It renders nothing itself; place it in a `RidgelineChart`. */
export const RidgelineYAxis = /* @__PURE__ */ defineCarrier<RidgelineAxisProps>("ridgelineYAxis", "RidgelineYAxis");
/** The hover and keyboard tooltip: the hovered ridge's median, quartiles and count. It renders nothing itself; place it in a `RidgelineChart`. */
export const RidgelineTooltip = /* @__PURE__ */ defineCarrier<RidgelineTooltipProps>("ridgelineTooltip", "RidgelineTooltip");
