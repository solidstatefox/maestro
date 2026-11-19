import type { ChartEnv, ChartInput } from "../chart/controller";
import { createDistributionController } from "../distribution/controller";
import type { DistributionController, DistributionFamily } from "../distribution/controller";
import { beeswarmPass } from "./pass";
import type { BeeswarmControllerProps } from "./pass";

export type { BeeswarmControllerProps } from "./pass";

const BEESWARM: DistributionFamily<BeeswarmControllerProps> = { chart: "beeswarm", ariaLabel: "Beeswarm chart", pass: beeswarmPass };

export const createBeeswarmController = (env: ChartEnv, initial: ChartInput<BeeswarmControllerProps>): DistributionController<BeeswarmControllerProps> =>
  createDistributionController(env, initial, BEESWARM);
