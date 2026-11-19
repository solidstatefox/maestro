import { propsFor } from "../carriers/table";
import type { ChildTable } from "../carriers/table";
import { DATA_TABLE_ROLE } from "../a11y/data-table";
import type { ChartDataTableProps } from "../a11y/data-table";
import { describeSeries, rangeText } from "../a11y/describe";
import type { ChartA11yInput } from "../a11y/layer";
import type { LiveLinePoint } from "../types/live-line";

interface LiveDescribeInput {
  readonly data: readonly LiveLinePoint[];
  readonly value: number;
  readonly windowSecs: number;
  readonly label: string | undefined;
  readonly formatValue: (value: number) => string;
  readonly formatTime: (time: number) => string;
  readonly table: ChildTable;
}

export const liveLineA11y = ({ data, value, windowSecs, label, formatValue, formatTime, table }: LiveDescribeInput): ChartA11yInput => ({
  describe: () => {
    const latest = data.at(-1)?.time ?? 0;
    const shown = data.filter((p) => p.time >= latest - windowSecs);
    const name = label ?? "Value";
    const out = describeSeries({
      kind: "Live line chart",
      unit: "samples",
      rows: shown,
      headerLabel: "Time",
      header: (p) => formatTime(p.time),
      series: [{ label: name, value: (p) => p.value, format: formatValue }],
    });
    const range = rangeText(shown.map((p) => p.value), formatValue);
    const summary = `Live line chart, ${name} now ${formatValue(value)}${range === "" ? "" : `; over the last ${windowSecs} seconds ${range}`}.`;
    return { ...out, summary };
  },
  dataTable: propsFor<ChartDataTableProps>(table, DATA_TABLE_ROLE)[0],
});
