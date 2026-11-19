import type { GaugeArcStyle, GaugeNeedleOptions, GaugeProgressRingOptions, GaugeRulerOptions, GaugeZone, GaugeZoneDisplay } from "../types/gauge";

const MIN_SWEEP = 0.01;
const MAX_SWEEP = 359.99;
const DEG = Math.PI / 180;

/** Server and client trig differ in their last bits, which would break hydration: every coordinate is rounded to 0.001px. */
export const r3 = (v: number): number => Math.round(v * 1000) / 1000;

export const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** The point at `deg` (SVG degrees: 0 points right, clockwise) on a circle of radius `r` about (cx, cy). */
export const polar = (cx: number, cy: number, r: number, deg: number): readonly [number, number] => [r3(cx + Math.cos(deg * DEG) * r), r3(cy + Math.sin(deg * DEG) * r)];

/** Centreline arc from `a0` to `a1` (degrees, clockwise); empty when degenerate. */
export const arcStrokePath = (cx: number, cy: number, r: number, a0: number, a1: number): string => {
  const sweep = Math.min(MAX_SWEEP, a1 - a0);
  if (sweep < MIN_SWEEP || r <= 0) { return ""; }
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a0 + sweep);
  return `M${x0} ${y0}A${r3(r)} ${r3(r)} 0 ${sweep > 180 ? 1 : 0} 1 ${x1} ${y1}`;
};

