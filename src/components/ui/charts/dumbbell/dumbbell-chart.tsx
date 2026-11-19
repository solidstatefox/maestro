"use client";
// bklit-style DumbbellChart on native TanStack Charts: React's adapter over its controller (core/dumbbell/controller.ts on core/plot/controller.ts).
// The chart reads its carriers (`Dumbbell`); `Grid`, `BarXAxis`, `BarYAxis` and `ChartTooltip` are the bar and cartesian layers'.
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { createDumbbellController } from "../core/dumbbell/controller";
import type { DumbbellChartProps as CoreDumbbellChartProps, DumbbellChartLoadingProps, DumbbellProps } from "../core/types/dumbbell";
import { defineCarrier } from "../kit/role";
import { PlotChart } from "../plot/plot-chart";

/** Props of {@link DumbbellChart}. */
export interface DumbbellChartProps extends CoreDumbbellChartProps<ReactNode, CSSProperties> {}

/**
 * Two values per category and the distance between them: a dot on each, joined by a bar, running left to right down a list of categories
 * or, `vertical`, standing up. Compose it from children: `Dumbbell`, `Grid`, `BarXAxis`, `BarYAxis` and `ChartTooltip`. Hovering a row dims
 * the others and its tooltip shows both values and the change; a `ChartLegend` row dims the other value's dots.
 */
export const DumbbellChart = /* @__PURE__ */ Object.assign(
  function DumbbellChart(props: Readonly<DumbbellChartProps>): ReactElement {
    return <PlotChart create={createDumbbellController} name="DumbbellChart" props={props} />;
  },
  { displayName: "DumbbellChart" },
);

const NO_DATA: Record<string, unknown>[] = [];

/** Ready-made loading placeholder for a dumbbell chart: shorthand for `<DumbbellChart status="loading" />` with no data, drawing its shimmering skeleton. */
export const DumbbellChartLoading = ({ margin, aspectRatio, label, loadingLabel, className }: Readonly<DumbbellChartLoadingProps>): ReactElement => (
  <DumbbellChart aspectRatio={aspectRatio} className={className} data={NO_DATA} loadingLabel={label ?? loadingLabel} margin={margin} status="loading" />
);

/** The dumbbells: a dot on each row's two values and a bar between them. It renders nothing itself; place it in a `DumbbellChart`. */
export const Dumbbell = /* @__PURE__ */ defineCarrier<DumbbellProps>("dumbbell", "Dumbbell");
