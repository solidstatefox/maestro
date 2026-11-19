"use client";
import { useMemo } from "react";
import { useChartHover } from "../cartesian/chart-context";
import type { ChartMarker } from "../types";

/** Markers on the currently focused date (from the chart's native focus), for tooltip content. */
export function useActiveMarkers<T extends Pick<ChartMarker, "date">>(items: readonly T[]): T[] {
  const { tooltipData } = useChartHover();
  return useMemo(() => {
    if (!tooltipData) {
      return [];
    }
    const raw = tooltipData.point.date;
    // SAFETY: the Date constructor coerces any value at runtime; the cast only satisfies its overload.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
    const date = raw instanceof Date ? raw : new Date(raw as string | number);
    const key = date.toDateString();
    return items.filter((m) => m.date.toDateString() === key);
  }, [tooltipData, items]);
}
