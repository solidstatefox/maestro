import type { ChartEnv, ChartInput } from "../chart/controller";
import { createPlotController } from "../plot/controller";
import type { PlotController } from "../plot/controller";
import { dumbbellFamily } from "./definition";
import type { DumbbellInput } from "./definition";

export type { DumbbellInput } from "./definition";

export const createDumbbellController = (env: ChartEnv, initial: ChartInput<DumbbellInput>): PlotController<DumbbellInput> =>
  createPlotController(env, initial, dumbbellFamily());
