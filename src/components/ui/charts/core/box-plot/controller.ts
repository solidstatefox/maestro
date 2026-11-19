import type { ChartEnv, ChartInput } from "../chart/controller";
import { createDistributionController } from "../distribution/controller";
import type { DistributionController, DistributionFamily } from "../distribution/controller";
import { boxPlotPass } from "./pass";
import type { BoxPlotControllerProps } from "./pass";

export type { BoxPlotControllerProps } from "./pass";

const BOX_PLOT: DistributionFamily<BoxPlotControllerProps> = { chart: "box-plot", ariaLabel: "Box plot", pass: boxPlotPass };

export const createBoxPlotController = (env: ChartEnv, initial: ChartInput<BoxPlotControllerProps>): DistributionController<BoxPlotControllerProps> =>
  createDistributionController(env, initial, BOX_PLOT);
