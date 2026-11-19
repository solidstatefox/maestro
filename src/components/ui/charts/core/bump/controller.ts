import type { ChartEnv, ChartInput } from "../chart/controller";
import { createPlotController } from "../plot/controller";
import type { PlotController } from "../plot/controller";
import { bumpFamily } from "./definition";
import type { BumpInput } from "./definition";

export type { BumpInput } from "./definition";

export const createBumpController = (env: ChartEnv, initial: ChartInput<BumpInput>): PlotController<BumpInput> =>
  createPlotController(env, initial, bumpFamily());
