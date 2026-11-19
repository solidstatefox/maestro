import type { CurveFactory } from "d3-shape";
import type { EnterTransition, LineLoadingPulseMode } from "../motion/phase";

/** Props of `BarLoadingSkeleton`. */
export interface BarLoadingSkeletonProps {
  /** Plot width in px. */
  innerWidth: number;
  /** Plot height in px. */
  innerHeight: number;
  /**
   * Number of placeholder bars.
   * @default 12
   */
  barCount?: number;
  /**
   * Bar fill color.
   * @default "var(--bkm-foreground)"
   */
  fill?: string;
  /**
   * Bar fill opacity.
   * @default 0.45
   */
  fillOpacity?: number;
  /**
   * Whether bars rise from the bottom (`"bottom"`) or diverge from the vertical center (`"center"`).
   * @default "bottom"
   */
  baseline?: "bottom" | "center";
  /**
   * Bar width as a fraction of its slot, from 0 to 1.
   * @default 0.7
   */
  barFraction?: number;
  /**
   * Length of one shimmer sweep in seconds.
   * @default 2
   */
  durationSeconds?: number;
}

/** Props of `LineLoadingSweep`. */
export interface LineLoadingSweepProps {
  /** d3 curve factory for the silhouette, so it matches the chart's interpolation. */
  curve: CurveFactory;
  /**
   * Also fill the silhouette as an area.
   * @default false
   */
  withArea?: boolean;
  /**
   * `"loop"` repeats, `"exit"` fades out as loading finishes, `"enter"` fades in when the chart returns to loading.
   * @default "loop"
   */
  mode?: "loop" | "exit" | "enter";
  /** Called when an `"exit"` or `"enter"` transition finishes. */
  onTransitionComplete?: () => void;
  /**
   * Line color.
   * @default "var(--chart-foreground)"
   */
  stroke?: string;
  /**
   * Line opacity.
   * @default 0.55
   */
  strokeOpacity?: number;
  /**
   * Line width in px.
   * @default 2
   */
  strokeWidth?: number;
  /**
   * Number of points in the silhouette.
   * @default 14
   */
  pointCount?: number;
  /**
   * Length of one shimmer sweep in seconds.
   * @default 2
   */
  durationSeconds?: number;
  /** Plot width in px. Only needed outside a chart; inside one it is the chart's plot width. */
  innerWidth?: number;
  /** Plot height in px. Only needed outside a chart; inside one it is the chart's plot height. */
  innerHeight?: number;
}

/** Props of `LineLoadingPulseStroke`. */
export interface LineLoadingPulseStrokeProps {
  /** SVG path data of the line to animate. */
  pathD: string;
  /**
   * `"loop"` repeats, `"exit"` plays the loading-to-ready half cycle, `"enter"` the ready-to-loading half cycle.
   * @default "loop"
   */
  mode?: LineLoadingPulseMode;
  /**
   * Change this number to restart the loop without remounting the stroke.
   * @default 0
   */
  loopEpoch?: number;
  /**
   * Line color.
   * @default "var(--chart-foreground)"
   */
  stroke?: string;
  /**
   * Opacity of the animated segment.
   * @default 0.5
   */
  strokeOpacity?: number;
  /**
   * Line width in px.
   * @default 2.5
   */
  strokeWidth?: number;
  /** Called when an `"exit"` or `"enter"` cycle finishes. */
  onCycleComplete?: () => void;
  /** Plot width in px. Only needed outside a chart; inside one it is the chart's plot width. */
  innerWidth?: number;
}

type ChartRevealClipMode = "reveal" | "conceal";

/** Props of `ChartRevealClip`. */
export interface ChartRevealClipProps {
  /** Id of the clip path. */
  clipPathId: string;
  /** Height of the clipped area in px. */
  height: number;
  /** Width the clip grows to, in px. */
  targetWidth: number;
  /** Timing of the reveal (duration and easing). A spring is replaced by the default tween. */
  enterTransition?: EnterTransition;
  /** Change this number to replay the reveal. */
  revealEpoch: number;
  /**
   * Extra space in px around the clip rectangle so edge glyphs are not cut off.
   * @default 0
   */
  padding?: number;
  /**
   * Animate the reveal. When false the clip stays at full width.
   * @default true
   */
  animating?: boolean;
  /**
   * `"reveal"` grows the clip from empty to full, `"conceal"` shrinks it from full to empty.
   * @default "reveal"
   */
  mode?: ChartRevealClipMode;
  /** Called when a `"conceal"` animation finishes. */
  onComplete?: () => void;
}

/** Props of `ChartLoadingLabel`. */
export interface ChartLoadingLabelProps {
  /**
   * Label shown centered over the chart.
   * @default "Loading"
   */
  text?: string;
  /** Class names added to the label. */
  className?: string;
  /**
   * Animate the label down, fade it and blur it away as loading finishes.
   * @default false
   */
  exiting?: boolean;
}
