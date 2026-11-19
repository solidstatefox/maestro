import type { ChartEnv, ChartInput } from "../chart/controller";
import { createDistributionController } from "../distribution/controller";
import type { DistributionController, DistributionFamily } from "../distribution/controller";
import { ridgelinePass } from "./pass";
import type { RidgelineControllerProps } from "./pass";

export type { RidgelineControllerProps } from "./pass";

const RIDGELINE: DistributionFamily<RidgelineControllerProps> = { chart: "ridgeline", ariaLabel: "Ridgeline plot", pass: ridgelinePass };

export const createRidgelineController = (env: ChartEnv, initial: ChartInput<RidgelineControllerProps>): DistributionController<RidgelineControllerProps> =>
  createDistributionController(env, initial, RIDGELINE);
