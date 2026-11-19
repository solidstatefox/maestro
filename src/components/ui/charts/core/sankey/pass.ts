import { motion } from "@tanstack/charts/motion";
import { memoCell } from "../memo";
import { toCssEase } from "../motion/enter-transition";
import type { Transition } from "../motion/phase";
import type { StyleObject } from "../style";
import { parseAspectRatio } from "../theme";
import type { SankeyChartProps, SankeyLinkProps, SankeyNodeProps, SankeyTooltipProps } from "../types/sankey";
import { sanitizeSankeyData } from "./data";
import { buildSankeyDefinition, sankeyNodeColor } from "./definition";
import type { SankeyDefinition } from "./definition";
import type { SankeyDim } from "./hover-css";
import { intFmt } from "./marks";
import { sankeyTooltipBody } from "./tooltip";
import type { SankeyTooltipBodyContext } from "./tooltip";
import type { Margin, SankeyData } from "./types";

/** The props a pass reads (the framework keeps `className`, `children`, `revealSignature` and the hover props). */
type SankeyPassProps<Node> = Pick<
  SankeyChartProps<Node>,
  "data" | "margin" | "animationDuration" | "enterTransition" | "aspectRatio" | "nodeWidth" | "nodePadding" | "ariaLabel" | "ariaDescription"
>;

/** The config carriers' props: the last `SankeyLink`, `SankeyNode` and `SankeyTooltip` (the first two `{}` when absent). */
interface SankeyCarriers<Node> {
  readonly link: SankeyLinkProps<Node>;
  readonly node: SankeyNodeProps;
  readonly tooltip: SankeyTooltipProps<Node> | undefined;
}

interface SankeyPassInput<Node> {
  readonly props: SankeyPassProps<Node>;
  readonly carriers: SankeyCarriers<Node>;
}

export interface SankeyPass<Node> {
  /** The data sanitised for the native layout (data.ts). */
  readonly data: SankeyData;
  readonly margin: Margin;
  readonly animationDuration: number;
  readonly enterTransition: Transition | undefined;
  readonly nodeWidth: number;
  readonly nodePadding: number;
  readonly definition: SankeyDefinition;
  /** The tooltip body renderer: the reader's `nodeContent` / `linkContent`, else the default body. */
  readonly renderTooltipBody: (context: SankeyTooltipBodyContext<Node>) => Node;
  /** The host's style: the entrance vars the sankey.css fades read, its box. */
  readonly hostStyle: StyleObject;
  /** The faded and rest opacities the hover dims by (hover-css.ts). */
  readonly dim: SankeyDim;
  /** The CSS entrance's duration in ms (`--bkm-sankey-dur`). */
  readonly entranceMs: number;
  readonly aspectRatio: number;
  readonly ariaLabel: string;
  readonly ariaDescription: string | undefined;
}

const DEFAULT_MARGIN: Margin = { bottom: 40, left: 180, right: 180, top: 40 };
const DEFAULT_ANIMATION_MS = 1100;
const DEFAULT_ASPECT_RATIO = "2 / 1";
const DEFAULT_NODE_WIDTH = 16;
const DEFAULT_NODE_PADDING = 24;
const DEFAULT_ARIA_LABEL = "Sankey chart";
const DEFAULT_VALUE_LABEL = "Sessions";
const formatInt = (value: number): string => intFmt.format(value);

/** The renderer every sankey chart hosts: `initial: "always"` replays the entrance on hydrated (server-rendered) SVG too. */
export const SANKEY_RENDERER = /* @__PURE__ */ motion({ initial: "always" });

/** One chart's pass builder: `idPrefix` is its svg id prefix (link patterns), `host` its host element. */
export function createSankeyPass<Node>(idPrefix: string, host: () => HTMLElement | null): (input: SankeyPassInput<Node>) => SankeyPass<Node> {
  const dataCell = memoCell<SankeyData>();
  const marginCell = memoCell<Margin>();
  const nodeColorCell = memoCell<(index: number) => string>();
  const definitionCell = memoCell<SankeyDefinition>();
  const dimCell = memoCell<SankeyDim>();
  const bodyCell = memoCell<SankeyPass<Node>["renderTooltipBody"]>();
  const hostStyleCell = memoCell<StyleObject>();
  return ({ props, carriers }) => {
    const { enterTransition, ariaDescription, animationDuration = DEFAULT_ANIMATION_MS, nodeWidth = DEFAULT_NODE_WIDTH, nodePadding = DEFAULT_NODE_PADDING } = props;
    const { link, node, tooltip } = carriers;
    const data = dataCell([props.data], () => sanitizeSankeyData(props.data));
    const formatValue = tooltip?.formatValue ?? formatInt;
    const valueLabel = tooltip?.valueLabel ?? DEFAULT_VALUE_LABEL;
    const nodeColor = nodeColorCell([data.nodes, link.getNodeColor, node], () => sankeyNodeColor(data.nodes, node, link));
    const margin = marginCell([props.margin], () => ({ ...DEFAULT_MARGIN, ...props.margin }));
    const useGradient = link.useGradient ?? true;
    // Entrance starts on the first draw, without bklit's ParentSize frames (sankey-chart.tsx:246), at the user's direction (no frame waits); the curve is unchanged.
    // The renderer measures its own container at mount, so the chart is drawn once, in the first commit.
    const definition = definitionCell(
      [animationDuration, data, enterTransition, link, margin, nodeColor, node, nodePadding, nodeWidth, tooltip, formatValue, valueLabel, useGradient],
      () => buildSankeyDefinition({ data, link, node, tooltip, margin, nodeWidth, nodePadding, animationDuration, enterTransition, idPrefix, nodeColor, formatValue, valueLabel, useGradient, host }),
    );
    const dim = dimCell(
      [link.fadedOpacity, link.strokeOpacity, node.fadedOpacity],
      () => ({ link: link.fadedOpacity ?? 0.1, node: node.fadedOpacity ?? 0.4, stroke: link.strokeOpacity ?? 0.5 }),
    );
    const renderTooltipBody = bodyCell([data, tooltip], () => sankeyTooltipBody(data, tooltip));
    // Entrance fades native motion cannot animate are the static rules in sankey.css, driven by these wrapper vars and sibling-index()
    // (stagger is Chromium-only, under `@supports`).
    const ease = toCssEase(enterTransition?.ease);
    const dur = Math.round(enterTransition?.duration === undefined ? animationDuration : enterTransition.duration * 1000);
    const nodeCount = Math.max(1, data.nodes.length);
    const hostStyle = hostStyleCell([dur, ease, nodeCount], (): StyleObject => {
      const entranceVars = { "--bkm-sankey-dur": `${dur}ms`, "--bkm-sankey-ease": ease, "--bkm-sankey-n": nodeCount };
      return { ...entranceVars, position: "relative", "user-select": "none", width: "100%" };
    });
    return {
      data,
      margin,
      animationDuration,
      enterTransition,
      nodeWidth,
      nodePadding,
      definition,
      renderTooltipBody,
      hostStyle,
      dim,
      entranceMs: dur,
      aspectRatio: parseAspectRatio(props.aspectRatio ?? DEFAULT_ASPECT_RATIO),
      ariaLabel: props.ariaLabel ?? DEFAULT_ARIA_LABEL,
      ariaDescription,
    };
  };
}
