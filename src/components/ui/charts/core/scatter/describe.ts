import { propsFor } from "../carriers/table";
import type { ChildTable } from "../carriers/table";
import { DATA_TABLE_ROLE } from "../a11y/data-table";
import type { ChartDataTableProps } from "../a11y/data-table";
import type { ChartA11yInput } from "../a11y/layer";
import { describeRowsChart } from "../a11y/rows";
import { namedSeries } from "../cartesian/describe";

export const scatterA11y = (data: readonly Readonly<Record<string, unknown>>[], xDataKey: string, table: ChildTable, formatX?: (date: Date) => string): ChartA11yInput => ({
  describe: () =>
    describeRowsChart({
      kind: "Scatter chart",
      unit: "points",
      data,
      xKey: xDataKey,
      dates: true,
      xFormat: formatX,
      series: namedSeries(table, ["scatter", "line"]).map((s) => ({ key: s.dataKey, label: s.label })),
    }),
  dataTable: propsFor<ChartDataTableProps>(table, DATA_TABLE_ROLE)[0],
});
