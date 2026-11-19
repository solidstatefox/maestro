"use client";
// bklit-style LollipopChart on native TanStack Charts: React's adapter over its controller (core/lollipop/controller.ts on core/plot/controller.ts).
// The chart reads its carriers (`Lollipop`); `Grid`, `BarXAxis`, `BarYAxis` and `ChartTooltip` are the bar and cartesian layers'.
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { createLollipopController } from "../core/lollipop/controller";
import type { LollipopChartProps as CoreLollipopChartProps, LollipopChartLoadingProps, LollipopProps } from "../core/types/lollipop";
import { defineCarrier } from "../kit/role";
import { PlotChart } from "../plot/plot-chart";

/** Props of {@link LollipopChart}. */
export interface LollipopChartProps extends CoreLollipopChartProps<ReactNode, CSSProperties> {}

/**
 * A bar chart's lighter cousin: a thin stem from zero and a round head on each value, standing up or, `horizontal`, running from the left
 * down a list of categories. Compose it from children: `Lollipop`, `Grid`, `BarXAxis`, `BarYAxis` and `ChartTooltip`. Hovering a lollipop
 * dims the others; standing up, the crosshair and the category pill follow.
 */
export const LollipopChart = /* @__PURE__ */ Object.assign(
  function LollipopChart(props: Readonly<LollipopChartProps>): ReactElement {
    return <PlotChart create={createLollipopController} name="LollipopChart" props={props} />;
  },
  { displayName: "LollipopChart" },
);

const NO_DATA: Record<string, unknown>[] = [];

/** Ready-made loading placeholder for a lollipop chart: shorthand for `<LollipopChart status="loading" />` with no data, drawing its shimmering skeleton. */
export const LollipopChartLoading = ({ margin, aspectRatio, label, loadingLabel, className }: Readonly<LollipopChartLoadingProps>): ReactElement => (
  <LollipopChart aspectRatio={aspectRatio} className={className} data={NO_DATA} loadingLabel={label ?? loadingLabel} margin={margin} status="loading" />
);

/** The lollipops: a stem from zero and a head on each row's value. It renders nothing itself; place it in a `LollipopChart`. */
export const Lollipop = /* @__PURE__ */ defineCarrier<LollipopProps>("lollipop", "Lollipop");
