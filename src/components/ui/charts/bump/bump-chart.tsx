"use client";
// bklit-style BumpChart on native TanStack Charts: React's adapter over its controller (core/bump/controller.ts on core/plot/controller.ts).
// The chart reads its carriers (`Bump`); `Grid`, `BarXAxis`, `BarYAxis` and `ChartTooltip` are the bar and cartesian layers'.
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { createBumpController } from "../core/bump/controller";
import type { BumpChartProps as CoreBumpChartProps, BumpChartLoadingProps, BumpProps } from "../core/types/bump";
import { defineCarrier } from "../kit/role";
import { PlotChart } from "../plot/plot-chart";

/** Props of {@link BumpChart}. */
export interface BumpChartProps extends CoreBumpChartProps<ReactNode, CSSProperties> {}

/**
 * Ranking over time: each period's values ranked (largest first, smallest first, or as given), every series a line through its ranks on
 * a bump curve with a dot per period and its name at the end, rank 1 at the top. Compose it from children: one `Bump` per series, `Grid`,
 * `BarXAxis`, `BarYAxis` and `ChartTooltip`. Hovering a dot lights its series and walks it through every period; a legend row dims the rest.
 */
export const BumpChart = /* @__PURE__ */ Object.assign(
  function BumpChart(props: Readonly<BumpChartProps>): ReactElement {
    return <PlotChart create={createBumpController} name="BumpChart" props={props} />;
  },
  { displayName: "BumpChart" },
);

const NO_DATA: Record<string, unknown>[] = [];

/** Ready-made loading placeholder for a bump chart: shorthand for `<BumpChart status="loading" />` with no data, drawing its shimmering skeleton. */
export const BumpChartLoading = ({ margin, aspectRatio, label, loadingLabel, className }: Readonly<BumpChartLoadingProps>): ReactElement => (
  <BumpChart aspectRatio={aspectRatio} className={className} data={NO_DATA} loadingLabel={label ?? loadingLabel} margin={margin} status="loading" />
);

/** One series: its line through its ranks, its dots and its name at the end. It renders nothing itself; place it in a `BumpChart`. */
export const Bump = /* @__PURE__ */ defineCarrier<BumpProps>("bump", "Bump");
