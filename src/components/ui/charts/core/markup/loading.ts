import { area as d3Area, line as d3Line } from "d3-shape";
import { isNumber, isString } from "../guards";
import { REVEAL_CSS_EASE } from "../motion/easing";
import { DEFAULT_ANIMATION_DURATION_MS } from "../motion/phase";
import type { EnterTransition, LineLoadingPulseMode } from "../motion/phase";
import type { BarLoadingSkeletonProps, ChartRevealClipProps, LineLoadingPulseStrokeProps, LineLoadingSweepProps } from "../types/loading";
import { el } from "./node";
import type { MarkupChild, MarkupNode, MarkupTree } from "./node";

/** One shimmer sweep, in seconds. */
const DEFAULT_SWEEP_DURATION_S = 2;
const SWEEP_ANGLE_DEG = 25;
const HEIGHT_MIN_PCT = 20;
const HEIGHT_MAX_PCT = 80;

// Heights come from a deterministic hash of (index, seed), never Math.random(), so server and client renders agree.
const hashFract = (n: number): number => {
  const x = Math.sin(n) * 43_758.5453;
  return x - Math.floor(x);
};

/**
 * Deterministic heights (percentages of the available height) for a seed.
 * @internal
 */
export const getSkeletonHeights = (count: number, seed = 0, min = HEIGHT_MIN_PCT, max = HEIGHT_MAX_PCT): number[] =>
  Array.from({ length: count }, (_unused, i) => min + Math.floor(hashFract((i + 1) * 12.9898 + seed) * (max - min)));

/** Bell-curve opacity stops (sin squared) for the band's soft edges. */
const BAND_STOPS = /* @__PURE__ */ Array.from({ length: 17 }, (_unused, i) => {
  const t = i / 16;
  return {
    offset: `${(t * 100).toFixed(0)}%`,
    opacity: Number((0.05 + Math.sin(t * Math.PI) ** 2 * 0.85).toFixed(3)),
  };
});

/** What a sweep's framework keeps: the id its defs are scoped by, the re-roll count and the reader's reduced-motion preference. */
export interface SweepState {
  readonly chartId: string;
  /** Re-rolls so far: the skeleton's seed. */
  readonly tick: number;
  readonly reduceMotion: boolean;
  /** Called once per pass, when the band is off-screen: the framework bumps `tick`. */
  readonly onSweepComplete: () => void;
}

interface SweepMaskArgs {
  readonly chartId: string;
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number;
  readonly onSweepComplete: () => void;
}

// The band's gradient and the mask it travels in, for the caller's <defs>; it re-rolls once per pass, when the band is off-screen.
const sweepMask = ({ chartId, width, height, durationSeconds, onSweepComplete }: SweepMaskArgs): MarkupChild[] => [
  el(
    "linearGradient",
    { id: `${chartId}-grad`, x1: "0", x2: "1", y1: "0", y2: "0" },
    BAND_STOPS.map(({ offset, opacity }) => el("stop", { offset, "stop-color": "white", "stop-opacity": opacity }, [], { key: offset })),
  ),
  el("mask", { id: `${chartId}-mask`, maskUnits: "userSpaceOnUse" }, [
    // Oversized rect so the rotated band still covers the plot corners.
    el("g", { transform: `rotate(${SWEEP_ANGLE_DEG} ${width / 2} ${height / 2})` }, [
      el("rect", { fill: `url(#${chartId}-grad)`, height: height * 3, width, x: 0, y: -height }, [], {
        style: { "--bkm-sweep-w": `${width}px`, animation: `bkm-sweep-travel ${durationSeconds}s linear infinite` },
        styleBefore: "width",
        on: { animationiteration: onSweepComplete },
      }),
    ]),
  ]),
];

const BAR_CORNER_RADIUS = 2;
const DEFAULT_BAR_COUNT = 12;
const DEFAULT_BAR_FILL = "var(--bkm-foreground)";
const DEFAULT_BAR_FILL_OPACITY = 0.45;
const DEFAULT_BAR_FRACTION = 0.7;

const skeletonSigns = (count: number, seed: number): number[] =>
  Array.from({ length: count }, (_unused, i) => (hashFract((i + 1) * 78.233 + seed) < 0.5 ? -1 : 1));

