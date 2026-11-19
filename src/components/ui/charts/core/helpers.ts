import type { ArcDatum, Focus } from "./sunburst/arcs";
import { clockwiseFraction, ringOptions } from "./sunburst/arcs";
import { DEFAULT_Y_DOMAIN_TWEEN_MS } from "./motion/phase";
import type { ChartPhase, ChartStatus, LineLoadingPulseMode } from "./motion/phase";
import { TOOLTIP_BOX_SPRING } from "./motion/springs";
import { projectionDateExtents, projectionValueExtents } from "./projection-utils";
import type { IndicatorFadeEdges, ProjectionLineConfig, SeriesPointMarkerStyle, SpringConfig } from "./types/cartesian";
import type { ProfitLossSegment } from "./profit-loss";
import type { ReferenceAreaIfOverflow, ReferenceAreaRect } from "./types/reference-area";

/**
 * Lifecycle values a chart uses before it has a phase machine of its own: ready, with a 0 to 100 skeleton domain.
 * @internal
 */
export const DEFAULT_CHART_LIFECYCLE = {
  chartPhase: "ready",
  chartStatus: "ready",
  loadingLabel: undefined,
  yDomainTweenDuration: DEFAULT_Y_DOMAIN_TWEEN_MS,
  yDomainSkeletonByAxis: { left: [0, 100] as [number, number] },
  yDomainTargetByAxis: { left: [0, 100] as [number, number] },
} as const satisfies {
  chartPhase: ChartPhase;
  chartStatus: ChartStatus;
  loadingLabel: undefined;
  yDomainTweenDuration: number;
  yDomainSkeletonByAxis: Record<string, [number, number]>;
  yDomainTargetByAxis: Record<string, [number, number]>;
};

// --- Tooltip -----------------------------------------------------------

/** The `damping` slider's scale is bklit's (chart-config-context.tsx:59-90): it pivots on tooltipBoxSpring 100/20, the default. */
const BKLIT_TOOLTIP_BOX = { stiffness: 100, damping: 20 } as const;
const DEFAULT_TOOLTIP_BOX_DAMPING = /* @__PURE__ */ (() => BKLIT_TOOLTIP_BOX.damping)();
/** Snappy variant: the slider's spring plays this many times faster than bklit's (stiffness x speed², damping x speed), the same curve shape,
 * so the default (`damping` 20 or unset) is TOOLTIP_BOX_SPRING. */
const TOOLTIP_BOX_SPEED = /* @__PURE__ */ (() => Math.sqrt(TOOLTIP_BOX_SPRING.stiffness / BKLIT_TOOLTIP_BOX.stiffness))();

/**
 * Maps a damping slider to the floating tooltip panel follow spring. `0` is instant.
 * @internal
 */
export function resolveTooltipBoxMotion(damping?: number): { animate: boolean; springConfig: SpringConfig } {
  if (damping === 0) {
    return { animate: false, springConfig: TOOLTIP_BOX_SPRING };
  }
  const effectiveDamping = damping ?? DEFAULT_TOOLTIP_BOX_DAMPING;
  let stiffness: number = BKLIT_TOOLTIP_BOX.stiffness;
  if (effectiveDamping < DEFAULT_TOOLTIP_BOX_DAMPING) {
    stiffness += ((DEFAULT_TOOLTIP_BOX_DAMPING - effectiveDamping) / DEFAULT_TOOLTIP_BOX_DAMPING) * 400;
  } else if (effectiveDamping > DEFAULT_TOOLTIP_BOX_DAMPING) {
    stiffness -= ((effectiveDamping - DEFAULT_TOOLTIP_BOX_DAMPING) / (100 - DEFAULT_TOOLTIP_BOX_DAMPING)) * 85;
  }
  return { animate: true, springConfig: { stiffness: Math.max(12, Math.round(stiffness)) * TOOLTIP_BOX_SPEED ** 2, damping: effectiveDamping * TOOLTIP_BOX_SPEED } };
}

export interface VerticalFadeSides {
  top: boolean;
  bottom: boolean;
  any: boolean;
}

