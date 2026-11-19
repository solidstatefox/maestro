import { propsFor } from "../carriers/table";
import type { ChildTable } from "../carriers/table";
import { DATA_TABLE_ROLE } from "../a11y/data-table";
import type { ChartDataTableProps } from "../a11y/data-table";
import type { ChartA11yInput } from "../a11y/layer";
import { describeRowsChart } from "../a11y/rows";
import { namedSeries } from "../cartesian/describe";
import type { XAxisConfig } from "../types/cartesian";

export const composedA11y = (data: readonly Readonly<Record<string, unknown>>[], xDataKey: string, table: ChildTable): ChartA11yInput => ({
  describe: () => {
    const series = namedSeries(table, ["seriesBar", "line", "area", "patternArea", "scatter"]).map((s) => ({ key: s.dataKey, label: s.label }));
    const candles = propsFor(table, "candlestick").length > 0 ? [{ key: "close", label: "Close" }] : [];
    return describeRowsChart({
      kind: "Composed chart",
      unit: "points",
      data,
      xKey: xDataKey,
      xFormat: propsFor<XAxisConfig>(table, "xAxis")[0]?.formatValue,
      series: [...series, ...candles],
    });
  },
  dataTable: propsFor<ChartDataTableProps>(table, DATA_TABLE_ROLE)[0],
});
