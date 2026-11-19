import type { ChartEnv, ChartInput } from "../chart/controller";
import { createPlotController } from "../plot/controller";
import type { PlotController } from "../plot/controller";
import { ganttFamily } from "./definition";
import type { GanttProps } from "./definition";

export type { GanttProps } from "./definition";

export const createGanttController = (env: ChartEnv, initial: ChartInput<GanttProps>): PlotController<GanttProps> =>
  createPlotController(env, initial, ganttFamily());