/** `BarLoadingSkeleton`: seeded bars under the sweep (bars alone with reduced motion); nothing until the plot has a size. */
export const barSkeletonTree = (
  {
    innerWidth,
    innerHeight,
    barCount = DEFAULT_BAR_COUNT,
    fill = DEFAULT_BAR_FILL,
    fillOpacity = DEFAULT_BAR_FILL_OPACITY,
    baseline = "bottom",
    barFraction = DEFAULT_BAR_FRACTION,
    durationSeconds = DEFAULT_SWEEP_DURATION_S,
  }: Readonly<BarLoadingSkeletonProps>,
  { chartId, tick, reduceMotion, onSweepComplete }: SweepState,
): MarkupTree => {
  if (innerWidth <= 0 || innerHeight <= 0) {
    return null;
  }
  const heights = getSkeletonHeights(barCount, tick);
  const signs = skeletonSigns(barCount, tick);
  const bandWidth = innerWidth / heights.length;
  const barW = bandWidth * barFraction;
  const xOffset = (bandWidth * (1 - barFraction)) / 2;
  const isCenter = baseline === "center";
  const baselineY = isCenter ? innerHeight / 2 : innerHeight;
  const halfBarH = isCenter ? innerHeight / 2 : innerHeight;
  const bars = heights.map((value, i) => {
    const sign = isCenter ? (signs[i] ?? 1) : 1;
    const barH = Math.max(1, halfBarH * (value / 100));
    const x = i * bandWidth + xOffset;
    return el("rect", { fill, "fill-opacity": fillOpacity, height: barH, rx: BAR_CORNER_RADIUS, width: barW, x, y: sign === 1 ? baselineY - barH : baselineY }, [], { key: `${x.toFixed(2)}-${value}` });
  });
  if (reduceMotion) {
    return el("g", {}, bars);
  }
  return [
    el("defs", {}, sweepMask({ chartId, durationSeconds, height: innerHeight, onSweepComplete, width: innerWidth })),
    el("g", { mask: `url(#${chartId}-mask)` }, bars),
  ];
};

const DEFAULT_POINT_COUNT = 14;
const LINE_STROKE_OPACITY = 0.55;
const AREA_FILL_TOP_OPACITY = 0.18;
const AREA_FILL_BOTTOM_OPACITY = 0.02;
/** bklit line-loading-timing.ts LOADING_LABEL_EXIT_S / LINE_LOADING_PULSE_EASE. */
const transitionAnimation = (mode: "exit" | "enter"): string => `bkm-sweep-fade-${mode} 0.45s cubic-bezier(0.85, 0, 0.15, 1) forwards`;

/** `LineLoadingSweep`'s plot size: its props', else the chart's plot (React reads the chart from context). */
interface SweepSize {
  readonly innerWidth: number;
  readonly innerHeight: number;
}

/** The silhouette's line and area paths, or null before the plot has a size or with fewer than two points. */
const sweepPaths = (heights: readonly number[], { innerWidth, innerHeight }: SweepSize, curve: LineLoadingSweepProps["curve"]): { readonly line: string; readonly area: string } | null => {
  if (innerWidth <= 0 || innerHeight <= 0 || heights.length < 2) {
    return null;
  }
  const x = (index: number): number => (index / (heights.length - 1)) * innerWidth;
  const y = (value: number): number => innerHeight - (value / 100) * innerHeight;
  const points = heights.map((value, index) => ({ index, value }));
  return {
    line:
      d3Line<{ index: number; value: number }>()
        .curve(curve)
        .x((d) => x(d.index))
        .y((d) => y(d.value))(points) ?? "",
    area:
      d3Area<{ index: number; value: number }>()
        .curve(curve)
        .x((d) => x(d.index))
        .y0(innerHeight)
        .y1((d) => y(d.value))(points) ?? "",
  };
};

/**
 * `LineLoadingSweep`: a seeded line (and area) silhouette under the sweep; an `"exit"` / `"enter"` transition fades it as one piece (the
 * framework re-rolls only while looping). With reduced motion the silhouette alone: the framework hands off at once, with no fade to wait for.
 */
export const lineSweepTree = (
  {
    curve,
    withArea = false,
    mode = "loop",
    onTransitionComplete,
    stroke = "var(--chart-foreground)",
    strokeOpacity = LINE_STROKE_OPACITY,
    strokeWidth = 2,
    pointCount = DEFAULT_POINT_COUNT,
    durationSeconds = DEFAULT_SWEEP_DURATION_S,
  }: Readonly<LineLoadingSweepProps>,
  size: SweepSize,
  { chartId, tick, reduceMotion, onSweepComplete }: SweepState,
): MarkupTree => {
  const pathD = sweepPaths(getSkeletonHeights(pointCount, tick), size, curve);
  if (!pathD) {
    return null;
  }
  const silhouette = [
    withArea ? el("path", { d: pathD.area, fill: `url(#${chartId}-area)` }) : null,
    el("path", { d: pathD.line, fill: "none", stroke, "stroke-linecap": "round", "stroke-opacity": strokeOpacity, "stroke-width": strokeWidth }),
  ];
  const areaGradient = withArea
    ? el("linearGradient", { id: `${chartId}-area`, x1: "0", x2: "0", y1: "0", y2: "1" }, [
        el("stop", { offset: "0%", "stop-color": stroke, "stop-opacity": AREA_FILL_TOP_OPACITY }),
        el("stop", { offset: "100%", "stop-color": stroke, "stop-opacity": AREA_FILL_BOTTOM_OPACITY }),
      ])
    : null;
  if (reduceMotion) {
    return [areaGradient ? el("defs", {}, [areaGradient]) : null, ...silhouette];
  }
  return [
    el("defs", {}, [areaGradient, ...sweepMask({ chartId, durationSeconds, height: size.innerHeight, onSweepComplete, width: size.innerWidth })]),
    el("g", { mask: `url(#${chartId}-mask)` }, silhouette, mode === "loop" ? {} : { style: { animation: transitionAnimation(mode) }, on: { animationend: onTransitionComplete } }),
  ];
};