/** Filled ring segment between radii `r0` (inner, may be 0) and `r1`. */
export const annularSectorPath = (cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string => {
  const sweep = Math.min(MAX_SWEEP, a1 - a0);
  if (sweep < MIN_SWEEP) { return ""; }
  const end = a0 + sweep;
  const large = sweep > 180 ? 1 : 0;
  const [ox0, oy0] = polar(cx, cy, r1, a0);
  const [ox1, oy1] = polar(cx, cy, r1, end);
  const outer = `A${r3(r1)} ${r3(r1)} 0 ${large} 1 ${ox1} ${oy1}`;
  if (r0 <= 0.5) { return `M${r3(cx)} ${r3(cy)}L${ox0} ${oy0}${outer}Z`; }
  const [ix1, iy1] = polar(cx, cy, r0, end);
  const [ix0, iy0] = polar(cx, cy, r0, a0);
  return `M${ox0} ${oy0}${outer}L${ix1} ${iy1}A${r3(r0)} ${r3(r0)} 0 ${large} 0 ${ix0} ${iy0}Z`;
};

/** The colour of the last zone covering `t` (0–1), if any. */
export const zoneColorAt = (zones: readonly GaugeZone[] | undefined, t: number): string | undefined => {
  if (zones === undefined) { return undefined; }
  const pct = t * 100;
  for (let i = zones.length - 1; i >= 0; i -= 1) {
    const z = zones[i];
    if (z !== undefined && pct >= z.from && pct <= z.to) { return z.color; }
  }
  return undefined;
};

/** A zone band's width as a fraction of size. */
export const ZONE_BAND_WIDTH = 0.014;

/** A notch's four corners: outer edge 1 → 2, inner edge 3 → 4. */
export type NotchPoints = readonly [x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number];

const lerp = (a: number, b: number, t: number): number => r3(a + (b - a) * t);

/** bklit's `createNotchPath`: the quad with each corner cut by a quadratic of `cornerRadius`, clamped by the edges and `depth`. */
export const notchPath = (p: NotchPoints, cornerRadius: number, depth: number): string => {
  const [x1, y1, x2, y2, x3, y3, x4, y4] = p;
  if (cornerRadius <= 0) { return `M${x1} ${y1}L${x2} ${y2}L${x3} ${y3}L${x4} ${y4}Z`; }
  const d12 = Math.hypot(x2 - x1, y2 - y1);
  const d23 = Math.hypot(x3 - x2, y3 - y2);
  const d34 = Math.hypot(x4 - x3, y4 - y3);
  const d41 = Math.hypot(x1 - x4, y1 - y4);
  const cr = Math.min(cornerRadius, depth * 0.48, d12 * 0.49, d23 * 0.49, d34 * 0.49, d41 * 0.49);
  const t1 = Math.min(cr / d12, 0.49);
  const t2 = Math.min(cr / d23, 0.49);
  const t3 = Math.min(cr / d34, 0.49);
  const t4 = Math.min(cr / d41, 0.49);
  const pt = (ax: number, ay: number, bx: number, by: number, t: number): string => `${lerp(ax, bx, t)} ${lerp(ay, by, t)}`;
  return `M${pt(x1, y1, x4, y4, t4)}Q${x1} ${y1} ${pt(x1, y1, x2, y2, t1)}L${pt(x2, y2, x1, y1, t1)}Q${x2} ${y2} ${pt(x2, y2, x3, y3, t2)}`
    + `L${pt(x3, y3, x2, y2, t2)}Q${x3} ${y3} ${pt(x3, y3, x4, y4, t3)}L${pt(x4, y4, x3, y3, t3)}Q${x4} ${y4} ${pt(x4, y4, x1, y1, t4)}Z`;
};

export interface ArcNotchInput {
  readonly total: number;
  readonly spacing: number;
  readonly startAngle: number;
  readonly endAngle: number;
  readonly cx: number;
  readonly cy: number;
  readonly outerRadius: number;
  readonly innerRadius: number;
  readonly notchLength: number;
  readonly uniformWidth: boolean;
}

/** bklit's arc notches (gauge.tsx GaugeArcInner): the outer edge a chord at the outer radius; the inner edge a chord at the inner radius, or
 * parallel sides when `uniformWidth`. */
export const arcNotchPoints = (o: ArcNotchInput): NotchPoints[] => {
  const totalAngle = o.endAngle - o.startAngle;
  const notchAngle = o.total > 0 ? (totalAngle * (1 - o.spacing / 100)) / o.total : 0;
  const gapAngle = (totalAngle * (o.spacing / 100)) / (o.total - 1 > 0 ? o.total - 1 : 1);
  const half = ((notchAngle * 0.8) / 2) * DEG;
  return Array.from({ length: o.total }, (_, i) => {
    const rad = (o.startAngle + i * (notchAngle + gapAngle) + notchAngle / 2) * DEG;
    const at = (a: number, r: number): [number, number] => [r3(o.cx + Math.cos(a) * r), r3(o.cy + Math.sin(a) * r)];
    const [x1, y1] = at(rad - half, o.outerRadius);
    const [x2, y2] = at(rad + half, o.outerRadius);
    if (o.uniformWidth) {
      const px = Math.cos(rad) * o.notchLength;
      const py = Math.sin(rad) * o.notchLength;
      return [x1, y1, x2, y2, r3(x2 - px), r3(y2 - py), r3(x1 - px), r3(y1 - py)];
    }
    const [x3, y3] = at(rad + half, o.innerRadius);
    const [x4, y4] = at(rad - half, o.innerRadius);
    return [x1, y1, x2, y2, x3, y3, x4, y4];
  });
};

export interface LinearNotchInput {
  readonly total: number;
  readonly spacing: number;
  readonly width: number;
  readonly height: number;
  readonly notchLengthPercent: number;
  readonly notchWidthPercent: number;
  readonly uniformWidth: boolean;
}

// bklit's tapered linear notch: the inner (bottom) edge is 28/42 of the outer.
const TAPER_RATIO = 28 / 42;

/** bklit's linear notches (gauge.tsx GaugeLinearInner) and the depth their corners clamp to. */
export const linearNotchPoints = (o: LinearNotchInput): { readonly points: NotchPoints[]; readonly cornerDepth: number } => {
  const cy = o.height / 2;
  const outerOffset = (o.height / 2) * (clamp(o.notchLengthPercent, 5, 100) / 100);
  const innerOffset = o.uniformWidth ? outerOffset : outerOffset * TAPER_RATIO;
  const notchDepth = o.uniformWidth ? outerOffset * 2 : outerOffset - innerOffset;
  const widthFactor = clamp(o.notchWidthPercent, 10, 100) / 100;
  const slot = o.total > 0 ? (o.width * (1 - o.spacing / 100)) / o.total : 0;
  const gap = (o.width * (o.spacing / 100)) / (o.total - 1 > 0 ? o.total - 1 : 1);
  const points = Array.from({ length: o.total }, (_, i): NotchPoints => {
    const x = i * (slot + gap) + slot / 2;
    const half = (slot * widthFactor) / 2;
    if (o.uniformWidth) {
      const h = notchDepth / 2;
      return [r3(x - half), r3(cy - h), r3(x + half), r3(cy - h), r3(x + half), r3(cy + h), r3(x - half), r3(cy + h)];
    }
    const inner = half * (innerOffset / outerOffset);
    return [r3(x - half), r3(cy - outerOffset), r3(x + half), r3(cy - outerOffset), r3(x + inner), r3(cy + outerOffset), r3(x - inner), r3(cy + outerOffset)];
  });
  return { cornerDepth: o.uniformWidth ? notchDepth : outerOffset * 2, points };
};

/** An outside ruler's label font size (px). */
export const rulerFontSize = (size: number): number => Math.max(9, size * 0.034);

/** Whether a ruler draws labels, and which. */
export const rulerLabelsOf = (labels: GaugeRulerOptions["labels"]): { readonly show?: "majors" | "ends"; readonly min?: number; readonly max?: number; readonly format?: (v: number) => string; readonly color?: string } | null => {
  if (labels === undefined || labels === false) { return null; }
  if (labels === true) { return { show: "majors" }; }
  if (typeof labels === "string") { return { show: labels }; }
  return labels;
};

/** Radial room an outside ruler takes beyond the track (px). */
const rulerOutsideExtent = (o: GaugeRulerOptions, size: number): number =>
  size * ((o.gap ?? 0.028) + (o.majorLength ?? 0.05)) + (rulerLabelsOf(o.labels) === null ? 0 : rulerFontSize(size) * 1.8);

/** Radial room a progress ring takes beyond the track (px). */
const ringExtent = (o: GaugeProgressRingOptions, size: number): number => size * ((o.gap ?? 0.022) + (o.width ?? 0.01));

export interface ArcLayoutInput {
  readonly size: number;
  readonly ruler: GaugeRulerOptions | null;
  readonly ring: GaugeProgressRingOptions | null;
  readonly zones: readonly GaugeZone[] | undefined;
  readonly zoneDisplay: GaugeZoneDisplay;
  readonly notchLengthPercent: number;
  readonly arcStyle: GaugeArcStyle;
  readonly arcThickness: number;
  readonly needleTip: GaugeNeedleOptions["tip"];
}

export interface ArcLayout {
  readonly outerRadius: number;
  readonly innerRadius: number;
  readonly notchLength: number;
  readonly solidThickness: number;
  readonly showZoneBand: boolean;
  /** The zones the fill takes its colour from (`zoneDisplay` fill or both). */
  readonly zoneFill: readonly GaugeZone[] | undefined;
  readonly rulerOutside: boolean;
  readonly ringRadius: number;
  readonly zoneBandRadius: number;
  readonly outsideRulerAnchor: number;
  readonly dotsRadius: number;
  readonly needleReach: number;
}

/** bklit's `computeArcLayout`: the radius of every arc layer. */
export const arcLayout = (o: ArcLayoutInput): ArcLayout => {
  const { size } = o;
  const rulerOutside = o.ruler?.position === "outside";
  const hasZones = o.zones !== undefined && o.zones.length > 0;
  const showZoneBand = hasZones && o.zoneDisplay !== "fill";
  const zoneFill = hasZones && o.zoneDisplay !== "band" ? o.zones : undefined;
  const zoneBandExtent = showZoneBand ? size * (0.02 + ZONE_BAND_WIDTH) : 0;
  const ring = o.ring === null ? 0 : ringExtent(o.ring, size);
  const rulerExtent = rulerOutside && o.ruler !== null ? rulerOutsideExtent(o.ruler, size) : 0;
  const outsideReserve = ring + zoneBandExtent + rulerExtent;
  const outerRadius = (outsideReserve > 0 ? size * 0.47 : size * 0.42) - outsideReserve;
  const notchLength = (outerRadius / 3) * (clamp(o.notchLengthPercent, 5, 100) / 100);
  const solidThickness = size * o.arcThickness;
  const depth = { none: 0, notches: notchLength, solid: solidThickness } as const;
  const innerRadius = outerRadius - depth[o.arcStyle];
  const ringWidth = size * (o.ring?.width ?? 0.01);
  const insideRulerDepth = o.ruler !== null && !rulerOutside ? size * ((o.ruler.gap ?? 0.028) + (o.ruler.majorLength ?? 0.05) + 0.02) : 0;
  const reach = { edge: outerRadius + outsideReserve, inner: innerRadius - size * 0.014, outer: outerRadius } as const;
  return {
    dotsRadius: innerRadius - size * 0.03 - insideRulerDepth,
    innerRadius,
    needleReach: reach[o.needleTip ?? "inner"],
    notchLength,
    outerRadius,
    outsideRulerAnchor: outerRadius + ring + zoneBandExtent,
    ringRadius: outerRadius + size * (o.ring?.gap ?? 0.022) + ringWidth / 2,
    rulerOutside,
    showZoneBand,
    solidThickness,
    zoneBandRadius: outerRadius + ring + size * (0.02 + ZONE_BAND_WIDTH / 2),
    zoneFill,
  };
};
