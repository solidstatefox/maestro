/** The D3 Sankey runtime is the pinned d3-sankey 0.12.3 package. */
declare module "d3-sankey" {
  export type SankeyNode<N, L = unknown> = N & { index?: number; depth?: number; height?: number; value?: number; x0: number; x1: number; y0: number; y1: number };
  /** A completed layout replaces the input datum's numeric/string source and
   * target IDs with resolved, positioned node objects. Do not intersect with
   * the input fields: `number & SankeyNode` is not a runtime D3 link. */
  export type SankeyLink<N,L> = Omit<L,"source" | "target"> & {
    source:SankeyNode<N,L>;
    target:SankeyNode<N,L>;
    width:number;
    y0:number;
    y1:number;
  };
  /** The actual d3-sankey layout output (the graph's node and link rows are enriched). */
  export interface SankeyGraph<N,L> {
    nodes: SankeyNode<N,L>[];
    links: SankeyLink<N,L>[];
  }
  export type SankeyNodeAlign<N> = (node:N,n:number)=>number;
  export function sankeyLeft<N>(node:N,n:number):number;
  export function sankeyRight<N>(node:N,n:number):number;
  export function sankeyCenter<N>(node:N,n:number):number;
  export function sankeyJustify<N>(node:N,n:number):number;
  export interface SankeyLayout<N,L> {
    (graph: {nodes:N[];links:L[]}):SankeyGraph<N,L>;
    nodeId(accessor:(node:N)=>string):this;
    nodeAlign(align:(node:N,n:number)=>number):this;
    nodeWidth(value:number):this;
    nodePadding(value:number):this;
    nodeSort(sort:((a:N,b:N)=>number)|undefined):this;
    iterations(value:number):this;
    extent(value:[[number,number],[number,number]]):this;
  }
  export function sankey<N,L>():SankeyLayout<N,L>;
  export function sankeyLinkHorizontal<N,L>(): (link:L)=>string|null;
}
