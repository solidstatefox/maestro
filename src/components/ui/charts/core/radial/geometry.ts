import { scaleLinear } from "@tanstack/charts/scales/linear";
import type { RadialLayout } from "../types/radial";

/** A full turn in radians. */
export const TAU = Math.PI * 2;

/** The rings' radii as fractions of the chart radius (half the square stage), shared by every radial layer. */
export const defaultRadialLayout: RadialLayout = {
  center: 0.37,
  tickInner: 0.38,
  tickMinorOuter: 0.393,
  tickMajorOuter: 0.405,
  bandInner: 0.408,
  bandOuter: 0.83,
  scrubberOuter: 0.895,
  axisLabel: 0.955,
};

/** A point on a circle where angle 0 is 12 o'clock and angles run clockwise. */
export function polarToCartesian(angle: number, radius: number): { x: number; y: number } {
  return { x: radius * Math.sin(angle), y: -radius * Math.cos(angle) };
}

/** True when the arc `start → end` (radians) covers the whole turn. */
export function isFullArc(startAngle: number, endAngle: number): boolean {
  return Math.abs(endAngle - startAngle) >= TAU - 1e-6;
}

/** The SVG path of a circle (a full arc) or an open arc of `radius`. */
export function radialArcPath(radius: number, startAngle: number, endAngle: number): string {
  if (isFullArc(startAngle, endAngle)) {
    return `M0,${-radius}A${radius},${radius},0,1,1,0,${radius}A${radius},${radius},0,1,1,0,${-radius}Z`;
  }
  const a = polarToCartesian(startAngle, radius);
  const b = polarToCartesian(endAngle, radius);
  const large = Math.abs(endAngle - startAngle) > Math.PI ? 1 : 0;
  const sweep = endAngle > startAngle ? 1 : 0;
  return `M${a.x},${a.y}A${radius},${radius},0,${large},${sweep},${b.x},${b.y}`;
}

/** Degrees → radians. */
export function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** The clockwise angle from 12 o'clock of a point relative to the centre. */
export function cartesianToAngle(dx: number, dy: number): number {
  const angle = Math.atan2(dx, -dy);
  return angle < 0 ? angle + TAU : angle;
}

/** The start angle of bin `index` when `binCount` bins fill the full turn. */
export function radialBinStartAngle(index: number, binCount: number): number {
  return (index / Math.max(1, binCount)) * TAU;
}

/** The centre angle of bin `index` when `binCount` bins fill the full turn. */
export function radialBinCenterAngle(index: number, binCount: number): number {
  return ((index + 0.5) / Math.max(1, binCount)) * TAU;
}

/** The bin under a clockwise angle (radians) when `binCount` bins fill the full turn. */
export function radialAngleToBin(angle: number, binCount: number): number {
  const normalized = ((angle % TAU) + TAU) % TAU;
  return Math.min(binCount - 1, Math.floor((normalized / TAU) * binCount));
}

/**
 * The fraction (0–1) of the arc `start → end` at `angle`, or `null` when the angle falls in the gap of a partial arc. Works for clockwise
 * (end > start) and counter-clockwise (end < start) arcs.
 */
export function radialArcFraction(angle: number, startAngle: number, endAngle: number): number | null {
  const span = endAngle - startAngle;
  if (span === 0) {
    return null;
  }
  const direction = Math.sign(span);
  const offset = ((((angle - startAngle) * direction) % TAU) + TAU) % TAU;
  const length = Math.abs(span);
  if (length >= TAU - 1e-6) {
    return offset / TAU;
  }
  if (offset <= length) {
    return offset / length;
  }
  return null;
}

