import { propsFor } from "../carriers/table";
import type { ChildTable } from "../carriers/table";
import { describeSeries, headersFor, humanize, loadingDescription, numberField } from "../a11y/describe";
import type { ChartDescription } from "../a11y/describe";
import type { XAxisConfig } from "../types/cartesian";
import type { Row } from "./series";

interface Named {
  readonly dataKey: string;
  readonly label?: string;
}

/** The value series a cartesian chart draws, in declaration order, each key once. */
export const namedSeries = (table: ChildTable, roles: readonly string[]): readonly Named[] => {
  const seen = new Set<string>();
  const out: Named[] = [];
  for (const role of roles) {
    for (const s of propsFor<Named>(table, role)) {
      if (typeof s.dataKey === "string" && !seen.has(s.dataKey)) {
        seen.add(s.dataKey);
        out.push(s);
      }
    }
  }
  return out;
};

export interface CartesianDescribeInput {
  readonly kind: string;
  readonly data: readonly Row[];
  readonly xDataKey: string;
  readonly table: ChildTable;
  readonly loading: boolean;
  /** The roles whose carriers are series (each a `dataKey` and an optional `label`). */
  readonly roles?: readonly string[];
  /** The x values are dates (the line and area charts' contract). */
  readonly dates?: boolean;
  readonly unit?: string;
  readonly xRole?: string;
  /** A value's format (the tooltip's): the default number format when none. */
  readonly format?: (value: number) => string;
}

export const describeCartesian = (input: CartesianDescribeInput): ChartDescription => {
  const { kind, data, xDataKey, table } = input;
  if (input.loading) {
    return loadingDescription(kind);
  }
  const series = namedSeries(table, input.roles ?? ["line", "area", "patternArea", "profitLossLine"]);
  const xAxis = propsFor<XAxisConfig>(table, input.xRole ?? "xAxis")[0];
  const xs = data.map((row) => row[xDataKey]);
  const header = headersFor(xs, xAxis?.formatValue, input.dates ?? true);
  return describeSeries({
    kind,
    unit: input.unit ?? "points",
    rows: data,
    headerLabel: humanize(xDataKey),
    header: (row) => header(row[xDataKey]),
    series: series.map((s) => ({ label: s.label ?? humanize(s.dataKey), value: (row: Row) => numberField(row, s.dataKey), format: input.format })),
  });
};
