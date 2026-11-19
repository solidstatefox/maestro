import type { HeatmapColumn } from "./columns";

/** Skeleton columns mirror the target with zeroed counts. */
export const heatmapSkeletonColumns = (target: readonly Readonly<HeatmapColumn>[]): HeatmapColumn[] =>
  target.map((column: Readonly<HeatmapColumn>) => ({
    bin: column.bin,
    bins: column.bins.map((bin) => ({ bin: bin.bin, count: 0, date: bin.date })),
  }));

/** The loading state's x domain as the chart's own (mutable) pair. */
export const heatmapLoadingXDomain = (xDomain: readonly [Date, Date] | undefined): [Date, Date] | undefined =>
  xDomain === undefined ? undefined : [xDomain[0], xDomain[1]];
