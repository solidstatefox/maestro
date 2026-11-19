export const CHART_ROLE = /* @__PURE__ */ Symbol.for("migrated.chartRole");

/**
 * A carrier's optional feature (core/cartesian/enable-*.ts, core/bar/depth.ts `enableBarDepth`): the builders only that carrier's role
 * draws with, handed to the core when the carrier is used, so importing the kit's barrel bundles them only with the carrier. React's
 * reader calls it off this marker as it reads the chart's children; every framework's carrier also calls it as it registers.
 */
export const CARRIER_ENABLE = /* @__PURE__ */ Symbol.for("migrated.carrierEnable");
