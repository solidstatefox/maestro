import { toNumber } from "../cartesian/domains";
import { propsFor } from "../carriers/table";
import type { ChildTable } from "../carriers/table";
import type { BarProps, BarSquaresProps } from "../types/bar";

export type Row = Record<string, unknown>;

const DEFAULT_BAR_FILL = "var(--chart-line-primary)";
export const DEFAULT_GROUP_GAP = 4;
export const FADED_OPACITY = 0.3;

export interface BarSeries {
  readonly kind: "bar" | "squares";
  /** Data key; also the focus group, so tooltip rows follow it. */
  readonly key: string;
  readonly fill: string;
  /** Series order across Bar + BarSquares children. */
  readonly index: number;
  readonly bar?: BarProps;
  readonly squares?: BarSquaresProps;
}

export function resolveBarSeries(table: ChildTable): BarSeries[] {
  const out: BarSeries[] = [];
  for (const bar of propsFor<BarProps>(table, "bar")) {
    out.push({ kind: "bar", key: bar.dataKey, fill: bar.fill ?? DEFAULT_BAR_FILL, index: out.length, bar });
  }
  for (const sq of propsFor<BarSquaresProps>(table, "barSquares")) {
    out.push({ kind: "squares", key: sq.dataKey, fill: sq.fill ?? DEFAULT_BAR_FILL, index: out.length, squares: sq });
  }
  return out;
}

export interface BarDatum {
  readonly category: string;
  readonly series: string;
  readonly value: number;
  readonly index: number;
  readonly seriesIndex: number;
  readonly source: Row;
}

/** A row cell that is a number, else 0 (anything else is not a plotted value). */
export const numberOrZero = (value: unknown): number =>
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- rows are untyped user data; this is the one boundary parse.
  typeof value === "number" ? value : 0;

/** One datum per (category, series), category-major so the entrance stagger can use `floor(i / seriesCount)`. */
export function buildBarData(data: readonly Row[], xKey: string, series: readonly BarSeries[]): BarDatum[] {
  const out: BarDatum[] = [];
  for (const [index, row] of data.entries()) {
    const category = String(row[xKey]);
    for (const s of series) {
      out.push({ category, series: s.key, value: toNumber(row[s.key]), index, seriesIndex: s.index, source: row });
    }
  }
  return out;
}
