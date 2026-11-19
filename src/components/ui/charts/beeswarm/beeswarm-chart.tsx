"use client";
// BeeswarmChart in React: the shared distribution adapter (../distribution/chart.tsx) over the beeswarm controller
// (core/beeswarm/controller.ts), and its carriers.
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { createBeeswarmController } from "../core/beeswarm/controller";
import type { BeeswarmControllerProps } from "../core/beeswarm/controller";
import { NO_ROWS } from "../core/distribution/skeleton";
import type { BeeswarmAxisProps, BeeswarmChartLoadingProps, BeeswarmChartProps as CoreBeeswarmChartProps, BeeswarmProps, BeeswarmTooltipProps as CoreBeeswarmTooltipProps } from "../core/types/beeswarm";
import { defineCarrier } from "../kit/role";
import { DistributionChart } from "../distribution/chart";

/** Props of {@link BeeswarmChart}. */
export interface BeeswarmChartProps extends CoreBeeswarmChartProps<ReactNode, CSSProperties> {}

/** Props of {@link BeeswarmTooltip}. */
export interface BeeswarmTooltipProps extends CoreBeeswarmTooltipProps<ReactNode> {}

/**
 * A beeswarm: every observation a dot at its value, dodged across its category's band so none overlap (TanStack's `dodgeOffsets`), vertical or horizontal. Compose it from children: `Grid`, one or more `Beeswarm` series, `BeeswarmXAxis`, `BeeswarmYAxis` and `BeeswarmTooltip`. Dots pop in; hovering one dims the rest and shows its value.
 */
export function BeeswarmChart({ className, style, children, ...props }: Readonly<BeeswarmChartProps>): ReactElement {
  return (
    <DistributionChart<BeeswarmControllerProps> className={className} create={createBeeswarmController} name="BeeswarmChart" props={props} style={style}>
      {children}
    </DistributionChart>
  );
}

/** A ready-made loading placeholder: `BeeswarmChart` with no data and `status="loading"`, its skeleton swarm shimmering under an optional label. */
export function BeeswarmChartLoading({ aspectRatio = "2 / 1", margin, label, className = "", orientation }: Readonly<BeeswarmChartLoadingProps>): ReactElement {
  return <BeeswarmChart aspectRatio={aspectRatio} className={className} data={NO_ROWS} loadingLabel={label} margin={margin} orientation={orientation} status="loading" />;
}

/** One series of observations, one dot each, dodged apart along its category's line so none overlap. It renders nothing itself; place it in a `BeeswarmChart`. */
export const Beeswarm = /* @__PURE__ */ defineCarrier<BeeswarmProps>("beeswarm", "Beeswarm");
/** The axis along the bottom: the values, or the categories when vertical. It renders nothing itself; place it in a `BeeswarmChart`. */
export const BeeswarmXAxis = /* @__PURE__ */ defineCarrier<BeeswarmAxisProps>("beeswarmXAxis", "BeeswarmXAxis");
/** The axis on the left: the categories, or the values when vertical. It renders nothing itself; place it in a `BeeswarmChart`. */
export const BeeswarmYAxis = /* @__PURE__ */ defineCarrier<BeeswarmAxisProps>("beeswarmYAxis", "BeeswarmYAxis");
/** The hover and keyboard tooltip: the hovered observation's value and category. It renders nothing itself; place it in a `BeeswarmChart`. */
export const BeeswarmTooltip = /* @__PURE__ */ defineCarrier<BeeswarmTooltipProps>("beeswarmTooltip", "BeeswarmTooltip");
