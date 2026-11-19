import type { ChartDataTableProps } from "../a11y/data-table";
import { describeParts } from "../a11y/describe";
import type { ChartA11yInput } from "../a11y/layer";
import { indexField } from "../polar/describe";
import type { FunnelStage } from "../types/funnel";

export const funnelA11y = (
  data: readonly FunnelStage[],
  formatValue: (value: number) => string,
  formatPercentage: (pct: number) => string,
  dataTable: ChartDataTableProps | undefined,
): ChartA11yInput => ({
  describe: () => {
    const first = data[0]?.value ?? 0;
    const pct = (s: FunnelStage): string => (first > 0 ? formatPercentage((s.value / first) * 100) : "");
    const shown = (s: FunnelStage): string => s.displayValue ?? formatValue(s.value);
    const out = describeParts({
      kind: "Funnel chart",
      unit: "stages",
      items: data,
      headerLabel: "Stage",
      label: (s) => s.label,
      value: (s) => s.value,
      format: formatValue,
      order: "sequence",
      extra: [{ label: "Of first stage", numeric: true, cell: pct }],
    });
    const last = data.at(-1);
    const rows = out.rows.map((row, i) => ({ ...row, cells: [shown(data[i]), ...row.cells.slice(1)] }));
    const summary =
      data.length === 0 || last === undefined
        ? out.summary
        : `Funnel chart, ${data.length} stages from ${data[0].label} ${shown(data[0])} to ${last.label} ${shown(last)} (${pct(last)} of the first).`;
    return { ...out, rows, summary, rowOf: (datum) => indexField(datum, "stage") };
  },
  dataTable,
});
