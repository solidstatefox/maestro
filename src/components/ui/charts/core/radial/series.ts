import type { RadialSeries } from "../types/radial";

const PALETTE_SIZE = 5;

/** A finite number at `datum[key]`, else `null`. */
export function radialNumberAt(datum: Readonly<Record<string, unknown>> | undefined | null, key: string): number | null {
  const value = datum?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The timestamp (ms) of a Date, number or date string, else `null`. */
export function radialTimeOf(value: unknown): number | null {
  let time = Number.NaN;
  if (value instanceof Date) {
    time = value.getTime();
  } else if (typeof value === "number") {
    time = value;
  } else if (typeof value === "string") {
    time = Date.parse(value);
  }
  return Number.isFinite(time) ? time : null;
}

/**
 * The colour of a `RadialChart` series: its `color`, else the chart palette by position (`--chart-1` … `--chart-5`, cycling). A layer that
 * isn't a chart series (`series` undefined) falls back to `var(--foreground)`.
 */
export function radialSeriesColor(series: Pick<RadialSeries, "color"> | undefined, index: number): string {
  if (!series) {
    return "var(--foreground)";
  }
  return series.color ?? `var(--chart-${(Math.max(0, index) % PALETTE_SIZE) + 1})`;
}
