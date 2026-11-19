import type { ChartStatus } from "../motion/phase";
import type { MarkChartLoadingProps } from "./mark-chart-loading";

/** One node of a tree: its `children` hang below it; a `value` (a leaf's) sums up into its ancestors. */
export interface TreeNode {
  /** Its label and tooltip title. Unique among its siblings (its path is its identity). */
  readonly name: string;
  readonly value?: number;
  readonly children?: readonly TreeNode[];
  /** This node's colour, and its descendants'. A top-level branch's colour is otherwise the palette's, by position. */
  readonly color?: string;
}

/** What a `ChartTooltip`'s `content({ point })` receives for a tree node. */
export interface TreePoint {
  readonly [key: string]: unknown;
  readonly name: string;
  /** The names from the root to this node. */
  readonly path: readonly string[];
  readonly depth: number;
  /** Its value, its leaves' summed for a branch. */
  readonly value: number;
  /** Its direct children, and all its descendants. */
  readonly children: number;
  readonly descendants: number;
  /** Whether its children are folded away (click it to unfold). */
  readonly collapsed: boolean;
  readonly color: string;
}

/** Props for `TreeChart`. */
export interface TreeChartProps {
  /** The tree's root. */
  readonly data: TreeNode;
  /**
   * `"tidy"`: each node beside its siblings, as compact as the tree allows (TanStack's tidy tree). `"cluster"`: a dendrogram, every leaf
   * at the same depth.
   * @default "tidy"
   */
  readonly variant?: "tidy" | "cluster";
  /**
   * `"horizontal"`: the root on the left, growing right. `"vertical"`: the root on top. `"radial"`: the root in the centre, growing out.
   * @default "horizontal"
   */
  readonly layout?: "horizontal" | "vertical" | "radial";
  /**
   * Click (or Enter on) a branch to fold its children away, again to unfold them.
   * @default true
   */
  readonly collapsible?: boolean;
  /** The paths (names joined with `/`, from the root's children: `"Engineering/Platform"`) folded at first. */
  readonly defaultCollapsed?: readonly string[];
  /**
   * Radius of a node's dot, in px.
   * @default 4.5
   */
  readonly nodeSize?: number;
  /** Colours of the top-level branches, in order (cycled). Defaults to `--chart-1` … `--chart-5`. */
  readonly colors?: readonly string[];
  /** Formats a value in the tooltip. */
  readonly formatValue?: (value: number) => string;
  /**
   * The value's name in the tooltip.
   * @default "Value"
   */
  readonly valueLabel?: string;
  /**
   * Width over height: a number or a string such as `"16 / 9"`.
   * @default "16 / 9" (`"1 / 1"` radial)
   */
  readonly aspectRatio?: string | number;
  /** A fixed height in px instead of an aspect ratio. */
  readonly height?: number;
  /**
   * Play the entrance: the links draw out from the root and the nodes pop in, depth by depth.
   * @default true
   */
  readonly animate?: boolean;
  /**
   * `"loading"` draws a shimmering skeleton (muted nodes and links) in place of the chart and ignores the pointer; switching to `"ready"` plays the
   * entrance. Switching back to `"loading"` fades the chart out first.
   * @default "ready"
   */
  readonly status?: ChartStatus;
  /** Text shown centered over the plot, with a shimmer, while `status` is `"loading"`. Nothing is shown when it is unset or empty. */
  readonly loadingLabel?: string;
  readonly ariaLabel?: string;
  readonly ariaDescription?: string;
}

/** Props for `TreeLabels`: each node's name beside it. */
export interface TreeLabelsProps {
  /**
   * Show the leaves' values after their names.
   * @default false
   */
  readonly showValues?: boolean;
}

/** Props of `TreeChartLoading`: a ready-made placeholder, `<TreeChart status="loading" />` with no data. */
export interface TreeChartLoadingProps extends MarkChartLoadingProps, Pick<TreeChartProps, "layout"> {}
