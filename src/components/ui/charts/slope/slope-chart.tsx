"use client";
// bklit-style SlopeChart on native TanStack Charts: React's adapter over its controller (core/slope/controller.ts on core/plot/controller.ts).
// The chart reads its carriers (`Slope`); `ChartTooltip` is the cartesian layers'.
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { createSlopeController } from "../core/slope/controller";
import type { SlopeChartProps as CoreSlopeChartProps, SlopeChartLoadingProps, SlopeProps } from "../core/types/slope";
import { defineCarrier } from "../kit/role";
import { PlotChart } from "../plot/plot-chart";

/** Props of {@link SlopeChart}. */
export interface SlopeChartProps extends CoreSlopeChartProps<ReactNode, CSSProperties> {}

/**
 * A slopegraph: before and after per category, as a line from one column to the other in the colour of its direction, labelled with its
 * name and value at both ends (pushed apart where they would overlap). Compose it from children: `Slope` and `ChartTooltip`. Hovering
 * near a line lights it and dims the rest; its tooltip gives both values and the change.
 */
export const SlopeChart = /* @__PURE__ */ Object.assign(
  function SlopeChart(props: Readonly<SlopeChartProps>): ReactElement {
    return <PlotChart create={createSlopeController} name="SlopeChart" props={props} />;
  },
  { displayName: "SlopeChart" },
);

const NO_DATA: Record<string, unknown>[] = [];

/** Ready-made loading placeholder for a slope chart: shorthand for `<SlopeChart status="loading" />` with no data, drawing its shimmering skeleton. */
export const SlopeChartLoading = ({ margin, aspectRatio, label, loadingLabel, className }: Readonly<SlopeChartLoadingProps>): ReactElement => (
  <SlopeChart aspectRatio={aspectRatio} className={className} data={NO_DATA} loadingLabel={label ?? loadingLabel} margin={margin} status="loading" />
);

/** The lines: one per row from its first value to its second, labelled at both ends. It renders nothing itself; place it in a `SlopeChart`. */
export const Slope = /* @__PURE__ */ defineCarrier<SlopeProps>("slope", "Slope");