/**
 * Which ends of the crosshair indicator fade out.
 * @internal
 */
export function resolveVerticalFadeSides(fade: IndicatorFadeEdges | boolean): VerticalFadeSides {
  if (fade === false || fade === "none") {
    return { top: false, bottom: false, any: false };
  }
  if (fade === true || fade === "both") {
    return { top: true, bottom: true, any: true };
  }
  if (fade === "top") {
    return { top: true, bottom: false, any: true };
  }
  return { top: false, bottom: true, any: true };
}

export interface IndicatorFadeGradientStop {
  /** Position along the indicator as a percentage string, for example `"10%"`. */
  offset: string;
  /** Opacity at that position, from 0 to 1. */
  opacity: number;
}

/**
 * Opacity stops for the crosshair's vertical gradient.
 * @internal
 */
export function indicatorFadeGradientStops(sides: VerticalFadeSides, fadeLengthPercent = 10): IndicatorFadeGradientStop[] {
  const fade = Math.min(40, Math.max(2, fadeLengthPercent));
  const innerEnd = 100 - fade;
  if (!sides.any) {
    return [{ offset: "0%", opacity: 1 }];
  }
  if (sides.top && sides.bottom) {
    return [
      { offset: "0%", opacity: 0 },
      { offset: `${fade}%`, opacity: 1 },
      { offset: "50%", opacity: 1 },
      { offset: `${innerEnd}%`, opacity: 1 },
      { offset: "100%", opacity: 0 },
    ];
  }
  if (sides.top) {
    return [
      { offset: "0%", opacity: 0 },
      { offset: `${fade}%`, opacity: 1 },
      { offset: "100%", opacity: 1 },
    ];
  }
  return [
    { offset: "0%", opacity: 1 },
    { offset: `${innerEnd}%`, opacity: 1 },
    { offset: "100%", opacity: 0 },
  ];
}

// --- Loading -----------------------------------------------------------

/**
 * The pulse mode a line shows in a chart phase, or `null` when it shows none.
 * @internal
 */
export function resolveLineLoadingPulseMode(phase: ChartPhase): LineLoadingPulseMode | null {
  switch (phase) {
    case "loading":
      return "loop";
    case "exiting":
      return "exit";
    case "revealingLoading":
      return "enter";
    default:
      return null;
  }
}

// --- Markers -----------------------------------------------------------

/**
 * Radius of the space a series point marker occupies, including ring, outline and active highlight.
 * @internal
 */
export function getSeriesMarkerVisualExtent(
  style: Pick<SeriesPointMarkerStyle, "radius" | "strokeWidth" | "ringGap" | "outlineWidth" | "showActiveHighlight">,
): number {
  const radius = style.radius ?? 5;
  const strokeWidth = style.strokeWidth ?? 2;
  const ringGap = style.ringGap ?? 2;
  const outlineWidth = style.outlineWidth ?? 0;
  const showActiveHighlight = style.showActiveHighlight ?? true;
  const ring = strokeWidth > 0 ? ringGap + strokeWidth : 0;
  const outline = outlineWidth > 0 ? outlineWidth : 0;
  const highlightPad = showActiveHighlight ? radius * 0.35 : 0;
  return radius + ring + outline + highlightPad + 2;
}

// --- Profit and loss ---------------------------------------------------

type SegmentSign = "positive" | "negative";

function resolveSign(value: number, fallback: SegmentSign): SegmentSign {
  if (value > 0) {
    return "positive";
  }
  if (value < 0) {
    return "negative";
  }
  return fallback;
}

function findInitialSign(data: Record<string, unknown>[], dataKey: string): SegmentSign {
  for (const row of data) {
    const value = row[dataKey];
    if (typeof value !== "number") {
      continue;
    }
    if (value > 0) {
      return "positive";
    }
    if (value < 0) {
      return "negative";
    }
  }
  return "positive";
}

