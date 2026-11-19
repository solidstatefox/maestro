"use client";

import type { ReactElement } from "react";
import { BarChart } from "./bar-chart";
import type { BarChartLoadingProps } from "./core/types/bar";

const EMPTY_DATA: Record<string, unknown>[] = [];

/** Ready-made loading placeholder for a bar chart: shorthand for `<BarChart status="loading" />` with no data, drawing the shimmering skeleton bars. */
const BarChartLoading = ({ margin, aspectRatio = "2 / 1", className = "", loadingFill }: Readonly<BarChartLoadingProps>): ReactElement => (
  <BarChart aspectRatio={aspectRatio} className={className} data={EMPTY_DATA} loadingFill={loadingFill} margin={margin} status="loading" />
);

export { BarChartLoading };
