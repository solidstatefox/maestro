import type { RadarData, RadarMetric } from "../radar/rows";
import type { RadarEnterTransition } from "../radar/transition";

export interface RadarHoverContextValue {
  /** Index of the hovered series, or `null` when nothing is hovered. */
  hoveredIndex: number | null;
  /** Sets the hovered series; pass `null` to clear hover. */
  setHoveredIndex: (index: number | null) => void;
}

export interface RadarStableContextValue {
  /** The `data` passed to the chart. */
  data: RadarData[];
  /** The `metrics` passed to the chart. */
  metrics: RadarMetric[];
  /** Chart width and height in pixels, or `0` when the chart fills its parent. */
  size: number;
  /** Radius of the outermost grid ring in pixels, or `0` when the chart fills its parent. */
  radius: number;
  /** Number of grid rings. */
  levels: number;
  /** Whether the entrance animation is on. */
  animate: boolean;
  /** Entrance time budget in milliseconds. */
  enterDurationMs: number;
  /** The entrance stagger multiplier. */
  staggerScale: number;
  /** Kept for bklit-ui compatibility; not populated. */
  enterTransition?: unknown;
  /** The key that replays the entrance. */
  motionReplayKey: string;
  /** Returns the colour of the series at the given index: its `color`, or the palette colour. */
  getColor: (index: number) => string;
  /**
   * Returns the angle in radians of the spoke at the given metric index, measured from 3 o'clock, with the first metric at 12 o'clock.
   */
  getAngle: (metricIndex: number) => number;
  /**
   * Returns the `{ x, y }` offset from the centre, in pixels, of a value on the spoke of the given metric index.
   */
  getPointPosition: (metricIndex: number, value: number) => { x: number; y: number };
  /** Converts a value from 0 to 100 into a distance from the centre in pixels. */
  yScale: (value: number) => number;
}

/**
 * Everything `useRadar` returns: the chart geometry, data and helpers, plus the hovered series index and a setter for it.
 */
export type RadarContextValue = RadarStableContextValue & RadarHoverContextValue;

/** Props for `RadarChart`. */
export interface RadarChartProps<Node, Style> {
  /**
   * The series to draw, one polygon each. Every item holds a `values` record keyed by metric `key`; the series index is what `RadarArea` refers to with `index`.
   */
  readonly data: RadarData[];
  /**
   * The metrics, one spoke each, in clockwise order from 12 o'clock. A metric's `key` selects its value in every series' `values`, and its `label` is what `RadarLabels` prints.
   */
  readonly metrics: RadarMetric[];
  /** Chart width and height in pixels. Omit to fill the width of the parent element; the chart stays square. */
  readonly size?: number;
  /**
   * Number of concentric grid rings drawn by `RadarGrid`. Ring `n` marks `n / levels` of the 0 to 100 value scale.
   * @default 5
   */
  readonly levels?: number;
  /**
   * Space in pixels kept free around the chart for the metric labels.
   * @default 60
   */
  readonly margin?: number;
  /**
   * Play the entrance animation. Set `false` to draw the chart immediately.
   * @default true
   */
  readonly animate?: boolean;
  /**
   * Total time budget of the entrance animation in milliseconds. Grid, labels and series timings scale with it.
   * @default 1100
   */
  readonly enterDurationMs?: number;
  /**
   * Multiplier for the delays between grid rings, labels and series during the entrance. `0` starts everything together.
   * @default 1
   */
  readonly staggerScale?: number;
  /**
   * Transition for the series entrance, in the shape used by the `motion` library (`type: "spring"` with spring values, or a tween with `duration` in seconds and `ease`). Defaults to a 1.1 second tween on the shared reveal curve.
   */
  readonly enterTransition?: RadarEnterTransition;
  /**
   * Changing this string replays the entrance animation.
   * @default ""
   */
  readonly motionReplayKey?: string;
  /**
   * Index of the hovered series, for controlled hover. Pass `null` for no hover; leave it `undefined` to let the chart manage hover itself.
   */
  readonly hoveredIndex?: number | null;
  /** Called with the index of the hovered or keyboard-focused series, or `null` when hover ends. */
  readonly onHoverChange?: (index: number | null) => void;
  /** Extra class name for the chart container. */
  readonly className?: string;
  /** Inline styles for the chart container, merged over the default sizing. */
  readonly style?: Style;
  /**
   * The parts to draw: `RadarGrid`, `RadarAxis`, `RadarLabels` and one `RadarArea` per series. Only the parts you include are drawn.
   */
  readonly children: Node;
  /**
   * Accessible name of the chart.
   * @default "Radar chart"
   */
  readonly ariaLabel?: string;
  /** Longer accessible description of the chart. */
  readonly ariaDescription?: string;
}
