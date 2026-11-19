import type { ChartEnv, ChartInput } from "../chart/controller";
import { createDistributionController } from "../distribution/controller";
import type { DistributionController, DistributionFamily } from "../distribution/controller";
import { violinPass } from "./pass";
import type { ViolinControllerProps } from "./pass";

export type { ViolinControllerProps } from "./pass";

const VIOLIN: DistributionFamily<ViolinControllerProps> = { chart: "violin", ariaLabel: "Violin plot", pass: violinPass };

export const createViolinController = (env: ChartEnv, initial: ChartInput<ViolinControllerProps>): DistributionController<ViolinControllerProps> =>
  createDistributionController(env, initial, VIOLIN);
