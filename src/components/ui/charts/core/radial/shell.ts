import type { RadialAngleType, RadialChartProps, RadialLayout, RadialMaxValue, RadialOrientation, RadialRingBand, RadialSeries } from "../types/radial";
import { createRadialScale, defaultRadialLayout, degreesToRadians, isFullArc, niceRadialDomain, radialArcBounds, radialArcFraction } from "./geometry";
import { radialNumberAt, radialTimeOf } from "./series";

type Datum = Readonly<Record<string, unknown>>;

/** The chart's resolved props the shell reads (core/types/radial.ts `RadialChartProps`). */
export type RadialShellProps = Omit<RadialChartProps<unknown>, "children" | "className" | "hoveredIndex" | "onHoverChange" | "ariaLabel" | "ariaDescription" | "maxWidth">;

/** The stage: its box (cropped to a partial arc's bounds), the centre in it and the chart radius, all in px. */
export interface RadialStage {
  /** Width over height of the stage box. */
  readonly aspectRatio: number;
  /** The box's sides in units of the chart radius. */
  readonly boundsWidth: number;
  readonly boundsHeight: number;
  readonly width: number;
  readonly height: number;
  readonly cx: number;
  readonly cy: number;
}

/** Everything the layers share (bklit-ui's `RadialChartContextValue` without the hover). */
export interface RadialShell {
  readonly data: readonly Datum[];
  readonly xDataKey: string;
  readonly series: readonly RadialSeries[];
  readonly binCount: number;
  /** Stage diameter in px (twice `radius`; 0 until measured). */
  readonly size: number;
  /** Chart radius: every layout fraction is relative to it. */
  readonly radius: number;
  readonly layout: RadialLayout;
  readonly stage: RadialStage;
  /** Centre circle radius in px. */
  readonly centerRadius: number;
  /** Value band base (the minimum value) in px. */
  readonly innerRadius: number;
  /** Value band top (the maximum value) in px. */
  readonly outerRadius: number;
  /** Bins where no series has a value (the rest of today): layers draw comparison ("ghost") data there. All false unless `trackNow`. */
  readonly futureBins: readonly boolean[];
  /** The last bin with data (or the `nowIndex` prop). */
  readonly nowIndex: number;
  /** The chart tracks "now" and future bins (clock charts). */
  readonly trackNow: boolean;
  /** Per-series sums over every non-future bin. */
  readonly totals: Readonly<Record<string, number>>;
  /** Enter animations are on (`animate`, and no reduced motion). */
  readonly animate: boolean;
  readonly reducedMotion: boolean;
  readonly angleType: RadialAngleType;
  readonly orientation: RadialOrientation;
  /** Arc start in radians (0 = 12 o'clock, clockwise). */
  readonly startAngle: number;
  /** Arc end in radians. */
  readonly endAngle: number;
  /** The arc is the full turn. */
  readonly isFullCircle: boolean;
  /** The signed angular width of one bin (radial orientation). */
  readonly binWidth: number;
  /** The centre angle of bin `index`. */
  readonly binAngle: (index: number) => number;
  /** The start angle of bin `index` (`binStartAngle(binCount)` is the arc end). */
  readonly binStartAngle: (index: number) => number;
  /** The bin under an angle, or `null` in the gap of a partial arc. */
  readonly angleToBin: (angle: number) => number | null;
  /** A fraction (0–1) along the arc → its angle. */
  readonly fractionToAngle: (fraction: number) => number;
  /** `time` charts: a timestamp (ms) or Date → its angle, or `null` outside the data's time span. Bin `i` starts at `datum[i][xDataKey]`. */
  readonly timeToAngle: (time: Date | number) => number | null;
  /** `time` charts: [first bin start, last bin end] in ms, else `null`. */
  readonly timeDomain: readonly [number, number] | null;
  /** The value domain mapped to [innerRadius, outerRadius] (or the arc when angular). */
  readonly valueDomain: readonly [number, number];
  /** Shorthand for `valueDomain[1]`. */
  readonly maxValue: number;
  /** `RadialChart` got `maxValue` (or is angular): layers without their own `maxValue` share `valueScale`. */
  readonly sharedValueScale: boolean;
  /** Value → radius (`scaleRadial` over `valueDomain`, clamped). */
  readonly valueScale: (value: number) => number;
  /** `angular` orientation: value → angle (linear over `valueDomain`, clamped). */
  readonly valueToAngle: (value: number) => number;
  /** `angular` orientation: the radii of bin `index`'s ring. */
  readonly ringBand: (index: number) => RadialRingBand;
}