/** The bounding box of an arc of radius 1 and the centre point, in unit coordinates: the stage is cropped to it around partial arcs. */
export function radialArcBounds(startAngle: number, endAngle: number): { minX: number; maxX: number; minY: number; maxY: number } {
  const lo = Math.min(startAngle, endAngle);
  const hi = Math.max(startAngle, endAngle);
  const points = [{ x: 0, y: 0 }, polarToCartesian(lo, 1), polarToCartesian(hi, 1)];
  // Cardinal directions inside the arc extend the box.
  const first = Math.ceil(lo / (Math.PI / 2));
  for (let k = first; k * (Math.PI / 2) <= hi; k++) {
    points.push(polarToCartesian(k * (Math.PI / 2), 1));
  }
  return {
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
}

/** A pie-slice path (centre → arc → centre) of radius `radius`, for clip paths. */
export function radialWedgePath(radius: number, startAngle: number, endAngle: number): string {
  if (isFullArc(startAngle, endAngle)) {
    return radialArcPath(radius, startAngle, endAngle);
  }
  return `M0,0L${radialArcPath(radius, startAngle, endAngle).slice(1)}Z`;
}

/** A value → radius scale (`createRadialScale`): d3's `scaleRadial` with `clamp(true)`, callable, with its domain and range. */
export interface RadialScale {
  (value: number): number;
  /** [minValue, maxValue]. */
  domain(): [number, number];
  /** [innerRadius, outerRadius]. */
  range(): [number, number];
  /** Radius → value. */
  invert(radius: number): number;
}

const square = (x: number): number => Math.sign(x) * x * x;
const signedSqrt = (x: number): number => Math.sign(x) * Math.sqrt(Math.abs(x));

/**
 * Value → radius as d3's `scaleRadial` (clamped), so the area between the band base and the radius grows linearly with the value (the d3
 * radial bar and area convention). `minValue` (default 0) maps to the band base. Without d3-scale: the kit's bundles stay smaller.
 */
export function createRadialScale({ minValue = 0, maxValue, innerRadius, outerRadius }: { minValue?: number; maxValue: number; innerRadius: number; outerRadius: number }): RadialScale {
  const d0 = minValue;
  const d1 = Math.max(maxValue, minValue + Number.EPSILON);
  const r0 = square(innerRadius);
  const r1 = square(outerRadius);
  const scale = (value: number): number => {
    const t = Math.min(1, Math.max(0, (value - d0) / (d1 - d0)));
    return signedSqrt(r0 + t * (r1 - r0));
  };
  return Object.assign(scale, {
    domain: (): [number, number] => [d0, d1],
    range: (): [number, number] => [innerRadius, outerRadius],
    invert: (radius: number): number => d0 + ((square(radius) - r0) / (r1 - r0 || 1)) * (d1 - d0),
  });
}

/** Rounds a value domain outward to nice tick values (d3's `scale.nice`; TanStack's linear scale rounds the same way). */
export function niceRadialDomain(domain: [number, number], count = 5): [number, number] {
  const [min, max] = scaleLinear().domain(domain).nice(count).domain();
  return [min ?? domain[0], max ?? domain[1]];
}

/** Evenly spaced round values across a domain (d3's `scale.ticks`). */
export function radialValueTicks(domain: [number, number], count = 5): number[] {
  return scaleLinear().domain(domain).ticks(count);
}

/** Text anchor of a label. */
export type ArcTextAnchor = "start" | "middle" | "end";

/**
 * Where a label sits just before an arc's start, lined up with its ring (one label per concentric ring, stepped back along the start tangent):
 * horizontal text beside the start for arcs starting near 12 / 6 o'clock, text rotated upright along the start edge near 3 / 9 o'clock.
 */
export function arcStartLabelLayout(startAngle: number, endAngle: number, offset: number) {
  const direction = endAngle >= startAngle ? 1 : -1;
  // The tangent of the arc at its start, pointing along the sweep.
  const tx = Math.cos(startAngle) * direction;
  const ty = Math.sin(startAngle) * direction;
  const vertical = Math.abs(tx) <= 0.3;
  let anchor: ArcTextAnchor = "middle";
  if (vertical) {
    anchor = ty < 0 ? "end" : "start";
  } else if (tx > 0.3) {
    anchor = "end";
  } else if (tx < -0.3) {
    anchor = "start";
  }
  return {
    anchor,
    vertical,
    /** The label position for a ring whose band centre is at `radius`, and its rotation in degrees. */
    position(radius: number): { x: number; y: number; rotate: number } {
      const p = polarToCartesian(startAngle, radius);
      return { x: p.x - tx * offset, y: p.y - ty * offset, rotate: vertical ? -90 : 0 };
    },
  };
}

/** The font size of radial labels: it scales with the chart, 10–18 px. */
export function radialLabelFontSize(radius: number): number {
  return Math.min(18, Math.max(10, radius * 0.045));
}
