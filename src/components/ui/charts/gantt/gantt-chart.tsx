"use client";
// bklit-style GanttChart on native TanStack Charts (TanStack Charts' Gantt lanes with dependency arrows): React's adapter over the Gantt
// controller (core/gantt/controller.ts on core/plot/controller.ts). The chart reads its carriers: `GanttTasks`, `GanttDependencies`,
// `GanttToday`, `GanttXAxis`, `GanttYAxis`, and the shared `Grid` and `ChartTooltip`.
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { createGanttController } from "../core/gantt/controller";
import type { GanttChartProps as CoreGanttChartProps, GanttChartLoadingProps, GanttDependenciesProps, GanttTask, GanttTasksProps, GanttTodayProps, GanttXAxisProps, GanttYAxisProps } from "../core/types/gantt";
import { defineCarrier } from "../kit/role";
import { PlotChart } from "../plot/plot-chart";

/** Props of {@link GanttChart}. */
export interface GanttChartProps extends CoreGanttChartProps<ReactNode, CSSProperties> {}

/**
 * A project schedule: one row per task on a time axis, phases rolling their tasks up, each bar filled with its progress, milestones as
 * diamonds and finish-to-start dependencies as arrows. Compose it from children: `GanttTasks`, `GanttDependencies`, `GanttToday`,
 * `GanttXAxis`, `GanttYAxis`, `Grid` and `ChartTooltip`. Hovering a row dims the others and lights its own dependencies.
 */
export const GanttChart = /* @__PURE__ */ Object.assign(
  function GanttChart(props: Readonly<GanttChartProps>): ReactElement {
    return <PlotChart create={createGanttController} name="GanttChart" props={props} />;
  },
  { displayName: "GanttChart" },
);

const NO_TASKS: GanttTask[] = [];

/** Ready-made loading placeholder for a Gantt chart: shorthand for `<GanttChart status="loading" />` with no tasks, drawing six shimmering skeleton rows. */
export const GanttChartLoading = ({ margin, rowHeight, label, loadingLabel, className }: Readonly<GanttChartLoadingProps>): ReactElement => (
  <GanttChart className={className} data={NO_TASKS} loadingLabel={label ?? loadingLabel} margin={margin} rowHeight={rowHeight} status="loading" />
);

/** The task bars (filled with their progress), the phase rows' summary bars and the milestones' diamonds. It renders nothing itself; place it in a `GanttChart`. */
export const GanttTasks = /* @__PURE__ */ defineCarrier<GanttTasksProps>("ganttTasks", "GanttTasks");
/** One elbow arrow from each task to every task in its `dependsOn`. It renders nothing itself; place it in a `GanttChart`. */
export const GanttDependencies = /* @__PURE__ */ defineCarrier<GanttDependenciesProps>("ganttDependencies", "GanttDependencies");
/** A dashed rule on a status date, labelled under the rows. It renders nothing itself; place it in a `GanttChart`. */
export const GanttToday = /* @__PURE__ */ defineCarrier<GanttTodayProps>("ganttToday", "GanttToday");
/** The time axis, on top by default. It renders nothing itself; place it in a `GanttChart`. */
export const GanttXAxis = /* @__PURE__ */ defineCarrier<GanttXAxisProps>("ganttXAxis", "GanttXAxis");
/** The task names in a gutter on the left, phases in bold and their tasks indented. It renders nothing itself; place it in a `GanttChart`. */
export const GanttYAxis = /* @__PURE__ */ defineCarrier<GanttYAxisProps>("ganttYAxis", "GanttYAxis");
