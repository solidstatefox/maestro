import type { SceneNode } from "@tanstack/charts";
import { propsFor } from "../carriers/table";
import type { ChildTable } from "../carriers/table";
import type { GridProps, XAxisConfig, YAxisConfig } from "../types/cartesian";

export interface MarkGuides {
  readonly grid: GridProps | null;
  readonly xAxis: XAxisConfig | null;
  readonly yAxis: YAxisConfig | null;
}

/** The last `Grid`, `XAxis` and `YAxis` among a chart's carriers (null when absent). */
export const readGuides = (table: ChildTable): MarkGuides => ({
  grid: propsFor<GridProps>(table, "grid").at(-1) ?? null,
  xAxis: propsFor<XAxisConfig>(table, "xAxis").at(-1) ?? null,
  yAxis: propsFor<YAxisConfig>(table, "yAxis").at(-1) ?? null,
});

export const TICK_SIZE = 12;

/** A grid line in the `Grid`'s stroke (bklit: dashed `--chart-grid`). */
export const gridRule = (key: string, grid: GridProps, x1: number, y1: number, x2: number, y2: number): SceneNode => ({
  className: "bkm-mc-grid",
  key,
  kind: "rule",
  style: {
    stroke: grid.stroke ?? "var(--chart-grid)",
    strokeDasharray: grid.strokeDasharray ?? "4,4",
    strokeOpacity: grid.strokeOpacity ?? 1,
    strokeWidth: grid.strokeWidth ?? 1,
  },
  x1,
  x2,
  y1,
  y2,
});

/** A tick label (bklit: 12px `--chart-label`). */
export const tickLabel = (key: string, text: string, x: number, y: number, anchor: "start" | "middle" | "end", options: { readonly weight?: number; readonly size?: number; readonly fill?: string } = {}): SceneNode => ({
  anchor,
  baseline: "middle",
  className: "bkm-mc-tick",
  fontSize: options.size ?? TICK_SIZE,
  fontWeight: options.weight ?? 400,
  key,
  kind: "label",
  style: { fill: options.fill ?? "var(--chart-label)" },
  text,
  x,
  y,
});

/** `count + 1` evenly spaced fractions from 0 to 1. */
export const fractions = (count: number): number[] => Array.from({ length: count + 1 }, (_, index) => index / count);
