import type { EnterTransition } from "../motion/phase";
import type { ArcDatum, Focus, SunburstNode } from "../sunburst/arcs";

/** Props of `SunburstSegment`. */
export interface SunburstSegmentProps {
  /** Arc index to customize, from the `arcs` array returned by `buildArcs`. */
  index: number;
  /** Color override for this segment. */
  color?: string;
  /** Fill override: a color, or a pattern or gradient as `url(#id)` (a `PatternLines`… or `LinearGradient` child of the chart, ids scoped to it). Overrides `color`. */
  fill?: string;
  /** Fill opacity override (0 to 1).
   * @default 1 for the innermost visible ring, then fading with depth down to 0.45 */
  fillOpacity?: number;
}

/** Props of `SunburstCenter`. */
export interface SunburstCenterProps {
  /** Class name of the center hub's group. */
  className?: string;
}

/** Props of `SunburstLabels`. */
export interface SunburstLabelsProps {
  /**
   * Label font size in pixels.
   * @default 11
   */
  fontSize?: number;
  /**
   * Label text color.
   * @default "var(--chart-label)"
   */
  fill?: string;
  /**
   * Color of the halo behind the label text.
   * @default "var(--chart-background)"
   */
  stroke?: string;
  /**
   * Width in pixels of the halo behind the label text. Use `0` to disable it.
   * @default 2.5
   */
  strokeWidth?: number;
  /** Class name of the group that holds the labels. */
  className?: string;
}

/**
 * Enter animation override for `SunburstChart`: a tween, `duration` the length of the enter sweep in seconds (default 1.1) and `ease` its
 * curve (a cubic-bezier as 4 numbers, or an easing function; default the reveal curve, `[0.85, 0, 0.15, 1]`), or a spring
 * (`type: "spring"` with `stiffness`, `damping`, `mass`), run to rest.
 */
export type SunburstEnterTransition = Pick<EnterTransition, "type" | "duration" | "ease" | "stiffness" | "damping" | "mass">;

/** Props of `SunburstChart`. */
export interface SunburstChartProps<Node> {
  /** Hierarchical data tree. Parent values are summed from their children. */
  data: SunburstNode;
  /**
   * Chart diameter in pixels. The chart shrinks to fit narrower containers.
   * @default 520
   */
  size?: number;
  /**
   * Change this number to replay the enter animation.
   * @default 0
   */
  playKey?: number;
  /** Additional class name for the chart wrapper. */
  className?: string;
  /** Controlled drill-down focus: the id of the focused node (names from the root joined with `" / "`). Omit for uncontrolled drill-down. */
  focusId?: string;
  /** Called with the new node id when the focus changes through a segment click, the center hub, a keyboard zoom or a breadcrumb. */
  onFocusChange?: (focusId: string) => void;
  /** Controlled hover: the index of the hovered arc in the `arcs` array returned by `buildArcs`, or `null` for none. */
  hoveredIndex?: number | null;
  /** Called with the arc index (or `null`) when the hovered arc changes. */
  onHoverChange?: (index: number | null) => void;
  /**
   * How far in pixels the hovered segment grows outward.
   * @default 8
   */
  hoverPop?: number;
  /**
   * Inset in pixels reserved inside the chart for hover growth, relative to `size`.
   * @default derived from the tree depth, `size` and `hoverPop`
   */
  padding?: number;
  /**
   * Overrides the enter animation: a tween's `duration` (in seconds) and `ease` (a cubic-bezier as 4 numbers, or an easing function), or a spring.
   * @default { duration: 1.1, ease: [0.85, 0, 0.15, 1] }
   */
  enterTransition?: SunburstEnterTransition;
  /**
   * Scales the stagger between rings and segments during the enter animation.
   * @default 1
   */
  enterStaggerScale?: number;
  /**
   * Accessible label of the chart.
   * @default "Sunburst chart of " followed by the root's `name`
   */
  ariaLabel?: string;
  /**
   * Longer accessible description of the chart.
   * @default the keyboard instructions: arrow keys to inspect, Enter or Space to zoom in, Escape or the center disc to zoom out
   */
  ariaDescription?: string;
  /** `SunburstSegment`, `SunburstCenter`, `SunburstLabels`, `SunburstBreadcrumb` and `SunburstHint` children, and the patterns (`PatternLines`…) and gradients (`LinearGradient`, `RadialGradient`) a segment's `fill` references. Render one `SunburstSegment` per arc index to customize individual segments. */
  children: Node;
}

/** One crumb of the drill-down trail. */
export interface SunburstBreadcrumbItem {
  /** Node id to pass to `zoomTo`. */
  id: string;
  /** Display name of the node (the root uses the name of `data`). */
  label: string;
  /** `true` for the node currently focused, which is the last crumb. */
  isCurrent: boolean;
}

/** Props of `SunburstBreadcrumb`. */
export interface SunburstBreadcrumbProps<Node> {
  /** Class name of the wrapping `nav` element. */
  className?: string;
  /** Breadcrumb UI, usually built from `useSunburstBreadcrumbItems`. */
  children: Node;
}

/** State passed to a custom `SunburstHint` content function. */
export interface SunburstHintContext {
  /** The default hint text for the current state. */
  hintText: string;
  /** The hovered arc, or `null`. */
  hoveredArc: ArcDatum | null;
  /** The currently focused node. */
  focus: Focus;
}

/** Props of `SunburstHint`. */
export interface SunburstHintProps<Node> {
  /** Class name of the hint element. */
  className?: string;
  /** Custom hint content, or a function receiving the hint context. Defaults to the hovered path or zoom instructions. */
  children?: Node | ((context: SunburstHintContext) => Node);
}
