import { propsFor } from "../carriers/table";
import type { ChildTable } from "../carriers/table";
import { DATA_TABLE_ROLE } from "../a11y/data-table";
import type { ChartDataTableProps } from "../a11y/data-table";
import { describeParts, isNumberLike, formatNumber } from "../a11y/describe";
import type { ChartA11yInput } from "../a11y/layer";
import type { ChoroplethChartProps, ChoroplethFeature, ChoroplethTooltipProps } from "../types/choropleth";
import { CHOROPLETH_ROLES } from "./carriers";

export const choroplethA11y = (data: ChoroplethChartProps<unknown>["data"], table: ChildTable): ChartA11yInput => ({
  describe: () => {
    const tip = propsFor<ChoroplethTooltipProps<unknown, unknown>>(table, CHOROPLETH_ROLES.tooltip)[0];
    const features = data.features as readonly ChoroplethFeature[];
    const nameOf = (f: ChoroplethFeature, i: number): string => tip?.getFeatureName?.(f, i) ?? String(f.properties?.name ?? f.properties?.id ?? f.id ?? `Region ${i + 1}`);
    const valueOf = (f: ChoroplethFeature, i: number): number | null => {
      const v = tip?.getFeatureValue?.(f, i) ?? f.properties?.value;
      return isNumberLike(v) ? Number(v) : null;
    };
    const indexed = features.map((f, i) => ({ f, i, value: valueOf(f, i) }));
    const valued = indexed.filter((x) => x.value !== null);
    const shown = valued.length > 0 ? valued : indexed;
    const out = describeParts({
      kind: "Choropleth map",
      unit: "regions",
      items: shown,
      headerLabel: "Region",
      label: (x) => nameOf(x.f, x.i),
      value: (x) => x.value,
      valueLabel: tip?.valueLabel,
      format: tip?.formatValue,
      lead: "Highest",
    });
    if (valued.length === 0) {
      return { ...out, columns: out.columns.slice(0, 1), rows: out.rows.map((r) => ({ ...r, cells: [] })), summary: `Choropleth map of ${formatNumber(features.length)} regions.` };
    }
    const rest = features.length - valued.length;
    return { ...out, summary: rest > 0 ? out.summary.replace(/\.$/, `; ${formatNumber(rest)} more regions without a value.`) : out.summary };
  },
  dataTable: propsFor<ChartDataTableProps>(table, DATA_TABLE_ROLE)[0],
});
