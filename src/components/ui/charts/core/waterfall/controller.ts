import type { ChartEnv, ChartInput } from "../chart/controller";
import { createPlotController } from "../plot/controller";
import type { PlotController } from "../plot/controller";
import { waterfallFamily } from "./definition";
import type { WaterfallInput } from "./definition";

export type { WaterfallInput } from "./definition";

export const createWaterfallController = (env: ChartEnv, initial: ChartInput<WaterfallInput>): PlotController<WaterfallInput> =>
  createPlotController(env, initial, waterfallFamily());
