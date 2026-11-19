import { describeDistribution, describeSeries, formatNumber } from "../a11y/describe";
import type { ChartDescription, ValueFormat } from "../a11y/describe";
import type { DistributionRow, DistributionSeriesProps } from "../types/distribution";
import { finite } from "./frame";

/** A histogram's bins: `x0` to `x1`, a count per series. */
export const describeHistogram = (bins: readonly { readonly x0: number; readonly x1: number; readonly series: readonly { readonly label: string; readonly count: number }[] }[], labels: readonly string[], format: ValueFormat): ChartDescription => {
  const out = describeSeries({
    kind: "Histogram",
    unit: "bins",
    rows: bins,
    headerLabel: "Range",
    header: (bin) => `${format(bin.x0)} to ${format(bin.x1)}`,
    order: "categories",
    series: labels.map((label, n) => ({ label: labels.length > 1 ? label : "Count", value: (bin: (typeof bins)[number]) => bin.series[n]?.count ?? 0 })),
  });
  if (bins.length === 0) {
    return out;
  }
  const totals = bins.map((b) => b.series.reduce((s, x) => s + x.count, 0));
  const peak = totals.indexOf(Math.max(...totals));
  const n = totals.reduce((a, b) => a + b, 0);
  const summary = `Histogram of ${formatNumber(n)} values in ${formatNumber(bins.length)} bins from ${format(bins[0].x0)} to ${format(bins.at(-1)?.x1 ?? bins[0].x1)}; most fall in ${out.rows[peak]?.header ?? ""} (${formatNumber(totals[peak] ?? 0)}).`;
  return { ...out, summary };
};

/** Each series' observations, split by category when the chart has one. */
export const describeSamples = (
  kind: string,
  data: readonly DistributionRow[],
  series: readonly Pick<DistributionSeriesProps, "dataKey" | "label">[],
  categoryKey: string | undefined,
  format: ValueFormat,
): ChartDescription => {
  const groups: { name: string; values: number[] }[] = [];
  const at = new Map<string, number>();
  for (const s of series) {
    for (const row of data) {
      const v = finite(row[s.dataKey]);
      if (v === null) {
        continue;
      }
      const category = categoryKey === undefined ? "" : String(row[categoryKey] ?? "");
      const name = [series.length > 1 ? (s.label ?? s.dataKey) : "", category].filter(Boolean).join(" · ") || (s.label ?? s.dataKey);
      let i = at.get(name);
      if (i === undefined) {
        i = groups.length;
        at.set(name, i);
        groups.push({ name, values: [] });
      }
      groups[i].values.push(v);
    }
  }
  return describeDistribution({ kind, groups, groupLabel: categoryKey === undefined ? "Series" : "Group", format });
};
