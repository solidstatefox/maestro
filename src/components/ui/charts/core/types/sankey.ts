import type { LabelOrientation } from "../sankey/marks";
import type { Margin, SankeyData, SankeyLinkDatum, SankeyNodeDatum, SankeyPropLink, SankeyPropNode } from "../sankey/types";
import type { Transition } from "../motion/phase";
import type { SankeyGraph, SankeyLink, SankeyNode } from "d3-sankey";

/** Label direction: `"horizontal"` places labels left or right of the nodes, `"vertical"` rotates them 90 degrees along the node edge. */
export type SankeyLabelOrientation = LabelOrientation;

// Config carrier: read once by SankeyChart, never rendered.
/** Props of `SankeyNode`. */
export interface SankeyNodeProps {
  /**
   * Fill color of the nodes.
   * @default the theme chart colors, by node
   */
  readonly fill?: string;
  /**
   * Corner radius of the nodes in pixels.
   * @default 4
   */
  readonly lineCap?: number;
  /**
   * Opacity of nodes not connected to the hovered node or link.
   * @default 0.4
   */
  readonly fadedOpacity?: number;
  /**
   * Show node names.
   * @default true
   */
  readonly showLabels?: boolean;
  /**
   * Show node values under the names.
   * @default true
   */
  readonly showValueLabels?: boolean;
  /**
   * Formats the value shown under a node's name. A node's value is the larger of its inflow and outflow.
   * @default the value as an integer followed by " sessions"
   */
  readonly formatValue?: (value: number) => string;
  /**
   * Reading direction of the labels outside the nodes.
   * @default "horizontal"
   */
  readonly labelOrientation?: SankeyLabelOrientation;
  /** Returns the color of a node. Overrides `fill`. */
  readonly getNodeColor?: (node: SankeyPropNode, index: number) => string;
}

// Config carrier: read once by SankeyChart, never rendered.
/** Props of `SankeyLink`. */
export interface SankeyLinkProps<Node> {
  /** Solid color for all links. Overrides the gradient. */
  stroke?: string;
  /**
   * Opacity of the links.
   * @default 0.5
   */
  readonly strokeOpacity?: number;
  /**
   * Opacity of links not connected to the hovered node or link.
   * @default 0.1
   */
  readonly fadedOpacity?: number;
  /**
   * Paint each link with a gradient from its source color to its target color.
   * @default true
   */
  readonly useGradient?: boolean;
  /** Returns the color of a node, used for the gradient ends. */
  readonly getNodeColor?: (node: SankeyPropNode, index: number) => string;
  /** Returns a solid color per link. Overrides the gradient. */
  readonly getLinkColor?: (link: SankeyPropLink, index: number) => string;
  /** Pattern definitions (SVG `<pattern>` elements) that links can reference by id through `getLinkPattern`. */
  readonly patterns?: Node;
  /** Returns the id of a pattern to fill a link with, or `null`/`undefined` to use the gradient or solid color. A pattern wins over `stroke` and `getLinkColor`. */
  readonly getLinkPattern?: (link: SankeyPropLink, index: number) => string | null | undefined;
}

/** A tooltip panel style a framework writes: an object of CSS properties (camelCase or kebab-case), or a style string. */
export type SankeyPanelStyle = Readonly<Record<string, string | number | undefined>> | string;

// Config carrier: read once by SankeyChart, never rendered.
/** Props of `SankeyTooltip`. */
export interface SankeyTooltipProps<Node, Style = SankeyPanelStyle> {
  /** Custom tooltip content for a node. Receives the node and its index. */
  readonly nodeContent?: (props: { node: SankeyPropNode; index: number }) => Node;
  /** Custom tooltip content for a link. Receives the link and its index. */
  readonly linkContent?: (props: { link: SankeyPropLink; index: number }) => Node;
  /**
   * Formats the values in the default tooltip.
   * @default integer formatting
   */
  readonly formatValue?: (value: number) => string;
  /**
   * Label of the value row in the default node tooltip.
   * @default "Sessions"
   */
  readonly valueLabel?: string;
  /** Additional class name for the tooltip. */
  readonly className?: string;
  /** Inline styles merged onto the tooltip panel, for example a background or a backdrop blur. A number is in pixels where CSS needs a unit. */
  readonly panelStyle?: Style;
  /**
   * Fade the panel out when the hover ends (over the hover profile); `false` hides it at once.
   * @default true
   */
  readonly exit?: boolean;
}

