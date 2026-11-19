import type { ChartEnv, ChartInput } from "../chart/controller";
import { createPlotController } from "../plot/controller";
import type { PlotController } from "../plot/controller";
import { errorBarFamily } from "./definition";
import type { ErrorBarInput } from "./definition";

export type { ErrorBarInput } from "./definition";

export const createErrorBarController = (env: ChartEnv, initial: ChartInput<ErrorBarInput>): PlotController<ErrorBarInput> =>
  createPlotController(env, initial, errorBarFamily());
