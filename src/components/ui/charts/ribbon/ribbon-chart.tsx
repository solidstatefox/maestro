"use client";
// bklit-style RibbonChart on native TanStack Charts: React's adapter over its controller (core/ribbon/controller.ts on core/plot/controller.ts).
// The chart reads its carriers (`Ribbon`, `RibbonLine`); `Grid`, `XAxis`, `YAxis` and `ChartTooltip` are the cartesian layers'.
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { createRibbonController } from "../core/ribbon/controller";
import type { RibbonChartProps as CoreRibbonChartProps, RibbonChartLoadingProps, RibbonLineProps, RibbonProps } from "../core/types/uncertainty";
import { defineCarrier } from "../kit/role";
import { PlotChart } from "../plot/plot-chart";

/** Props of {@link RibbonChart}. */
export interface RibbonChartProps extends CoreRibbonChartProps<ReactNode, CSSProperties> {}

/**
 * A value over time and how far it spreads: bands between low and high bounds (quantile ranges, forecast intervals), widest first, and a
 * line through them (the median, the forecast). Compose it from children: `Ribbon`s, `RibbonLine`s, `Grid`, `XAxis`, `YAxis` and
 * `ChartTooltip`. Hovering shows the crosshair, a dot on each line, the date pill and every line's value and band's range.
 */
export const RibbonChart = /* @__PURE__ */ Object.assign(
  function RibbonChart(props: Readonly<RibbonChartProps>): ReactElement {
    return <PlotChart create={createRibbonController} name="RibbonChart" props={props} />;
  },
  { displayName: "RibbonChart" },
);

const NO_DATA: Record<string, unknown>[] = [];

/** Ready-made loading placeholder for a ribbon chart: shorthand for `<RibbonChart status="loading" />` with no data, drawing its shimmering skeleton. */
export const RibbonChartLoading = ({ margin, aspectRatio, label, loadingLabel, className }: Readonly<RibbonChartLoadingProps>): ReactElement => (
  <RibbonChart aspectRatio={aspectRatio} className={className} data={NO_DATA} loadingLabel={label ?? loadingLabel} margin={margin} status="loading" />
);

/** A band between a low and a high bound over time. It renders nothing itself; place it in a `RibbonChart`. */
export const Ribbon = /* @__PURE__ */ defineCarrier<RibbonProps>("ribbon", "Ribbon");
/** A line through the ribbons (the median, the forecast). It renders nothing itself; place it in a `RibbonChart`. */
export const RibbonLine = /* @__PURE__ */ defineCarrier<RibbonLineProps>("ribbonLine", "RibbonLine");
