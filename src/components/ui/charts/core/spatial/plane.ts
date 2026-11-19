import { scaleLinear } from "../scales";
import { X_TICK_PADDING } from "../theme";
import type { SpatialAxisProps, SpatialGridProps, SpatialMargin } from "../types/spatial";

type Domain = readonly [number, number];

/** The data's extent of `key` (finite values only); `[0, 1]` when there is none. */
export const extentOf = (rows: readonly Readonly<Record<string, unknown>>[], key: string): Domain => {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      if (value < min) { min = value; }
      if (value > max) { max = value; }
    }
  }
  if (min > max) { return [0, 1]; }
  if (min === max) { return [min - 1, max + 1]; }
  return [min, max];
};

/** A domain rounded out to nice tick values. */
export const niceDomain = (domain: Domain, count = 5): [number, number] => {
  const [a, b] = scaleLinear().domain([domain[0], domain[1]]).nice(count).domain();
  return [Number(a), Number(b)];
};

/** Formats a tick: thousands abbreviated (`2k`, `1.5k`), as bklit's y axis does. */
export const formatSpatialTick = (value: number): string => {
  if (Math.abs(value) >= 1000) {
    return `${Math.round(value / 100) / 10}k`;
  }
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
};

const TICK_LABELS = { fontSize: 12, opacity: 1, thin: false } as const;
// Full strength: the native title is 76% opaque, which takes `--chart-label` under 4.5:1 on a light card.
const AXIS_TITLE = { fontSize: 12, opacity: 1 } as const;

/** One axis as the native scale option takes it (`false`: no axis); its labels sit `pad` px further out, clear of marks at the edge. */
const axisOption = (axis: SpatialAxisProps | undefined, side: "x" | "y", pad: number): object | false => {
  if (axis === undefined) {
    return false;
  }
  const format = axis.formatValue ?? formatSpatialTick;
  return {
    line: false,
    ticks: { count: axis.numTicks ?? 5, size: 0, padding: (side === "x" ? X_TICK_PADDING : 8) + pad, format },
    tickLabels: TICK_LABELS,
    ...(axis.label === undefined ? {} : { label: { text: axis.label, ...AXIS_TITLE } }),
  };
};

const gridOption = (grid: SpatialGridProps | undefined, shown: boolean): object | false =>
  grid === undefined || !shown
    ? false
    : { stroke: grid.stroke ?? "var(--chart-grid)", strokeOpacity: 1, strokeWidth: 1, strokeDasharray: grid.strokeDasharray ?? "4 4" };

export interface PlaneInput {
  readonly xDomain: Domain;
  readonly yDomain: Domain;
  readonly xAxis: SpatialAxisProps | undefined;
  readonly yAxis: SpatialAxisProps | undefined;
  readonly grid: SpatialGridProps | undefined;
  /** How far marks reach past the domain's edge (a hexagon's radius), in px: the axes' labels stand clear of it. */
  readonly pad?: number;
}

/** The native `scales` of the plane. */
export const planeScales = ({ xDomain, yDomain, xAxis, yAxis, grid, pad = 0 }: PlaneInput): Record<"x" | "y", object> => ({
  x: { scale: scaleLinear().domain([xDomain[0], xDomain[1]]), grid: gridOption(grid, grid?.vertical === true), axis: axisOption(xAxis, "x", pad) },
  y: { scale: scaleLinear().domain([yDomain[0], yDomain[1]]), grid: gridOption(grid, grid?.horizontal !== false), axis: axisOption(yAxis, "y", pad) },
});

/** The plot's margins: room for the axes that are shown (their labels and titles) and for marks reaching `pad` px past the domain, the
 * reader's sides over them. */
export const planeMargin = (xAxis: SpatialAxisProps | undefined, yAxis: SpatialAxisProps | undefined, given: Partial<SpatialMargin> | undefined, pad = 0): SpatialMargin => {
  const left = yAxis === undefined ? 12 : yAxis.label === undefined ? 44 : 60;
  const bottom = xAxis === undefined ? 12 : xAxis.label === undefined ? 32 : 50;
  return { top: 12 + pad, right: 16 + pad, bottom: bottom + pad, left: left + pad, ...given };
};