function interpolateZeroCrossing(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  dataKey: string,
  xDataKey: string,
  xAccessor: (d: Record<string, unknown>) => Date,
): Record<string, unknown> {
  const ya = a[dataKey] as number;
  const yb = b[dataKey] as number;
  const t = ya / (ya - yb);
  const start = xAccessor(a).getTime();
  const end = xAccessor(b).getTime();
  return { ...a, [xDataKey]: new Date(start + t * (end - start)), [dataKey]: 0 };
}

/**
 * Split one series into contiguous segments above and below zero, with an interpolated row at each crossing.
 * @internal
 */
export function splitProfitLossSegments({
  data,
  dataKey,
  xDataKey = "date",
  xAccessor,
}: {
  data: Record<string, unknown>[];
  dataKey: string;
  xDataKey?: string;
  xAccessor: (d: Record<string, unknown>) => Date;
}): ProfitLossSegment[] {
  const firstPoint = data[0];
  if (!firstPoint) {
    return [];
  }
  const segments: ProfitLossSegment[] = [];
  let currentSign = findInitialSign(data, dataKey);
  let currentSegment: Record<string, unknown>[] = [firstPoint];
  for (let i = 0; i < data.length - 1; i++) {
    const a = data[i];
    const b = data[i + 1];
    if (!(a && b)) {
      continue;
    }
    const ya = a[dataKey] as number;
    const yb = b[dataKey] as number;
    if (typeof ya === "number" && typeof yb === "number" && ya !== 0 && yb !== 0 && Math.sign(ya) !== Math.sign(yb)) {
      const cross = interpolateZeroCrossing(a, b, dataKey, xDataKey, xAccessor);
      currentSegment.push(cross);
      segments.push({ data: currentSegment, isPositive: currentSign === "positive" });
      currentSegment = [cross, b];
      currentSign = resolveSign(yb, currentSign);
      continue;
    }
    currentSegment.push(b);
    if (typeof yb === "number" && yb !== 0) {
      currentSign = resolveSign(yb, currentSign);
    }
  }
  segments.push({ data: currentSegment, isPositive: currentSign === "positive" });
  return segments;
}

// --- Projection and reference area -------------------------------------

/**
 * Widen a y domain by the extent of the projection lines on `yAxisId`; the result is not re-niced.
 * @internal
 */
export function mergeProjectionYDomain(domain: [number, number], configs: ProjectionLineConfig[], yAxisId: string): [number, number] {
  const extents = projectionValueExtents(configs.filter((config) => config.yAxisId === yAxisId).map((config) => config.data));
  if (!extents) {
    return domain;
  }
  const [min, max] = domain;
  const nextMin = Math.min(min, extents.minValue);
  const nextMax = Math.max(max, extents.maxValue);
  if (nextMin >= 0 && min >= 0) {
    return [0, nextMax <= 0 ? 100 : nextMax * 1.1];
  }
  const padding = (nextMax - nextMin) * 0.05 || 1;
  return [nextMin - padding, nextMax + padding];
}

/**
 * The later of `maxTime` and the last date of any projection line.
 * @internal
 */
export function mergeProjectionXDomainMax(maxTime: number, configs: ProjectionLineConfig[]): number {
  const extents = projectionDateExtents(configs.map((config) => config.data));
  return extents ? Math.max(maxTime, extents.maxTime) : maxTime;
}

export interface ComputeReferenceAreaRectOptions {
  /** Plot width in px. */
  innerWidth: number;
  /** Plot height in px. */
  innerHeight: number;
  /** Starting x data coordinate. Defaults to the plot left. */
  x1?: Date | number;
  /** Ending x data coordinate. Defaults to the plot right. */
  x2?: Date | number;
  /** Lower y data bound. Defaults to the plot top. */
  y1?: number;
  /** Upper y data bound. Defaults to the plot bottom. */
  y2?: number;
  /**
   * How to treat a band that extends past the plot.
   * @default "hidden"
   */
  ifOverflow?: ReferenceAreaIfOverflow;
  /** Maps a date to a plot x pixel. */
  xScale: (value: Date) => number;
  /** Maps a value to a plot y pixel. */
  yScale: (value: number) => number;
}