/** Room around the centre of a cropped partial arc for the hole and the centre content (unit radius). */
const ARC_PAD = 0.12;

/** The stage's box in units of the chart radius: the unit square of a full circle, else the arc's bounds (with the centre's room). */
export function radialStageBounds(startAngle: number, endAngle: number, fitArc: boolean): { minX: number; maxX: number; minY: number; maxY: number } {
  if (isFullArc(startAngle, endAngle) || !fitArc) {
    return { minX: -1, maxX: 1, minY: -1, maxY: 1 };
  }
  const b = radialArcBounds(startAngle, endAngle);
  return { minX: Math.min(b.minX, -ARC_PAD), maxX: Math.max(b.maxX, ARC_PAD), minY: Math.min(b.minY, -ARC_PAD), maxY: Math.max(b.maxY, ARC_PAD) };
}

/** The smallest and largest value of any key, and the largest per-bin series stack. */
function scanValues(data: readonly Datum[], series: readonly RadialSeries[], keys: readonly string[]): { lo: number; hi: number; stack: number } {
  let lo = Number.POSITIVE_INFINITY;
  let hi = 0;
  let stack = 0;
  for (const d of data) {
    for (const key of keys) {
      const v = radialNumberAt(d, key);
      if (v !== null) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
    let sum = 0;
    for (const s of series) {
      sum += Math.max(0, radialNumberAt(d, s.dataKey) ?? 0);
    }
    stack = Math.max(stack, sum);
  }
  return { lo: Number.isFinite(lo) ? lo : 0, hi, stack };
}

/** The shared value domain (bklit-ui's `computeValueDomain`). */
export function radialValueDomain(input: {
  readonly data: readonly Datum[];
  readonly series: readonly RadialSeries[];
  readonly valueKeys: readonly string[];
  readonly maxValue: RadialMaxValue;
  readonly minValue: number | "auto";
  readonly nice: boolean;
}): [number, number] {
  const { data, series, valueKeys, maxValue, minValue, nice } = input;
  const keys = [...series.map((s) => s.dataKey), ...valueKeys];
  const { lo, hi, stack } = scanValues(data, series, keys);
  const autoMin = minValue === "auto";
  const fixedMax = typeof maxValue === "number";
  const min = autoMin ? lo : minValue;
  let max = Math.max(hi, maxValue === "stacked" ? stack : 0);
  if (fixedMax) {
    max = maxValue;
  }
  if (!nice || (fixedMax && !autoMin)) {
    return [min, max];
  }
  const [niceMin, niceMax] = niceRadialDomain([min, Math.max(max, min)]);
  return [autoMin ? niceMin : min, fixedMax ? max : niceMax];
}

/** The shell of one pass: `width` is the stage's measured width (0 before the first measure). */
export function createRadialShell(props: Readonly<RadialShellProps>, width: number, reducedMotion: boolean): RadialShell {
  const {
    data, xDataKey = "time", series, layout: layoutProp, angleType = "clock", orientation = "radial", startAngle: startDeg = 0, endAngle: endDeg,
    fitArc = true, trackNow: trackNowProp, nowIndex: nowIndexProp, maxValue: maxValueProp, minValue = 0, valueKeys, niceValues = true,
    ringGap = 0.3, animate = true,
  } = props;
  const layout: RadialLayout = { ...defaultRadialLayout, ...layoutProp };

  // The arc and the stage --------------------------------------------------------------------------------------------------------
  const startAngle = degreesToRadians(startDeg);
  const endAngle = degreesToRadians(endDeg ?? startDeg + 360);
  const isFullCircle = isFullArc(startAngle, endAngle);
  const span = endAngle - startAngle;
  const bounds = radialStageBounds(startAngle, endAngle, fitArc);
  const boundsWidth = bounds.maxX - bounds.minX;
  const boundsHeight = bounds.maxY - bounds.minY;
  const stageWidth = Math.max(0, width);
  const radius = stageWidth / boundsWidth;
  const stage: RadialStage = {
    aspectRatio: boundsWidth / boundsHeight, boundsWidth, boundsHeight, width: stageWidth, height: radius * boundsHeight, cx: -bounds.minX * radius, cy: -bounds.minY * radius,
  };

  // Data ------------------------------------------------------------------------------------------------------------------------
  const binCount = data.length;
  const trackNow = trackNowProp ?? angleType === "clock";
  const futureBins = data.map((d) => trackNow && series.every((s) => radialNumberAt(d, s.dataKey) === null));
  let nowIndex = binCount - 1;
  if (nowIndexProp === undefined) {
    for (let i = binCount - 1; i >= 0; i--) {
      if (series.some((s) => radialNumberAt(data[i], s.dataKey) !== null)) {
        nowIndex = i;
        break;
      }
    }
  } else {
    nowIndex = nowIndexProp;
  }
  const totals: Record<string, number> = {};
  for (const s of series) {
    totals[s.dataKey] = 0;
  }
  data.forEach((d, i) => {
    if (futureBins[i]) {
      return;
    }
    for (const s of series) {
      totals[s.dataKey] = (totals[s.dataKey] ?? 0) + (radialNumberAt(d, s.dataKey) ?? 0);
    }
  });

  // The value scale --------------------------------------------------------------------------------------------------------------
  const sharedValueScale = maxValueProp !== undefined || orientation === "angular";
  const valueDomain = radialValueDomain({ data, series, valueKeys: valueKeys ?? [], maxValue: maxValueProp ?? "stacked", minValue, nice: niceValues });
  const innerRadius = radius * layout.bandInner;
  const outerRadius = radius * layout.bandOuter;
  const scale = createRadialScale({ minValue: valueDomain[0], maxValue: valueDomain[1], innerRadius, outerRadius });
  const valueScale = (value: number): number => scale(value) ?? innerRadius;
  const valueToAngle = (value: number): number => {
    const [lo, hi] = valueDomain;
    const t = hi > lo ? (value - lo) / (hi - lo) : 0;
    return startAngle + Math.min(1, Math.max(0, t)) * span;
  };
  const ringBand = (index: number): RadialRingBand => {
    const step = (outerRadius - innerRadius) / Math.max(1, binCount);
    const gap = step * Math.min(0.95, Math.max(0, ringGap));
    const inner = innerRadius + index * step + gap / 2;
    const outer = innerRadius + (index + 1) * step - gap / 2;
    return { inner, outer, center: (inner + outer) / 2 };
  };

  // Time --------------------------------------------------------------------------------------------------------------------------
  let timeDomain: [number, number] | null = null;
  if (angleType === "time" && binCount > 0) {
    const first = radialTimeOf(data[0]?.[xDataKey]);
    const last = radialTimeOf(data[binCount - 1]?.[xDataKey]);
    if (first !== null && last !== null) {
      const step = binCount > 1 ? (last - first) / (binCount - 1) : 1;
      timeDomain = [first, first + step * binCount];
    }
  }
  const timeToAngle = (time: Date | number): number | null => {
    if (!timeDomain) {
      return null;
    }
    const t = typeof time === "number" ? time : time.getTime();
    const [t0, t1] = timeDomain;
    if (t < t0 || t > t1 || t1 <= t0) {
      return null;
    }
    return startAngle + ((t - t0) / (t1 - t0)) * span;
  };

  // Angles --------------------------------------------------------------------------------------------------------------------------
  const binWidth = binCount > 0 ? span / binCount : 0;
  const binStartAngle = (index: number): number => startAngle + (index / Math.max(1, binCount)) * span;
  const binAngle = (index: number): number => startAngle + ((index + 0.5) / Math.max(1, binCount)) * span;
  const fractionToAngle = (fraction: number): number => startAngle + fraction * span;
  const angleToBin = (angle: number): number | null => {
    const fraction = radialArcFraction(angle, startAngle, endAngle);
    if (fraction === null || binCount === 0) {
      return null;
    }
    return Math.min(binCount - 1, Math.floor(fraction * binCount));
  };

  return {
    data, xDataKey, series, binCount, size: radius * 2, radius, layout, stage, centerRadius: radius * layout.center, innerRadius, outerRadius,
    futureBins, nowIndex, trackNow, totals, animate: animate && !reducedMotion, reducedMotion, angleType, orientation, startAngle, endAngle,
    isFullCircle, binWidth, binAngle, binStartAngle, angleToBin, fractionToAngle, timeToAngle, timeDomain, valueDomain, maxValue: valueDomain[1],
    sharedValueScale, valueScale, valueToAngle, ringBand,
  };
}
