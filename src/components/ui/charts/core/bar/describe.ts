import { propsFor } from "../carriers/table";
import type { ChildTable } from "../carriers/table";
import { DATA_TABLE_ROLE } from "../a11y/data-table";
import type { ChartDataTableProps } from "../a11y/data-table";
import type { ChartA11yInput } from "../a11y/layer";
import { describeRowsChart } from "../a11y/rows";
import type { BarSeries } from "./model";

interface BarDescribeInput {
  readonly data: readonly Readonly<Record<string, unknown>>[];
  readonly xDataKey: string;
  readonly series: readonly BarSeries[];
  readonly loading: boolean;
  readonly horizontal: boolean;
  readonly stacked: boolean;
  readonly table: ChildTable;
}

export const barA11y = (input: BarDescribeInput): ChartA11yInput => ({
  describe: () =>
    describeRowsChart({
      kind: [input.horizontal ? "Horizontal" : "", input.stacked ? "stacked" : "", "bar chart"].filter(Boolean).join(" ").replace(/^./, (c) => c.toUpperCase()),
      unit: input.series.length > 1 ? "groups" : "bars",
      data: input.data,
      xKey: input.xDataKey,
      loading: input.loading,
      series: input.series.map((s) => ({ key: s.key, label: s.bar?.label ?? s.squares?.label, format: s.bar?.valueLabelFormatter })),
    }),
  dataTable: propsFor<ChartDataTableProps>(input.table, DATA_TABLE_ROLE)[0],
});
