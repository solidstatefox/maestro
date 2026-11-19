import type { ChartPoint } from "@tanstack/charts";
import type { SankeyTooltipProps } from "../types/sankey";
import { rowOf } from "./data";
import type { FocusRow } from "./data";
import { SANKEY_LINK_POINT_MARK_ID, SANKEY_NODE_POINT_MARK_ID } from "./focus";
import type { SankeyData, SankeyLinkDatum } from "./types";

interface SankeyTooltipContent {
  readonly rows: readonly { readonly color: string; readonly label: string; readonly value: string }[];
  readonly title: string;
}

const endName = (end: FocusRow["sourceNode"], key: number | undefined): string => end?.data?.name ?? `Node ${key}`;

export const sankeyTooltipContent = (formatValue: (value: number) => string, valueLabel: string) => (points: readonly ChartPoint[]): SankeyTooltipContent => {
  const point = points.at(0);
  const row = rowOf(point);
  if (point?.markId === SANKEY_LINK_POINT_MARK_ID) {
    const title = `${endName(row.sourceNode, row.sourceKey)} → ${endName(row.targetNode, row.targetKey)}`;
    return { rows: [{ color: "var(--chart-foreground-muted)", label: "Flow", value: formatValue(row.data?.value ?? 0) }], title };
  }
  return {
    rows: [{ color: "var(--chart-line-primary)", label: valueLabel, value: formatValue(row.value ?? 0) }],
    title: row.data?.name ?? `Node ${point?.datumIndex ?? 0}`,
  };
};

/** What the tooltip body renderer is handed: the focused points and the framework's default body. */
export interface SankeyTooltipBodyContext<Node> {
  readonly points: readonly ChartPoint[];
  readonly defaultBody: Node;
}

// Custom tooltip bodies (nodeContent / linkContent) ride the native tooltip's body slot.
// Always a body renderer: the native body wrapper carries the shared bklit panel + spring enter (styles.css).
export const sankeyTooltipBody = <Node>(data: SankeyData, config: SankeyTooltipProps<Node> | undefined) =>
  ({ points, defaultBody }: SankeyTooltipBodyContext<Node>): Node => {
    const point = points.at(0);
    const row = rowOf(point);
    if (point?.markId === SANKEY_LINK_POINT_MARK_ID && config?.linkContent) {
      // SAFETY: a link point's datum is the sankey link row, a SankeyLinkDatum.
      const link = row.data as SankeyLinkDatum;
      const index = row.data ? data.links.indexOf(link) : 0;
      return config.linkContent({ index, link: { ...link, index } });
    }
    if (point?.markId.startsWith(SANKEY_NODE_POINT_MARK_ID) === true && config?.nodeContent) {
      const index = row.key ?? 0;
      return config.nodeContent({ index, node: { ...data.nodes[index], index, name: data.nodes[index]?.name ?? "", value: row.value } });
    }
    return defaultBody;
  };
