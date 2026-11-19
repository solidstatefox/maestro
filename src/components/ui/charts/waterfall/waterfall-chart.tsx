"use client";
// bklit-style WaterfallChart on native TanStack Charts: React's adapter over its controller (core/waterfall/controller.ts on core/plot/controller.ts).
// The chart reads its carriers (`Waterfall`); `Grid`, `BarXAxis`, `BarYAxis` and `ChartTooltip` are the bar and cartesian layers'.
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { createWaterfallController } from "../core/waterfall/controller";
import type { WaterfallChartProps as CoreWaterfallChartProps, WaterfallChartLoadingProps, WaterfallProps } from "../core/types/waterfall";
import { defineCarrier } from "../kit/role";
import { PlotChart } from "../plot/plot-chart";

/** Props of {@link WaterfallChart}. */
export interface WaterfallChartProps extends CoreWaterfallChartProps<ReactNode, CSSProperties> {}

/**
 * A bridge from a start to a total: each step's bar starts where the one before it ended, increases and decreases in their own colours,
 * subtotals and the total from zero, dashed connectors between them and each change as a label. Compose it from children: `Waterfall`,
 * `Grid`, `BarXAxis`, `BarYAxis` and `ChartTooltip`. Hovering a bar dims the others; the crosshair, a dot on its end and the category pill follow.
 */
export const WaterfallChart = /* @__PURE__ */ Object.assign(
  function WaterfallChart(props: Readonly<WaterfallChartProps>): ReactElement {
    return <PlotChart create={createWaterfallController} name="WaterfallChart" props={props} />;
  },
  { displayName: "WaterfallChart" },
);

const NO_DATA: Record<string, unknown>[] = [];

/** Ready-made loading placeholder for a waterfall chart: shorthand for `<WaterfallChart status="loading" />` with no data, drawing its shimmering skeleton. */
export const WaterfallChartLoading = ({ margin, aspectRatio, label, loadingLabel, className }: Readonly<WaterfallChartLoadingProps>): ReactElement => (
  <WaterfallChart aspectRatio={aspectRatio} className={className} data={NO_DATA} loadingLabel={label ?? loadingLabel} margin={margin} status="loading" />
);

/** The steps: one bar per row from where the last ended, with connectors and value labels. It renders nothing itself; place it in a `WaterfallChart`. */
export const Waterfall = /* @__PURE__ */ defineCarrier<WaterfallProps>("waterfall", "Waterfall");
