"use client";
// ViolinChart in React: the shared distribution adapter (../distribution/chart.tsx) over the violin controller
// (core/violin/controller.ts), and its carriers.
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { createViolinController } from "../core/violin/controller";
import type { ViolinControllerProps } from "../core/violin/controller";
import { NO_ROWS } from "../core/distribution/skeleton";
import type { ViolinAxisProps, ViolinChartLoadingProps, ViolinChartProps as CoreViolinChartProps, ViolinProps, ViolinTooltipProps as CoreViolinTooltipProps } from "../core/types/violin";
import { defineCarrier } from "../kit/role";
import { DistributionChart } from "../distribution/chart";

/** Props of {@link ViolinChart}. */
export interface ViolinChartProps extends CoreViolinChartProps<ReactNode, CSSProperties> {}

/** Props of {@link ViolinTooltip}. */
export interface ViolinTooltipProps extends CoreViolinTooltipProps<ReactNode> {}

/**
 * A violin plot: each `Violin` series' observations per category as a mirrored, smoothed density (TanStack's `binY` and `normalize`) with an inner box and median, vertical or horizontal. Compose it from children: `Grid`, one or more `Violin` series, `ViolinXAxis`, `ViolinYAxis` and `ViolinTooltip`. Violins unfold from their middle; hovering a category dims the others and shows its summary.
 */
export function ViolinChart({ className, style, children, ...props }: Readonly<ViolinChartProps>): ReactElement {
  return (
    <DistributionChart<ViolinControllerProps> className={className} create={createViolinController} name="ViolinChart" props={props} style={style}>
      {children}
    </DistributionChart>
  );
}

/** A ready-made loading placeholder: `ViolinChart` with no data and `status="loading"`, its skeleton violins shimmering under an optional label. */
export function ViolinChartLoading({ aspectRatio = "2 / 1", margin, label, className = "", orientation }: Readonly<ViolinChartLoadingProps>): ReactElement {
  return <ViolinChart aspectRatio={aspectRatio} categoryKey="" className={className} data={NO_ROWS} loadingLabel={label} margin={margin} orientation={orientation} status="loading" />;
}

/** One series of observations, drawn per category as a mirrored density with its quartiles inside. It renders nothing itself; place it in a `ViolinChart`. */
export const Violin = /* @__PURE__ */ defineCarrier<ViolinProps>("violin", "Violin");
/** The axis along the bottom: the categories, or the values when horizontal. It renders nothing itself; place it in a `ViolinChart`. */
export const ViolinXAxis = /* @__PURE__ */ defineCarrier<ViolinAxisProps>("violinXAxis", "ViolinXAxis");
/** The axis on the left: the values, or the categories when horizontal. It renders nothing itself; place it in a `ViolinChart`. */
export const ViolinYAxis = /* @__PURE__ */ defineCarrier<ViolinAxisProps>("violinYAxis", "ViolinYAxis");
/** The hover and keyboard tooltip: the hovered category's median, quartiles and range. It renders nothing itself; place it in a `ViolinChart`. */
export const ViolinTooltip = /* @__PURE__ */ defineCarrier<ViolinTooltipProps>("violinTooltip", "ViolinTooltip");
