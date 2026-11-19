import type { ChartEnv, ChartInput } from "../chart/controller";
import { createPlotController } from "../plot/controller";
import type { PlotController } from "../plot/controller";
import { lollipopFamily } from "./definition";
import type { LollipopInput } from "./definition";

export type { LollipopInput } from "./definition";

export const createLollipopController = (env: ChartEnv, initial: ChartInput<LollipopInput>): PlotController<LollipopInput> =>
  createPlotController(env, initial, lollipopFamily());
