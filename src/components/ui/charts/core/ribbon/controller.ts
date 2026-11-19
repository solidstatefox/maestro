import type { ChartEnv, ChartInput } from "../chart/controller";
import { createPlotController } from "../plot/controller";
import type { PlotController } from "../plot/controller";
import { ribbonFamily } from "./definition";
import type { RibbonInput } from "./definition";

export type { RibbonInput } from "./definition";

export const createRibbonController = (env: ChartEnv, initial: ChartInput<RibbonInput>): PlotController<RibbonInput> =>
  createPlotController(env, initial, ribbonFamily());