function clampRectToPlot(rect: ReferenceAreaRect, innerWidth: number, innerHeight: number): ReferenceAreaRect | null {
  const x1 = Math.max(0, rect.x);
  const y1 = Math.max(0, rect.y);
  const x2 = Math.min(innerWidth, rect.x + rect.width);
  const y2 = Math.min(innerHeight, rect.y + rect.height);
  const width = x2 - x1;
  const height = y2 - y1;
  return width <= 0 || height <= 0 ? null : { x: x1, y: y1, width, height };
}

/**
 * Map a reference area's data bounds to plot pixels; `null` when nothing is left to draw.
 * @internal
 */
export function computeReferenceAreaRect(options: ComputeReferenceAreaRectOptions): ReferenceAreaRect | null {
  const { innerWidth, innerHeight, x1, x2, y1, y2, ifOverflow = "hidden", xScale, yScale } = options;
  if (innerWidth <= 0 || innerHeight <= 0) {
    return null;
  }
  const toX = (value: Date | number | undefined, fallback: number) =>
    value == null ? fallback : xScale(value instanceof Date ? value : new Date(value));
  const toY = (value: number | undefined, fallback: number) => (value == null ? fallback : yScale(value));
  const left = toX(x1, 0);
  const right = toX(x2, innerWidth);
  const top = toY(y1, 0);
  const bottom = toY(y2, innerHeight);
  const width = Math.abs(right - left);
  const height = Math.abs(bottom - top);
  if (width <= 0 || height <= 0) {
    return null;
  }
  const rect: ReferenceAreaRect = { x: Math.min(left, right), y: Math.min(top, bottom), width, height };
  if (ifOverflow === "visible") {
    return rect;
  }
  if (ifOverflow === "discard") {
    const inside = rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= innerWidth && rect.y + rect.height <= innerHeight;
    return inside ? rect : null;
  }
  return clampRectToPlot(rect, innerWidth, innerHeight);
}

// --- Sunburst geometry -------------------------------------------------

const TOP = -Math.PI / 2;
const TWO_PI = 2 * Math.PI;
const ID_SEP = " / ";

/**
 * Angles (radians, 0 at 12 o'clock minus a quarter turn) and radii of one sunburst arc.
 * @internal
 */
export interface ArcGeometry {
  a0: number;
  a1: number;
  innerR: number;
  outerR: number;
}

/**
 * Where `arc` sits when `focus` is the zoomed node; `null` when it is outside that subtree.
 * @internal
 */
export function geometryFor(arc: ArcDatum, focus: Focus, maxDepth: number, radius: number): ArcGeometry | null {
  if (arc.depth <= focus.depth) {
    return null;
  }
  if (arc.id !== focus.id && !arc.id.startsWith(`${focus.id}${ID_SEP}`)) {
    return null;
  }
  const { centerR, ringWidth } = ringOptions(focus.depth, maxDepth, radius);
  const relativeDepth = arc.depth - focus.depth;
  const focusSpan = focus.a1 - focus.a0;
  const mapAngle = (angle: number) => (focusSpan <= 1e-9 ? TOP : TOP + ((angle - focus.a0) / focusSpan) * TWO_PI);
  return {
    a0: mapAngle(arc.a0),
    a1: mapAngle(arc.a1),
    innerR: centerR + (relativeDepth - 1) * ringWidth,
    outerR: centerR + relativeDepth * ringWidth,
  };
}

function lerpAngle(from: number, to: number, progress: number): number {
  let delta = to - from;
  while (delta > Math.PI) {
    delta -= TWO_PI;
  }
  while (delta < -Math.PI) {
    delta += TWO_PI;
  }
  return from + delta * progress;
}

/**
 * Interpolate two arcs, turning the short way round.
 * @internal
 */
