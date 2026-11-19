import type { ChartEnv, ChartInput } from "../chart/controller";
import { createDistributionController } from "../distribution/controller";
import type { DistributionController, DistributionFamily } from "../distribution/controller";
import { ecdfPass } from "./pass";
import type { EcdfControllerProps } from "./pass";

export type { EcdfControllerProps } from "./pass";

const ECDF: DistributionFamily<EcdfControllerProps> = { chart: "ecdf", ariaLabel: "ECDF chart", pass: ecdfPass };

export const createEcdfController = (env: ChartEnv, initial: ChartInput<EcdfControllerProps>): DistributionController<EcdfControllerProps> =>
  createDistributionController(env, initial, ECDF);
