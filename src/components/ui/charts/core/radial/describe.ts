import { propsFor } from "../carriers/table";
import type { ChildTable } from "../carriers/table";
import { DATA_TABLE_ROLE } from "../a11y/data-table";
import type { ChartDataTableProps } from "../a11y/data-table";
import type { ChartA11yInput } from "../a11y/layer";
import { describeRowsChart } from "../a11y/rows";
import { indexField } from "../polar/describe";
import type { RadialSeries } from "../types/radial";

export const radialA11y = (data: readonly Readonly<Record<string, unknown>>[], xDataKey: string, series: readonly RadialSeries[], angleType: string, table: ChildTable): ChartA11yInput => ({
  describe: () => ({
    ...describeRowsChart({
      kind: "Radial chart",
      unit: "bins",
      data,
      xKey: xDataKey,
      dates: angleType === "time",
      series: series.map((s) => ({ key: s.dataKey, label: s.label })),
    }),
    rowOf: (datum) => indexField(datum, "bin"),
  }),
  dataTable: propsFor<ChartDataTableProps>(table, DATA_TABLE_ROLE)[0],
});
