import { sankey, sankeyCenter } from "d3-sankey";
import type { SankeyGraph, SankeyLink, SankeyNode } from "d3-sankey";
import { memoCell } from "../memo";
import type { Transition } from "../motion/phase";
import { writable } from "../store";
import type { Writable } from "../store";
import type { SankeyContextValue, SankeyTooltipData } from "../types/sankey";
import { bumpPath } from "./bump";
import type { Margin, SankeyLinkDatum, SankeyNodeDatum } from "./types";

/** Focus the chart reports: a node or a flow, by its index. */
export interface SankeyFocus {
  readonly kind: "node" | "link";
  readonly index: number;
}

/** The chart's focus; `set` notifies only on a different node or flow. */
export type SankeyFocusStore = Writable<SankeyFocus | null>;

const sameFocus = (left: SankeyFocus | null, right: SankeyFocus | null): boolean => {
  if (left === null || right === null) { return left === right; }
  return left.kind === right.kind && left.index === right.index;
};

export function createSankeyFocusStore(): SankeyFocusStore {
  const store = writable<SankeyFocus | null>(null);
  return {
    get: store.get,
    subscribe: store.subscribe,
    set: (next) => {
      if (!sameFocus(next, store.get())) { store.set(next); }
    },
  };
}

/** `setTooltipData`: a value, or an updater, which sees `null` (the focus lives in the renderer, not in framework state). */
type SankeyTooltipSetter = (next: SankeyTooltipData | null | ((previous: SankeyTooltipData | null) => SankeyTooltipData | null)) => void;

/** The chart's container ref as the context hands it out: `{ current }`, the host while the controller is attached (React's `RefObject` shape). */
export interface SankeyContainerRef {
  current: HTMLDivElement | null;
}

/** The `useSankey()` value the controller publishes. */
export type SankeyChartContext = SankeyContextValue<SankeyContainerRef, SankeyTooltipSetter>;

type SankeyLayoutNode = SankeyNode<SankeyNodeDatum, SankeyLinkDatum>;
type SankeyLayoutLink = SankeyLink<SankeyNodeDatum, SankeyLinkDatum>;

// d3-sankey's sankeyLinkHorizontal (source.x1,y0 to target.x0,y1), without its d3-shape and d3-path imports.
const createPath = (link: SankeyLayoutLink): string => {
  const { source, target } = link as { source: SankeyLayoutNode; target: SankeyLayoutNode };
  return bumpPath([[source.x1 ?? Number.NaN, link.y0 ?? Number.NaN], [target.x0 ?? Number.NaN, link.y1 ?? Number.NaN]]);
};

const hoveredNodeOf = (controlled: number | null | undefined, focus: SankeyFocus | null): number | null => {
  if (controlled !== undefined) { return controlled; }
  return focus?.kind === "node" ? focus.index : null;
};

const tooltipDataOf = (focus: SankeyFocus | null, graph: SankeyGraph<SankeyNodeDatum, SankeyLinkDatum>): SankeyTooltipData | null => {
  if (!focus) {
    return null;
  }
  if (focus.kind === "node") {
    const node = graph.nodes.at(focus.index);
    return node === undefined ? null : { type: "node", nodeIndex: focus.index, x: ((node.x0 ?? 0) + (node.x1 ?? 0)) / 2, y: ((node.y0 ?? 0) + (node.y1 ?? 0)) / 2, data: node };
  }
  const link = graph.links.at(focus.index);
  if (link === undefined) { return null; }
  // SAFETY: after d3-sankey's layout every link's source and target are the node rows (the input indices are replaced).
  const { source, target } = link as { source: SankeyLayoutNode; target: SankeyLayoutNode };
  return { type: "link", linkIndex: focus.index, x: ((source.x1 ?? 0) + (target.x0 ?? 0)) / 2, y: ((link.y0 ?? 0) + (link.y1 ?? 0)) / 2, data: link };
};

interface SankeyContextInput {
  readonly data: { readonly nodes: readonly SankeyNodeDatum[]; readonly links: readonly SankeyLinkDatum[] };
  /** The host's measured box. */
  readonly size: { readonly width: number; readonly height: number };
  readonly margin: Margin;
  readonly nodeWidth: number;
  readonly nodePadding: number;
  readonly animationDuration: number;
  readonly enterTransition: Transition | undefined;
  /** The chart's controlled `hoveredNodeIndex` prop. */
  readonly hoveredNodeIndex: number | null | undefined;
  /** The focus store's value. */
  readonly focus: SankeyFocus | null;
  /** Focus a node / flow through the native controller (`null` clears). */
  readonly focusNode: (index: number | null) => void;
  readonly focusLink: (index: number | null) => void;
  readonly containerRef: SankeyContainerRef;
  /** The chart's ready gate flag (bklit's isLoaded). */
  readonly isLoaded: boolean;
  /** Increments when the entrance replays. */
  readonly revealEpoch: number;
}

/** One builder per chart, fed on every read of its context. */
export function createSankeyContext(): (input: SankeyContextInput) => SankeyChartContext {
  const graphCell = memoCell<SankeyGraph<SankeyNodeDatum, SankeyLinkDatum>>();
  const tooltipCell = memoCell<SankeyTooltipData | null>();
  const setterCell = memoCell<SankeyTooltipSetter>();
  const valueCell = memoCell<SankeyChartContext>();
  return (input) => {
    const { data, size, margin, nodeWidth, nodePadding, animationDuration, enterTransition, hoveredNodeIndex: controlledNode, focus, focusNode, focusLink, containerRef, isLoaded, revealEpoch } = input;
    const innerWidth = size.width - margin.left - margin.right;
    const innerHeight = size.height - margin.top - margin.bottom;
    const graph = graphCell(
      [data, nodeWidth, nodePadding, innerWidth, innerHeight],
      () =>
        sankey<SankeyNodeDatum, SankeyLinkDatum>()
          .nodeWidth(nodeWidth)
          .nodePadding(nodePadding)
          .nodeAlign(sankeyCenter)
          .extent([[0, 0], [innerWidth, innerHeight]])({ nodes: data.nodes.map((node) => ({ ...node })), links: data.links.map((link) => ({ ...link })) }),
    );
    const tooltipData = tooltipCell([focus, graph], () => tooltipDataOf(focus, graph));
    const setTooltipData = setterCell([focusNode, focusLink], (): SankeyTooltipSetter => (next) => {
      const value = typeof next === "function" ? next(null) : next;
      if (value === null) {
        focusNode(null);
        return;
      }
      if (value.type === "node" && value.nodeIndex !== undefined) {
        focusNode(value.nodeIndex);
        return;
      }
      if (value.linkIndex !== undefined) {
        focusLink(value.linkIndex);
      }
    });
    return valueCell(
      [graph, size.width, size.height, innerWidth, innerHeight, margin, controlledNode, focus, focusNode, focusLink, tooltipData, setTooltipData, containerRef, isLoaded, animationDuration, enterTransition, revealEpoch],
      () => ({
        graph,
        nodes: graph.nodes,
        links: graph.links,
        width: size.width,
        height: size.height,
        innerWidth,
        innerHeight,
        margin,
        hoveredNodeIndex: hoveredNodeOf(controlledNode, focus),
        hoveredLinkIndex: focus?.kind === "link" ? focus.index : null,
        setHoveredNodeIndex: focusNode,
        setHoveredLinkIndex: focusLink,
        tooltipData,
        setTooltipData,
        containerRef,
        isLoaded,
        animationDuration,
        enterTransition,
        revealEpoch,
        mousePos: null,
        createPath,
      }),
    );
  };
}
