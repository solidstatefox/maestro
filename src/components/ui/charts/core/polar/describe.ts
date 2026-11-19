import { propsFor } from "../carriers/table";
import { isRecord } from "../guards";
import type { ChildTable } from "../carriers/table";
import { DATA_TABLE_ROLE } from "../a11y/data-table";
import type { ChartDataTableProps } from "../a11y/data-table";
import { describeParts, describeSeries, formatNumber, listOf } from "../a11y/describe";
import type { ChartA11yInput } from "../a11y/layer";
import type { RadarData, RadarMetric } from "../radar/rows";
import type { PieData } from "../types/pie";
import type { RingData } from "../types/ring";

/** A focused datum's index field (`sliceIndex`, `ringIndex`), else -1. */
export const indexField = (datum: unknown, key: string): number => {
  const v = isRecord(datum) ? datum[key] : undefined;
  return typeof v === "number" ? v : -1;
};

const dataTableOf = (table: ChildTable): ChartDataTableProps | undefined => propsFor<ChartDataTableProps>(table, DATA_TABLE_ROLE)[0];

export const pieA11y = (data: readonly PieData[], donut: boolean, table: ChildTable): ChartA11yInput => ({
  describe: () => ({
    ...describeParts({ kind: donut ? "Donut chart" : "Pie chart", unit: "slices", items: data, headerLabel: "Slice", label: (d) => d.label, value: (d) => d.value, share: true }),
    rowOf: (datum) => indexField(datum, "sliceIndex"),
  }),
  dataTable: dataTableOf(table),
});

const percent = /* @__PURE__ */ new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 0 });

export const ringA11y = (data: readonly RingData[], table: ChildTable): ChartA11yInput => ({
  describe: () => {
    const progress = (d: RingData): string => (d.maxValue > 0 ? percent.format(d.value / d.maxValue) : "");
    const out = describeParts({
      kind: "Ring chart",
      unit: "rings",
      items: data,
      headerLabel: "Ring",
      label: (d) => d.label,
      value: (d) => d.value,
      extra: [
        { label: "Maximum", numeric: true, cell: (d) => formatNumber(d.maxValue) },
        { label: "Progress", numeric: true, cell: progress },
      ],
    });
    const summary = `Ring chart, ${data.length} rings: ${listOf(data.map((d) => `${d.label} ${formatNumber(d.value)} of ${formatNumber(d.maxValue)} (${progress(d)})`), 4)}.`;
    return { ...out, summary, rowOf: (datum) => indexField(datum, "ringIndex") };
  },
  dataTable: dataTableOf(table),
});

export const radarA11y = (data: readonly RadarData[], metrics: readonly RadarMetric[], table: ChildTable): ChartA11yInput => ({
  describe: () => {
    const out = describeSeries({
      kind: "Radar chart",
      unit: "metrics",
      rows: metrics,
      headerLabel: "Metric",
      header: (m) => m.label,
      order: "categories",
      series: data.map((s) => ({ label: s.label, value: (m: RadarMetric) => s.values[m.key] ?? null })),
    });
    return { ...out, rowOf: (datum) => (isRecord(datum) && typeof datum.metric === "string" && datum.series !== -1 ? metrics.findIndex((m) => m.key === datum.metric) : -1) };
  },
  dataTable: dataTableOf(table),
});
