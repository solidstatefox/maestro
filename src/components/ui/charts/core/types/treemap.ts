import type { ChartStatus } from "../motion/phase";
import type { MarkChartLoadingProps } from "./mark-chart-loading";

/** One node of a treemap's hierarchy: a leaf has a `value`, a branch has `children` (its value is theirs, summed). */
export interface TreemapNode {
  /** The node's name: its label, its tooltip title and its place in the path (`Product/Enterprise`). Unique among its siblings. */
  readonly name: string;
  /** A leaf's size. Ignored on a branch. */
  readonly value?: number;
  readonly children?: readonly TreemapNode[];
  /** This node's colour, and its descendants' (a top-level branch's colour is otherwise the palette's, by position). */
  readonly color?: string;
}

/** What a `ChartTooltip`'s `content({ point })` receives for a treemap cell. */
export interface TreemapPoint {
  readonly [key: string]: unknown;
  readonly name: string;
  /** The names from the root to this node. */
  readonly path: readonly string[];
  /** Its top-level branch's name (its own at the top level). */
  readonly group: string;
  readonly value: number;
  /** Its share of the shown root, 0 to 1. */
  readonly share: number;
  readonly color: string;
  readonly depth: number;
  /** Whether it has children (a cell that drills in). */
  readonly branch: boolean;
}

/** Props for `TreemapChart`. */
export interface TreemapChartProps {
  /** The hierarchy's root; its children are the top-level branches. */
  readonly data: TreemapNode;
  /**
   * Width over height: a number or a string such as `"16 / 9"`.
   * @default "16 / 9"
   */
  readonly aspectRatio?: string | number;
  /** A fixed height in px instead of an aspect ratio. */
  readonly height?: number;
  /**
   * How many levels below the shown root are drawn; deeper ones fold into their ancestor's cell (drill in to see them).
   * @default 2
   */
  readonly depth?: number;
  /**
   * Gap between cells, in px.
   * @default 3
   */
  readonly gap?: number;
  /**
   * Corner radius of the cells, in px.
   * @default 6
   */
  readonly radius?: number;
  /**
   * The tiling: `"squarify"` keeps cells near square, `"binary"` balances them, `"slice-dice"` alternates rows and columns by depth.
   * @default "squarify"
   */
  readonly tile?: "squarify" | "binary" | "slice-dice";
  /** Colours of the top-level branches, in order (cycled). Defaults to `--chart-1` … `--chart-5`. */
  readonly colors?: readonly string[];
  /**
   * Click (or Enter on) a branch to zoom into it; the breadcrumb at the top zooms back out.
   * @default true
   */
  readonly drillDown?: boolean;
  /** Formats a value in labels and the tooltip. */
  readonly formatValue?: (value: number) => string;
  /**
   * The value's name in the tooltip.
   * @default "Value"
   */
  readonly valueLabel?: string;
  /**
   * Play the entrance.
   * @default true
   */
  readonly animate?: boolean;
  /**
   * `"loading"` draws a shimmering skeleton (muted tiles) in place of the chart and ignores the pointer; switching to `"ready"` plays the
   * entrance. Switching back to `"loading"` fades the chart out first.
   * @default "ready"
   */
  readonly status?: ChartStatus;
  /** Text shown centered over the plot, with a shimmer, while `status` is `"loading"`. Nothing is shown when it is unset or empty. */
  readonly loadingLabel?: string;
  /** Called with the shown root's path when a drill-down changes it (`[]` at the top). */
  readonly onDrillChange?: (path: readonly string[]) => void;
  readonly ariaLabel?: string;
  readonly ariaDescription?: string;
}

/** Props for `TreemapLabels`: names (and values) inside the cells and on the branches' headers. */
export interface TreemapLabelsProps {
  /**
   * Show each cell's value under its name.
   * @default true
   */
  readonly showValues?: boolean;
  /**
   * Name each branch in a header strip above its cells.
   * @default true
   */
  readonly showHeaders?: boolean;
  /**
   * Hide a label narrower than this many px of room.
   * @default 36
   */
  readonly minWidth?: number;
}

/** Props of `TreemapChartLoading`: a ready-made placeholder, `<TreemapChart status="loading" />` with no data. */
export interface TreemapChartLoadingProps extends MarkChartLoadingProps {}