export function lerpGeometry(from: ArcGeometry, to: ArcGeometry, progress: number): ArcGeometry {
  const t = Math.min(1, Math.max(0, progress));
  const mid = lerpAngle((from.a0 + from.a1) / 2, (to.a0 + to.a1) / 2, t);
  const fromHalf = (from.a1 - from.a0) / 2;
  const half = fromHalf + ((to.a1 - to.a0) / 2 - fromHalf) * t;
  return {
    a0: mid - half,
    a1: mid + half,
    innerR: from.innerR + (to.innerR - from.innerR) * t,
    outerR: from.outerR + (to.outerR - from.outerR) * t,
  };
}

function pointGeometry(source: ArcGeometry): ArcGeometry {
  const mid = (source.a0 + source.a1) / 2;
  const radius = (source.innerR + source.outerR) / 2;
  const pin = Math.max(0, Math.min(radius * 0.12, source.innerR));
  return { a0: mid, a1: mid, innerR: pin, outerR: pin };
}

/**
 * Zoom morph: matching arcs interpolate, entering and exiting arcs collapse to a point.
 * @internal
 */
export function transitionGeometry(
  arc: ArcDatum,
  fromFocus: Focus,
  toFocus: Focus,
  maxDepth: number,
  radius: number,
  progress: number,
): ArcGeometry | null {
  const from = geometryFor(arc, fromFocus, maxDepth, radius);
  const to = geometryFor(arc, toFocus, maxDepth, radius);
  if (from && to) {
    return lerpGeometry(from, to, progress);
  }
  if (from) {
    return lerpGeometry(from, pointGeometry(from), progress);
  }
  if (to) {
    return lerpGeometry(pointGeometry(to), to, progress);
  }
  return null;
}

/**
 * SVG path of an arc swept in clockwise by `progress` and grown outward by `radialProgress`; `null` when too small to draw.
 * @internal
 */
export function arcPath(geometry: ArcGeometry, progress: number, radialProgress = progress): string | null {
  if (progress <= 0 && radialProgress <= 0) {
    return null;
  }
  const p = Math.min(1, Math.max(0, progress));
  const radialP = Math.min(1, Math.max(0, radialProgress));
  const { a0, a1, innerR, outerR } = geometry;
  if (p >= 1 && radialP >= 1) {
    return arcPathFromRadii(a0, a1, innerR, outerR);
  }
  const currentInner = innerR < 1 ? 0 : innerR;
  const currentOuter = innerR < 1 ? outerR * radialP : innerR + (outerR - innerR) * radialP;
  return arcPathFromRadii(a0, a0 + (a1 - a0) * p, currentInner, currentOuter);
}

function arcPathFromRadii(currentA0: number, currentA1: number, currentInner: number, currentOuter: number): string | null {
  if (currentOuter - currentInner < 0.5 || currentA1 - currentA0 < 0.001) {
    return null;
  }
  const largeArc = currentA1 - currentA0 > Math.PI ? 1 : 0;
  const outerX0 = Math.sin(currentA0) * currentOuter;
  const outerY0 = -Math.cos(currentA0) * currentOuter;
  const outerX1 = Math.sin(currentA1) * currentOuter;
  const outerY1 = -Math.cos(currentA1) * currentOuter;
  if (currentInner < 1) {
    return `M 0 0 L ${outerX0} ${outerY0} A ${currentOuter} ${currentOuter} 0 ${largeArc} 1 ${outerX1} ${outerY1} Z`;
  }
  const innerX1 = Math.sin(currentA1) * currentInner;
  const innerY1 = -Math.cos(currentA1) * currentInner;
  const innerX0 = Math.sin(currentA0) * currentInner;
  const innerY0 = -Math.cos(currentA0) * currentInner;
  return `M ${outerX0} ${outerY0} A ${currentOuter} ${currentOuter} 0 ${largeArc} 1 ${outerX1} ${outerY1} L ${innerX1} ${innerY1} A ${currentInner} ${currentInner} 0 ${largeArc} 0 ${innerX0} ${innerY0} Z`;
}

/** @internal */
export function centroidAngle(arc: ArcDatum): number {
  return (arc.a0 + arc.a1) / 2;
}

/** @internal */
export function geomCentroidAngle(geometry: ArcGeometry): number {
  return (geometry.a0 + geometry.a1) / 2;
}

