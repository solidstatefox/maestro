import type { ChartEnv, ChartInput } from "../chart/controller";
import { createPlotController } from "../plot/controller";
import type { PlotController } from "../plot/controller";
import { slopeFamily } from "./definition";
import type { SlopeInput } from "./definition";

export type { SlopeInput } from "./definition";

export const createSlopeController = (env: ChartEnv, initial: ChartInput<SlopeInput>): PlotController<SlopeInput> =>
  createPlotController(env, initial, slopeFamily());
