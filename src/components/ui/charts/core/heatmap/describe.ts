import { propsFor } from "../carriers/table";
import type { ChildTable } from "../carriers/table";
import { DATA_TABLE_ROLE } from "../a11y/data-table";
import type { ChartDataTableProps } from "../a11y/data-table";
import { dateFormatFor, formatNumber, loadingDescription } from "../a11y/describe";
import type { ChartDescription } from "../a11y/describe";
import type { ChartA11yInput } from "../a11y/layer";
import type { HeatmapBin, HeatmapColumn } from "./columns";
import type { HeatmapTooltipProps } from "../types/heatmap";

export const heatmapA11y = (data: readonly HeatmapColumn[], table: ChildTable, loading: boolean): ChartA11yInput => ({
  describe: (): ChartDescription => {
    if (loading) {
      return loadingDescription("Heatmap");
    }
    const bins: HeatmapBin[] = data.flatMap((c) => c.bins).toSorted((a, b) => a.date.getTime() - b.date.getTime());
    const fmt = dateFormatFor(bins.map((b) => new Date(b.date.getTime())));
    const label = propsFor<HeatmapTooltipProps<unknown>>(table, "heatmapTooltip")[0]?.formatLabel;
    const rows = bins.map((b) => ({
      header: fmt(new Date(b.date.getTime())),
      cells: [formatNumber(b.count), ...(label === undefined ? [] : [label(b.count, b.date)])],
      datum: b,
    }));
    const columns = [{ label: "Date" }, { label: "Count", numeric: true }, ...(label === undefined ? [] : [{ label: "Detail" }])];
    if (bins.length === 0) {
      return { kind: "Heatmap", columns, rows, summary: "Heatmap, no cells." };
    }
    const total = bins.reduce((s, b) => s + b.count, 0);
    const busiest = bins.reduce((best, b) => (b.count > best.count ? b : best), bins[0]);
    const empty = bins.filter((b) => b.count <= 0).length;
    const summary = `Heatmap, ${formatNumber(bins.length)} days from ${rows[0].header} to ${rows.at(-1)?.header ?? ""}, ${formatNumber(total)} in total; busiest ${fmt(new Date(busiest.date.getTime()))} (${formatNumber(busiest.count)})${empty > 0 ? `, ${formatNumber(empty)} days with none` : ""}.`;
    return { kind: "Heatmap", columns, rows, summary };
  },
  dataTable: propsFor<ChartDataTableProps>(table, DATA_TABLE_ROLE)[0],
});