/** @internal */
export function geomCentroidRadius(geometry: ArcGeometry): number {
  return (geometry.innerR + geometry.outerR) / 2;
}

/**
 * Progress of a staggered animation: 0 until `delay`, then linear over `duration`.
 * @internal
 */
export function localProgress(progress: number, delay: number, duration: number): number {
  if (progress <= delay) {
    return 0;
  }
  if (duration <= 0) {
    return 1;
  }
  return Math.min(1, (progress - delay) / duration);
}

/**
 * Enter delay (seconds) of one sunburst segment.
 * @internal
 */
export interface SunburstSegmentEnterDelays {
  delay: number;
}

/** @internal */
export interface SunburstEnterTiming {
  segmentDelays: Map<string, SunburstSegmentEnterDelays>;
  maxDelay: number;
}

/**
 * Per-segment enter delays: each ring starts later than the one inside it and segments follow clockwise.
 * @internal
 */
export function buildSunburstEnterTiming(arcs: ArcDatum[], staggerScale = 1): SunburstEnterTiming {
  const scale = Math.max(0.25, staggerScale);
  const byDepth = new Map<number, ArcDatum[]>();
  for (const arc of arcs) {
    const list = byDepth.get(arc.depth) ?? [];
    list.push(arc);
    byDepth.set(arc.depth, list);
  }
  const segmentDelays = new Map<string, SunburstSegmentEnterDelays>();
  let maxDelay = 0;
  for (const [, ringArcs] of byDepth) {
    const sorted = [...ringArcs].sort((a, b) => clockwiseFraction(a.a0) - clockwiseFraction(b.a0));
    const ringIndex = (sorted[0]?.depth ?? 1) - 1;
    for (const [index, arc] of sorted.entries()) {
      const delay = (ringIndex * 0.12 + index * 0.08) * scale;
      segmentDelays.set(arc.id, { delay });
      maxDelay = Math.max(maxDelay, delay);
    }
  }
  return { segmentDelays, maxDelay };
}

/**
 * @deprecated Use {@link buildSunburstEnterTiming}.
 * @internal
 */
export interface SunburstRevealSchedule {
  ringStarts: Map<number, number>;
  ringDuration: number;
  segmentsCompleteAt: number;
  labelsStart: number;
  labelDuration: number;
}

/**
 * @deprecated Use {@link buildSunburstEnterTiming}.
 * @internal
 */
export function buildRevealSchedule(arcs: ArcDatum[], staggerScale = 1): SunburstRevealSchedule {
  const timing = buildSunburstEnterTiming(arcs, staggerScale);
  const ringStarts = new Map<number, number>();
  for (const arc of arcs) {
    const delays = timing.segmentDelays.get(arc.id);
    if (delays) {
      ringStarts.set(arc.depth, delays.delay);
    }
  }
  return {
    ringDuration: 0.6,
    ringStarts,
    segmentsCompleteAt: timing.maxDelay,
    labelsStart: timing.maxDelay + 0.12,
    labelDuration: 0.2,
  };
}

/**
 * @deprecated Ring sweep reveal; use {@link buildSunburstEnterTiming}.
 * @internal
 */
export function segmentRevealFromRingSweep(ringProgress: number, a0: number, a1: number): { angular: number; radial: number } {
  const radial = Math.min(1, Math.max(0, ringProgress));
  const startF = clockwiseFraction(a0);
  const endF = clockwiseFraction(a1);
  if (ringProgress <= startF) {
    return { angular: 0, radial };
  }
  if (ringProgress >= endF) {
    return { angular: 1, radial };
  }
  return { angular: (ringProgress - startF) / Math.max(endF - startF, 1e-9), radial };
}

/**
 * @deprecated Use {@link buildSunburstEnterTiming}.
 * @internal
 */
export function buildRevealDelays(arcs: ArcDatum[]): Map<string, number> {
  const timing = buildSunburstEnterTiming(arcs);
  return new Map(arcs.map((arc) => [arc.id, timing.segmentDelays.get(arc.id)?.delay ?? 0]));
}