// bklit line-loading-timing.ts: 2.2s cycle + 280ms loop pause = 2.48s; enter/exit are one 1.1s half cycle.
const PULSE_ANIMATION: Readonly<Record<LineLoadingPulseMode, string>> = {
  loop: "bkm-loading-pulse 2.48s linear infinite",
  enter: `bkm-loading-enter 1.1s ${REVEAL_CSS_EASE} forwards`,
  exit: `bkm-loading-exit 1.1s ${REVEAL_CSS_EASE} forwards`,
};
const FADE_STOPS = [
  { offset: "0%", opacity: 0 },
  { offset: "15%", opacity: 1 },
  { offset: "85%", opacity: 1 },
  { offset: "100%", opacity: 0 },
] as const;

/**
 * `LineLoadingPulseStroke`: the stroke grows in from the left, then exits to the right, as a CSS clip-path keyframe on the path (chart-attached
 * series use the same keyframes via loading-css.ts). A new `loopEpoch` remounts the path, restarting it. Nothing until the plot has a width.
 */
export const pulseStrokeTree = (
  { pathD, mode = "loop", loopEpoch = 0, stroke = "var(--chart-foreground)", strokeOpacity = 0.5, strokeWidth = 2.5, onCycleComplete }: Readonly<LineLoadingPulseStrokeProps>,
  innerWidth: number,
  gradientId: string,
): MarkupTree => {
  if (innerWidth <= 0) {
    return null;
  }
  return [
    el("defs", {}, [
      el(
        "linearGradient",
        { id: gradientId, gradientUnits: "userSpaceOnUse", x1: 0, x2: innerWidth, y1: 0, y2: 0 },
        FADE_STOPS.map((stop) => el("stop", { offset: stop.offset, "stop-color": stroke, "stop-opacity": stop.opacity }, [], { key: stop.offset })),
      ),
    ]),
    el("path", { d: pathD, fill: "none", opacity: strokeOpacity, stroke: `url(#${gradientId})`, "stroke-linecap": "round", "stroke-width": strokeWidth }, [], {
      key: loopEpoch,
      on: mode === "loop" ? { animationiteration: onCycleComplete } : { animationend: onCycleComplete },
      style: { animation: PULSE_ANIMATION[mode] },
    }),
  ];
};

// bklit animation.ts clipRevealTransition: a tween keeps its own timing; anything else (springs) becomes the default tween.
const cssEase = (ease: EnterTransition["ease"]): string | undefined => {
  if (isString(ease)) {
    return ease;
  }
  return Array.isArray(ease) && ease.length > 0 ? `cubic-bezier(${ease.join(",")})` : undefined;
};

const clipTiming = (enter: EnterTransition | undefined): { readonly duration: number; readonly ease: string } => {
  if (enter?.type === "tween") {
    return { duration: enter.duration ?? 0.3, ease: cssEase(enter.ease) ?? REVEAL_CSS_EASE };
  }
  return { duration: isNumber(enter?.duration) ? enter.duration : DEFAULT_ANIMATION_DURATION_MS / 1000, ease: REVEAL_CSS_EASE };
};

/**
 * `ChartRevealClip`: a left-to-right clip rect grown (or concealed) with CSS keyframes; its geometry is true LTR, never scaleX (which reveals
 * from the centre). A new `mode` or `revealEpoch` remounts the rect, replaying it.
 */
export const revealClipTree = ({ clipPathId, height, targetWidth, enterTransition, revealEpoch, padding = 0, animating = true, mode = "reveal", onComplete }: Readonly<ChartRevealClipProps>): MarkupNode => {
  const { duration, ease } = clipTiming(enterTransition);
  const paddedWidth = Math.max(0, targetWidth + padding * 2);
  const paddedHeight = height + padding * 2;
  if (!animating) {
    return el("clipPath", { id: clipPathId }, [el("rect", { height: paddedHeight, width: paddedWidth, x: -padding, y: -padding })]);
  }
  const conceal = mode === "conceal";
  return el("clipPath", { id: clipPathId }, [
    el("rect", { height: paddedHeight, y: -padding }, [], {
      key: `${mode}-${revealEpoch}`,
      // The reader's `onComplete` takes no argument, so the event isn't handed on.
      on: conceal ? { animationend: () => { onComplete?.(); } } : {},
      style: {
        "--bkm-clip-w": `${paddedWidth}px`,
        "--bkm-clip-x0": `${-padding}px`,
        "--bkm-clip-x1": `${-padding + paddedWidth}px`,
        animation: `${conceal ? "bkm-clip-conceal" : "bkm-clip-reveal"} ${duration}s ${ease} forwards`,
      },
      styleBefore: "y",
    }),
  ]);
};
