import type { RadialDotLayout } from "../types/radial";
import { TAU, createRadialScale, polarToCartesian } from "./geometry";

/** One dot slot of the grid. */
export interface RadialDotSlot {
  /** Row index, 0 = innermost. */
  readonly row: number;
  /** The bin (time slot) the dot belongs to. */
  readonly bin: number;
  /** Angle in radians, 0 = 12 o'clock, clockwise. */
  readonly angle: number;
  readonly radius: number;
  readonly x: number;
  readonly y: number;
}

/** What `computeRadialDotGrid` lays out. */
export interface RadialDotGridInput {
  readonly binCount: number;
  /** Radius of the band's base (row 0 sits half a step outside it). */
  readonly baseRadius: number;
  /** Centre-to-centre spacing between rows (and between dots on a row). */
  readonly spacing: number;
  readonly rows: number;
  readonly layout?: RadialDotLayout;
}

/** The radius of row `row` (the dots' centres). */
export function radialDotRowRadius(baseRadius: number, spacing: number, row: number): number {
  return baseRadius + spacing * (row + 0.5);
}

/** Every dot slot of the polar grid, grouped by bin and sorted by row (innermost first). A bin with no slot on a row skips that row. */
export function computeRadialDotGrid({ binCount, baseRadius, spacing, rows, layout = "grid" }: RadialDotGridInput): RadialDotSlot[][] {
  const byBin: RadialDotSlot[][] = Array.from({ length: Math.max(0, binCount) }, () => []);
  if (binCount <= 0 || spacing <= 0 || rows <= 0) {
    return byBin;
  }
  for (let row = 0; row < rows; row++) {
    const radius = radialDotRowRadius(baseRadius, spacing, row);
    const count = layout === "columns" ? binCount : Math.max(1, Math.round((TAU * radius) / spacing));
    for (let j = 0; j < count; j++) {
      const angle = ((j + 0.5) / count) * TAU;
      const bin = Math.min(binCount - 1, Math.floor((angle / TAU) * binCount));
      const { x, y } = polarToCartesian(angle, radius);
      byBin[bin]?.push({ row, bin, angle, radius, x, y });
    }
  }
  return byBin;
}

/** Value → row count on a radial scale, so the dot area (and with the `grid` layout, the dot count) grows linearly with the value. */
export function createRadialRowScale({ maxValue, baseRadius, spacing, rows }: { maxValue: number; baseRadius: number; spacing: number; rows: number }): (value: number) => number {
  const radial = createRadialScale({ maxValue, innerRadius: baseRadius, outerRadius: baseRadius + rows * spacing });
  return (value: number) => {
    if (!(value > 0)) {
      return 0;
    }
    return Math.max(0, Math.round((radial(value) - baseRadius) / spacing));
  };
}

/** Stacked row boundaries for one bin: `ends[i]` is the exclusive end row of series `i`. A positive value always gets at least one row. */
export function stackRadialRows(values: readonly number[], toRows: (value: number) => number, maxRows: number): number[] {
  const ends: number[] = [];
  let cumulative = 0;
  let previousEnd = 0;
  for (const value of values) {
    const v = value > 0 ? value : 0;
    cumulative += v;
    let end = toRows(cumulative);
    if (v > 0) {
      end = Math.max(end, previousEnd + 1);
    }
    end = Math.min(maxRows, Math.max(previousEnd, end));
    ends.push(end);
    previousEnd = end;
  }
  return ends;
}