/** Props of `SankeyChart`. */
export interface SankeyChartProps<Node> {
  /** Nodes and links to draw. Links reference nodes by index; links with a non-positive or non-finite value are ignored, and the chart is empty when no positive link remains. */
  readonly data: SankeyData;
  /**
   * Chart margins in pixels. Any side you omit keeps its default; the wide left and right defaults leave room for node labels.
   * @default { top: 40, right: 180, bottom: 40, left: 180 }
   */
  readonly margin?: Partial<Margin>;
  /**
   * Duration of the enter animation in milliseconds.
   * @default 1100
   */
  readonly animationDuration?: number;
  /**
   * Enter transition (a spring or a cubic-bezier tween), in seconds. Overrides `animationDuration` when it sets a `duration`.
   * @default a 1.1s tween on the reveal curve
   */
  readonly enterTransition?: Transition;
  /**
   * Changing this value replays the enter animation.
   * @default ""
   */
  readonly revealSignature?: string;
  /**
   * Aspect ratio of the chart as "width / height".
   * @default "2 / 1"
   */
  readonly aspectRatio?: string;
  /**
   * Width of the node bars in pixels.
   * @default 16
   */
  readonly nodeWidth?: number;
  /**
   * Vertical gap between nodes of the same column in pixels.
   * @default 24
   */
  readonly nodePadding?: number;
  /** Additional class name for the chart container. */
  readonly className?: string;
  /** `SankeyNode`, `SankeyLink` and `SankeyTooltip` to configure the chart, plus any elements that call `useSankey()`. */
  readonly children?: Node;
  /** Controlled hovered node index, for example from a legend. Overrides hover from the chart surface; `null` clears it. */
  readonly hoveredNodeIndex?: number | null;
  /** Called with the hovered node index (or `null`) when hover changes on the chart surface. */
  readonly onNodeHoverChange?: (index: number | null) => void;
  /**
   * Accessible label of the chart.
   * @default "Sankey chart"
   */
  readonly ariaLabel?: string;
  /** Longer accessible description of the chart. */
  readonly ariaDescription?: string;
}

/** Focused node or link, as exposed by `useSankey()`. */
export interface SankeyTooltipData {
  /** Whether a node or a link is focused. */
  type: "node" | "link";
  /** Index of the focused node (when `type` is "node"). */
  nodeIndex?: number;
  /** Index of the focused link (when `type` is "link"). */
  linkIndex?: number;
  /** Horizontal position of the focused item, relative to the chart. */
  x: number;
  /** Vertical position of the focused item, relative to the chart. */
  y: number;
  /** The focused node or link, as laid out by d3-sankey. */
  data: SankeyNodeDatum | SankeyLinkDatum | SankeyLink<SankeyNodeDatum, SankeyLinkDatum>;
}

/** Value returned by `useSankey()`. */
export interface SankeyContextValue<ContainerRef, SetTooltipData> {
  /** The d3-sankey graph for the current size. */
  graph: SankeyGraph<SankeyNodeDatum, SankeyLinkDatum>;
  /** Laid-out nodes. */
  nodes: SankeyNode<SankeyNodeDatum, SankeyLinkDatum>[];
  /** Laid-out links. */
  links: SankeyLink<SankeyNodeDatum, SankeyLinkDatum>[];
  /** Chart width in pixels. */
  width: number;
  /** Chart height in pixels. */
  height: number;
  /** Width inside the margins. */
  innerWidth: number;
  /** Height inside the margins. */
  innerHeight: number;
  /** Resolved chart margins. */
  margin: Margin;
  /** Hovered node index, or `null`. */
  hoveredNodeIndex: number | null;
  /** Hovered link index, or `null`. */
  hoveredLinkIndex: number | null;
  /** Moves the native focus to a node; `null` clears it. */
  setHoveredNodeIndex: (index: number | null) => void;
  /** Moves the native focus to a flow; `null` clears it. */
  setHoveredLinkIndex: (index: number | null) => void;
  /** The focused node or link with its anchor position, or `null`. */
  tooltipData: SankeyTooltipData | null;
  /** Focuses the node or flow `value` names (`null` clears); an updater function sees `null`. */
  setTooltipData: SetTooltipData;
  /** Ref to the chart container element. */
  containerRef: ContainerRef;
  /** `true` once the enter animation has finished. */
  isLoaded: boolean;
  /** Enter animation duration in milliseconds. */
  animationDuration: number;
  /** The `enterTransition` prop of the chart, if set. */
  enterTransition?: Transition;
  /** Increments when the entrance replays (a new `revealSignature`). */
  revealEpoch: number;
  /** Not tracked: the native tooltip follows the pointer itself, so this is always null. */
  mousePos: { x: number; y: number } | null;
  /** Returns the SVG path of a link, for custom link rendering. */
  createPath: (link: SankeyLink<SankeyNodeDatum, SankeyLinkDatum>) => string;
}
