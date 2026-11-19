"use client";
// bklit `useBarDepthEntries` (bar-depth.tsx:380-519) on the public chart context: core/bar/depth-entries.ts measures the entries.
import { createContext, useContext, useMemo } from "react";
import { useChartStable } from "../kit/cartesian/chart-context";
import { barDepthEntries } from "../core/bar/depth-entries";
import type { BarDepthConfig } from "../core/bar/depth-entries";
import type { BarDepthEntry } from "../core/types/bar";

const BarDepthConfigContext = /* @__PURE__ */ createContext<BarDepthConfig>({});

/** Publishes the `<BarDepthProvider>` config child to the chart's passthrough children (the hook's only reader). */
export const BarDepthConfigProvider = /* @__PURE__ */ (() => BarDepthConfigContext.Provider)();

export function useBarDepthEntries(dataKey: string, activeIndex?: number): BarDepthEntry[] {
  const { data, barScale, bandWidth, yScale, innerHeight, innerWidth, barXAccessor } = useChartStable();
  const { segmentsAccessor, minBarHeight } = useContext(BarDepthConfigContext);
  return useMemo(
    () => barDepthEntries({ data, barScale, bandWidth, yScale, innerHeight, innerWidth, barXAccessor }, { segmentsAccessor, minBarHeight }, dataKey, activeIndex),
    [data, barScale, bandWidth, yScale, innerHeight, innerWidth, barXAccessor, segmentsAccessor, minBarHeight, dataKey, activeIndex],
  );
}
