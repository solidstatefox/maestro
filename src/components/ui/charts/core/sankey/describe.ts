import { describeFlows } from "../a11y/describe";
import type { ChartDataTableProps } from "../a11y/data-table";
import type { ChartA11yInput } from "../a11y/layer";
import type { SankeyData } from "./types";

export const sankeyA11y = (data: SankeyData, format: ((value: number) => string) | undefined, valueLabel: string | undefined, dataTable: ChartDataTableProps | undefined): ChartA11yInput => ({
  describe: () =>
    describeFlows({
      kind: "Sankey diagram",
      links: data.links,
      nodeCount: data.nodes.length,
      source: (l) => data.nodes[Number(l.source)]?.name ?? String(l.source),
      target: (l) => data.nodes[Number(l.target)]?.name ?? String(l.target),
      value: (l) => l.value,
      valueLabel: valueLabel ?? "Value",
      format,
    }),
  dataTable,
});
