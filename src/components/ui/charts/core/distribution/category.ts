import { fittingCategories } from "../axis-fit";
import type { GridGuideProps } from "../cartesian/grid-guides";
import { propsFor } from "../carriers/table";
import type { ChildTable } from "../carriers/table";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import type { ChartMargin } from "../theme";
import type { DistributionAxisProps, DistributionRow } from "../types/distribution";
import { categoryAxis, categoryLabelRoom, gridOn, plotMargin, valueAxis, valueLabelRoom } from "./frame";

export type DistributionOrientation = "vertical" | "horizontal";

/** The categories of `data` under `key`, in first-seen order (rows without one are skipped). */
export const categoriesOf = (data: readonly DistributionRow[], key: string): string[] => {
  const seen = new Set<string>();
  for (const row of data) {
    const value = row[key];
    if (value !== null && value !== undefined && value !== "") {
      seen.add(String(value));
    }
  }
  return [...seen];
};

export interface CategoryFrameInput {
  readonly categories: readonly string[];
  readonly orientation: DistributionOrientation | undefined;
  readonly table: ChildTable;
  /** The axes' carrier roles. */
  readonly xRole: string;
  readonly yRole: string;
  /** The values the value axis must show. */
  readonly extent: readonly [number, number];
  readonly domain: readonly [number, number] | undefined;
  readonly margin: Partial<ChartMargin> | undefined;
  /** The band scale's padding between and outside the categories. */
  readonly paddingInner?: number;
  readonly paddingOuter?: number;
  /** Extra room past the extent, as a share of its span (dots and curves that overhang). */
  readonly pad?: number;
}

export interface CategoryFrame {
  readonly horizontal: boolean;
  /** The value axis carrier (the one along the values: y when vertical, x when horizontal). */
  readonly valueAxisProps: DistributionAxisProps | undefined;
  readonly valueDomain: [number, number];
  /** The native scales, keyed `x` and `y`, for a chart `width` px wide: a category axis along the bottom labels every n-th category
   * when the labels would run together. */
  readonly scalesAt: (width: number) => Readonly<Record<"x" | "y", unknown>>;
  readonly margin: ChartMargin;
}

export function categoryFrame(input: CategoryFrameInput): CategoryFrame {
  const horizontal = input.orientation === "horizontal";
  const xAxis = propsFor<DistributionAxisProps>(input.table, input.xRole).at(0);
  const yAxis = propsFor<DistributionAxisProps>(input.table, input.yRole).at(0);
  const grid = propsFor<GridGuideProps>(input.table, "grid").at(0);
  const valueAxisProps = horizontal ? xAxis : yAxis;
  const [lo, hi] = input.domain ?? input.extent;
  const span = hi - lo || Math.abs(hi) || 1;
  const pad = input.domain === undefined ? (input.pad ?? 0.04) * span : 0;
  // Padding never takes an all-positive extent below zero (a load time of -1,000 ms is no tick to show).
  const value = scaleLinear().domain([lo >= 0 ? Math.max(0, lo - pad) : lo - pad, hi + pad]);
  if (input.domain === undefined) {
    value.nice(valueAxisProps?.numTicks ?? 5);
  }
  const valueDomain = value.domain();
  const band = scaleBand<string>()
    .domain(input.categories)
    .paddingInner(input.paddingInner ?? 0.3)
    .paddingOuter(input.paddingOuter ?? 0.2);
  const valueScale = { scale: value, grid: gridOn(grid, horizontal ? "columns" : "rows"), axis: valueAxis(valueAxisProps, horizontal ? "x" : "y") };
  const categoryScale = (side: "x" | "y", axis: DistributionAxisProps | undefined, shown?: readonly string[]): unknown => ({ scale: band, grid: false, axis: categoryAxis(axis !== undefined, side, shown) });
  const left = horizontal
    ? (yAxis === undefined ? 16 : categoryLabelRoom(input.categories))
    : (yAxis === undefined ? 16 : valueLabelRoom(valueDomain, yAxis));
  const margin = plotMargin(input.margin, { left, bottom: xAxis === undefined ? 16 : 36 });
  const labelled = (width: number): readonly string[] | undefined => fittingCategories(input.categories, input.categories, width - margin.left - margin.right);
  return {
    horizontal,
    valueAxisProps,
    valueDomain,
    scalesAt: horizontal
      ? () => ({ x: valueScale, y: categoryScale("y", yAxis) })
      : (width) => ({ x: categoryScale("x", xAxis, labelled(width)), y: valueScale }),
    margin,
  };
}
