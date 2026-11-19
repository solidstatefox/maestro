import { propsFor } from "../carriers/table";
import type { ChildTable } from "../carriers/table";
import type { BarDepthEntry, BarDepthProviderProps } from "../types/bar";
import type { ChartStableContextValue } from "../types/context";
import { depthEntry } from "./geometry";
import { numberOrZero } from "./model";

/** The `<BarDepthProvider>` options the hook reads (published to the chart's custom children). */
export type BarDepthConfig = Pick<BarDepthProviderProps, "segmentsAccessor" | "minBarHeight">;

/** The first `<BarDepthProvider>` child's options. */
export const barDepthConfigOf = (table: ChildTable): BarDepthConfig => {
  const provider = propsFor<BarDepthProviderProps>(table, "barDepthProvider").at(0);
  return { segmentsAccessor: provider?.segmentsAccessor, minBarHeight: provider?.minBarHeight };
};

/** The chart context fields the entries are measured from. */
export type BarDepthScales = Pick<ChartStableContextValue<unknown>, "data" | "barScale" | "bandWidth" | "yScale" | "innerHeight" | "innerWidth" | "barXAccessor">;

/** One entry per row of `dataKey` with a drawable bar; `activeIndex` marks one row active. */
export function barDepthEntries(scales: BarDepthScales, config: BarDepthConfig, dataKey: string, activeIndex?: number): BarDepthEntry[] {
  const { data, barScale, bandWidth, yScale, innerHeight, innerWidth, barXAccessor } = scales;
  const { segmentsAccessor, minBarHeight = 0 } = config;
  if (barScale === undefined || bandWidth === undefined || bandWidth === 0 || barXAccessor === undefined) {
    return [];
  }
  const zeroY = yScale(0);
  const step = barScale.step();
  return data.flatMap((datum, dataIndex): BarDepthEntry[] => {
    const segments = segmentsAccessor?.(datum)?.filter((seg) => seg.value > 0) ?? [];
    const segmentTotal = segments.reduce((sum, seg) => sum + seg.value, 0);
    const raw = datum[dataKey];
    const value = segments.length > 0 ? segmentTotal : numberOrZero(raw);
    const label = barXAccessor(datum);
    const top = segments.at(-1);
    const hasTop = top !== undefined && segmentTotal > 0;
    const entry = depthEntry({
      index: dataIndex,
      label,
      value,
      bandX: barScale(label) ?? 0,
      bandWidth,
      step,
      innerWidth,
      plotLeft: 0,
      baselineY: zeroY,
      // d3 returns undefined for a NaN input.
      valueY: Number.isNaN(value) ? innerHeight : yScale(value),
      minBarHeight,
      topSegmentFraction: hasTop ? top.value / segmentTotal : undefined,
    });
    if (!entry) {
      return [];
    }
    const { index, ...geometry } = entry;
    return [{ ...geometry, dataIndex: index, datum, isActive: activeIndex !== undefined && dataIndex === activeIndex }];
  });
}
