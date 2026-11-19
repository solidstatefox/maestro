export interface SankeyNodeDatum {
  /** Display name of the node, shown in labels and tooltips. */
  readonly name: string;
  /** Optional grouping. Not drawn by the chart; read it from your own callbacks such as `getNodeColor`. */
  readonly category?: "source" | "landing" | "outcome";
  readonly [key: string]: unknown;
}

/** A link between two nodes, by node index. */
export interface SankeyLinkDatum {
  /** Index of the source node in `nodes`. */
  readonly source: number;
  /** Index of the target node in `nodes`. */
  target: number;
  /** Size of the flow. Must be a positive finite number to be drawn. */
  readonly value: number;
  readonly [key: string]: unknown;
}

/** Nodes and links of a Sankey diagram. */
export interface SankeyData {
  /** The nodes of the diagram. */
  readonly nodes: SankeyNodeDatum[];
  /** The links between nodes, by node index. */
  readonly links: SankeyLinkDatum[];
}

export interface Margin {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

// Consumer-callback shapes (mirror d3-sankey rows as bklit exposes them).
export interface SankeyPropNode {
  readonly name: string;
  readonly index?: number | undefined;
  readonly value?: number | undefined;
  readonly x0?: number | undefined;
  readonly y0?: number | undefined;
  readonly x1?: number | undefined;
  readonly y1?: number | undefined;
  readonly [key: string]: unknown;
}

export interface SankeyPropLink {
  readonly source: number;
  readonly target: number;
  readonly value: number;
  readonly y0?: number | undefined;
  readonly y1?: number | undefined;
  readonly width?: number | undefined;
  readonly index?: number | undefined;
  readonly [key: string]: unknown;
}
