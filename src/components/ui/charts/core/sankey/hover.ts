import type { ChartPoint, ChartRendererRenderContext } from "@tanstack/charts";
import type { SankeyChartProps } from "../types/sankey";
import type { SankeyFocus, SankeyFocusStore } from "./context";
import { rowOf } from "./data";
import { SANKEY_LINK_POINT_MARK_ID, SANKEY_NODE_POINT_MARK_ID } from "./focus";
import { createSankeyHoverWriter, sankeyHoverSets } from "./hover-css";
import type { SankeyDim, SankeyHoverFocus } from "./hover-css";
import type { SankeyDatum } from "./marks";
import type { SankeyData } from "./types";

type SankeyPoint = ChartPoint<SankeyDatum, number, number>;
type SankeyRenderContext = ChartRendererRenderContext<SankeyDatum, number, number>;
type SankeyInteraction = SankeyRenderContext["interaction"];

const isNodeMark = (point: { readonly markId: string } | null | undefined): boolean => point?.markId.startsWith(SANKEY_NODE_POINT_MARK_ID) === true;

/** The node or flow a focused point stands for, by index (a flow's index is its position in the data). */
const hoverFocusOf = (point: SankeyPoint | null, links: readonly object[]): SankeyHoverFocus | null => {
  const row = rowOf(point ?? undefined);
  if (isNodeMark(point) && row.key !== undefined) { return { node: row.key }; }
  if (point?.markId === SANKEY_LINK_POINT_MARK_ID && row.data !== undefined) { return { link: links.indexOf(row.data) }; }
  return null;
};

const storeFocusOf = (focus: SankeyHoverFocus | null): SankeyFocus | null => {
  if (focus === null) { return null; }
  return "node" in focus ? { index: focus.node, kind: "node" } : { index: focus.link, kind: "link" };
};

/** What the latest pass hands the hover (React: assigned while rendering, as refs). */
interface SankeyHoverLatest {
  /** The sanitised data the definition was built from. */
  readonly data: SankeyData;
  /** The faded and rest opacities of the SankeyNode and SankeyLink. */
  readonly dim: SankeyDim;
  readonly hoveredNodeIndex: SankeyChartProps<unknown>["hoveredNodeIndex"];
  readonly onNodeHoverChange: SankeyChartProps<unknown>["onNodeHoverChange"];
}

interface SankeyHoverDeps {
  /** The chart's host (null while detached). */
  readonly host: () => HTMLElement | null;
  /** The renderer's surface, whose svg holds the dimmed elements (null while detached). */
  readonly surface: () => HTMLElement | null;
  readonly focus: SankeyFocusStore;
}

interface SankeyHover {
  /** Records the latest pass's inputs; applies nothing. */
  latest(input: SankeyHoverLatest): void;
  /** The mounted chart's interaction controller, null before the first draw. */
  readonly interaction: () => SankeyInteraction | null;
  /** The renderer's `onRender`: keeps its controller and scene, and puts the controlled hover back on the new scene. */
  readonly onRender: (context: SankeyRenderContext) => void;
  /** The renderer's `onFocusChange`: the dim, the focus store and `onNodeHoverChange`. */
  readonly focusChange: (point: SankeyPoint | null) => void;
  /** A new chart is mounted: the dim starts at rest. */
  readonly reset: () => void;
  /** The chart is detached: the hover's own svgs leave with it. */
  readonly detach: () => void;
  /** Drives the native focus to the controlled `hoveredNodeIndex` (`undefined`: uncontrolled, nothing). */
  readonly applyControlled: () => void;
  /** Focuses node `index` through the native controller (`null` clears). */
  readonly focusNode: (index: number | null) => void;
  /** Focuses flow `index` (its position in the data) through the native controller (`null` clears). */
  readonly focusLink: (index: number | null) => void;
}

export function createSankeyHover({ host, surface, focus }: SankeyHoverDeps): SankeyHover {
  const writer = createSankeyHoverWriter(host, surface);
  let interaction: SankeyInteraction | null = null;
  let scene: SankeyRenderContext["scene"] | null = null;
  let current: SankeyHoverLatest = { data: { links: [], nodes: [] }, dim: { link: 0.1, node: 0.4, stroke: 0.5 }, hoveredNodeIndex: undefined, onNodeHoverChange: undefined };
  const focusPoint = (point: SankeyPoint | undefined): void => {
    if (point !== undefined) { interaction?.setControlledFocus(point); }
  };
  const focusNode = (index: number | null): void => {
    if (index === null) {
      interaction?.setControlledFocus(null);
      return;
    }
    focusPoint(scene?.points.find((candidate) => candidate.markId.startsWith(SANKEY_NODE_POINT_MARK_ID) && rowOf(candidate).key === index));
  };
  const focusLink = (index: number | null): void => {
    if (index === null) {
      interaction?.setControlledFocus(null);
      return;
    }
    const link = current.data.links.at(index);
    focusPoint(link === undefined ? undefined : scene?.points.find((candidate) => candidate.markId === SANKEY_LINK_POINT_MARK_ID && rowOf(candidate).data === link));
  };
  const applyControlled = (): void => {
    const target = current.hoveredNodeIndex;
    if (interaction !== null && target !== undefined) { focusNode(target); }
  };
  return {
    latest(input) {
      current = input;
    },
    interaction: () => interaction,
    onRender(context) {
      interaction = context.interaction;
      scene = context.scene;
      writer.refresh();
      applyControlled();
    },
    focusChange(point) {
      const { links } = current.data;
      const hovered = hoverFocusOf(point, links);
      writer.write(hovered === null ? null : sankeyHoverSets(links, hovered), current.dim);
      focus.set(storeFocusOf(hovered));
      current.onNodeHoverChange?.(isNodeMark(point) ? (rowOf(point ?? undefined).key ?? null) : null);
    },
    reset: writer.reset,
    detach: writer.detach,
    applyControlled,
    focusNode,
    focusLink,
  };
}
