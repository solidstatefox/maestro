import { describeSeries, headersFor, humanize, loadingDescription, numberField } from "./describe";
import type { ChartDescription, ValueFormat } from "./describe";

/** A series as a family names it: its data key, its label, its value format. */
export interface RowSeries {
  readonly key: string;
  readonly label?: string;
  readonly format?: ValueFormat;
  /** A cell other than the plain value (a range, a quote). */
  readonly cell?: (row: Readonly<Record<string, unknown>>) => string;
}

export interface RowsChartInput {
  readonly kind: string;
  /** What a row is, plural ("points", "bars"). */
  readonly unit: string;
  readonly data: readonly Readonly<Record<string, unknown>>[];
  readonly xKey: string;
  /** The x axis's own formatter. */
  readonly xFormat?: (value: never) => string;
  /** The x values are dates, whatever their type (a Date, an ISO string, epoch ms). */
  readonly dates?: boolean;
  readonly series: readonly RowSeries[];
  readonly loading?: boolean;
  /** The first column's header; default the x key, humanized. */
  readonly xLabel?: string;
}

export const describeRowsChart = (input: RowsChartInput): ChartDescription => {
  if (input.loading === true) {
    return loadingDescription(input.kind);
  }
  const { data, xKey } = input;
  const xs = data.map((row) => row[xKey]);
  const header = headersFor(xs, input.xFormat, input.dates === true);
  const ordered = input.dates === true || xs.every((x) => x instanceof Date || typeof x === "number");
  return describeSeries({
    kind: input.kind,
    unit: input.unit,
    rows: data,
    headerLabel: input.xLabel ?? humanize(xKey),
    header: (row) => header(row[xKey]),
    order: ordered ? "sequence" : "categories",
    series: input.series.map((s) => ({ label: s.label ?? humanize(s.key), value: (row) => numberField(row, s.key), format: s.format, cell: s.cell })),
  });
};
