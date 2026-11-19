import type { ChartEnv, ChartInput } from "../chart/controller";
import { createDistributionController } from "../distribution/controller";
import type { DistributionController, DistributionFamily } from "../distribution/controller";
import { histogramPass } from "./pass";
import type { HistogramControllerProps } from "./pass";

export type { HistogramControllerProps } from "./pass";

const HISTOGRAM: DistributionFamily<HistogramControllerProps> = { chart: "histogram", ariaLabel: "Histogram", pass: histogramPass };

export const createHistogramController = (env: ChartEnv, initial: ChartInput<HistogramControllerProps>): DistributionController<HistogramControllerProps> =>
  createDistributionController(env, initial, HISTOGRAM);
