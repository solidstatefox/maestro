"use client";
// bklit ComposedChart on native TanStack Charts: Area / Line / SeriesBar children are config carriers
// compiled by the cartesian kit (lines, areas) and composed/ (bars as rect marks) into one defineChart.
import { ComposedChart } from "./composed/mounted";
import type { ComposedChartProps } from "./composed/types";

export { ComposedChart };
export type { ComposedChartProps };
