import type { ChartStatus } from "../motion/phase";
import type { MarkChartLoadingProps } from "./mark-chart-loading";

/** One node of a network. */
export interface NetworkNode {
  /** Its identity: links name it as their `source` or `target`. */
  readonly id: string;
  /** Its name in labels and the tooltip. Defaults to the `id`. */
  readonly label?: string;
  /** Its group: nodes of a group share a colour (and a legend row, by the groups' first appearance). */
  readonly group?: string;
  /** Its size: the dot's area grows with it (with its link count when no node has a value). */
  readonly value?: number;
}

/** One link of a network, between two node ids. */
export interface NetworkLink {
  readonly source: string;
  readonly target: string;
  /** Its weight: a heavier link is drawn thicker and pulls its nodes closer. */
  readonly value?: number;
}

/** A network's nodes and links. */
export interface NetworkData {
  readonly nodes: readonly NetworkNode[];
  readonly links: readonly NetworkLink[];
}

/** What a `ChartTooltip`'s `content({ point })` receives for a network node. */
export interface NetworkPoint {
  readonly [key: string]: unknown;
  readonly id: string;
  readonly label: string;
  readonly group: string | null;
  readonly value: number | null;
  /** Its links, and the labels of the nodes they reach. */
  readonly degree: number;
  readonly neighbors: readonly string[];
  readonly color: string;
}

/** Props for `NetworkChart`: a force-directed graph. */
export interface NetworkChartProps {
  readonly data: NetworkData;
  /**
   * Drag a node to move it; the rest settle around where it is dropped, and it stays there.
   * @default true
   */
  readonly draggable?: boolean;
  /**
   * How far apart linked nodes settle, in px.
   * @default 46
   */
  readonly linkDistance?: number;
  /**
   * How hard nodes push each other apart.
   * @default 120
   */
  readonly repulsion?: number;
  /**
   * The smallest and largest dot radii, in px.
   * @default [4, 13]
   */
  readonly nodeSize?: readonly [number, number];
  /** Colours of the groups, in order of first appearance (cycled). Defaults to `--chart-1` … `--chart-5`. */
  readonly colors?: readonly string[];
  /** Formats a node's value in the tooltip. */
  readonly formatValue?: (value: number) => string;
  /**
   * The value's name in the tooltip.
   * @default "Value"
   */
  readonly valueLabel?: string;
  /** Called with the hovered node's group index (by first appearance), and `null` when the pointer leaves (pair it with a `ChartLegend`). */
  readonly onHoverChange?: (index: number | null) => void;
  /**
   * Width over height: a number or a string such as `"16 / 10"`.
   * @default "16 / 10"
   */
  readonly aspectRatio?: string | number;
  /** A fixed height in px instead of an aspect ratio. */
  readonly height?: number;
  /**
   * Play the entrance: the nodes pop in from the centre outward, then the links draw between them.
   * @default true
   */
  readonly animate?: boolean;
  /**
   * `"loading"` draws a shimmering skeleton (muted clusters of nodes and links) in place of the chart and ignores the pointer; switching to `"ready"` plays the
   * entrance. Switching back to `"loading"` fades the chart out first.
   * @default "ready"
   */
  readonly status?: ChartStatus;
  /** Text shown centered over the plot, with a shimmer, while `status` is `"loading"`. Nothing is shown when it is unset or empty. */
  readonly loadingLabel?: string;
  readonly ariaLabel?: string;
  readonly ariaDescription?: string;
}

/** Props for `NetworkLabels`: each node's name beside it. */
export interface NetworkLabelsProps {
  /**
   * Name only the nodes at least this large (their dot's radius, in px); `0` names every node.
   * @default 0
   */
  readonly minRadius?: number;
}

/** Props of `NetworkChartLoading`: a ready-made placeholder, `<NetworkChart status="loading" />` with no data. */
export interface NetworkChartLoadingProps extends MarkChartLoadingProps {}
