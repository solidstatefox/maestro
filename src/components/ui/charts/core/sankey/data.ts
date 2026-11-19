import type { ChartPoint } from "@tanstack/charts";
import type { SankeyData } from "./types";

/** The slice of a focused point's datum (a laid-out node, label or flow row) the chart reads. */
export interface FocusRow {
  readonly key?: number;
  readonly value?: number;
  readonly data?: { readonly name?: string; readonly value?: number };
  readonly sourceNode?: { readonly data?: { readonly name?: string } };
  readonly targetNode?: { readonly data?: { readonly name?: string } };
  readonly sourceKey?: number;
  readonly targetKey?: number;
}

export const rowOf = (point: ChartPoint | undefined): FocusRow => (typeof point?.datum === "object" && point.datum !== null ? point.datum : {});

const valid = (value: number): boolean => Number.isFinite(value) && value >= 0;

// sankeyDiagram throws on a non-finite or negative link value and on a graph with no positive link (bklit draws NaN geometry).
// A bad value becomes a zero-width flow; with no positive flow at all the chart is the empty state.
export const sanitizeSankeyData = (data: SankeyData): SankeyData => {
  if (!data.links.some((link) => valid(link.value) && link.value > 0)) {return { links: [], nodes: [] };}
  return data.links.every((link) => valid(link.value))
    ? data
    : { links: data.links.map((link) => (valid(link.value) ? link : { ...link, value: 0 })), nodes: data.nodes };
};
