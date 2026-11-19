import type { SparklineCurve } from "../types/sparkline";
import type { SparklineLayout, SparklinePoint } from "./geometry";

const r = (value: number): number => Math.round(value * 100) / 100;

const sign = (x: number): number => (x < 0 ? -1 : 1);

/** d3's monotone slope at the middle of three points (Steffen's method; curve/monotone.js `slope3`). */
const slope3 = (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): number => {
  const h0 = x1 - x0;
  const h1 = x2 - x1;
  const s0 = (y1 - y0) / (h0 || (h1 < 0 ? -0 : 0));
  const s1 = (y2 - y1) / (h1 || (h0 < 0 ? -0 : 0));
  const p = (s0 * h1 + s1 * h0) / (h0 + h1);
  return (sign(s0) + sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0;
};

/** d3's one-sided slope at an end (curve/monotone.js `slope2`). */
const slope2 = (x0: number, y0: number, x1: number, y1: number, t: number): number => {
  const h = x1 - x0;
  return h ? ((3 * (y1 - y0)) / h - t) / 2 : t;
};

/** d3's natural cubic spline control points along one axis (curve/natural.js `controlPoints`). */
const controlPoints = (x: readonly number[]): [number[], number[]] => {
  const n = x.length - 1;
  const a = new Array<number>(n);
  const b = new Array<number>(n);
  const c = new Array<number>(n);
  a[0] = 0;
  b[0] = 2;
  c[0] = (x[0] as number) + 2 * (x[1] as number);
  for (let i = 1; i < n - 1; i += 1) {
    a[i] = 1;
    b[i] = 4;
    c[i] = 4 * (x[i] as number) + 2 * (x[i + 1] as number);
  }
  a[n - 1] = 2;
  b[n - 1] = 7;
  c[n - 1] = 8 * (x[n - 1] as number) + (x[n] as number);
  for (let i = 1; i < n; i += 1) {
    const m = (a[i] as number) / (b[i - 1] as number);
    b[i] = (b[i] as number) - m;
    c[i] = (c[i] as number) - m * (c[i - 1] as number);
  }
  a[n - 1] = (c[n - 1] as number) / (b[n - 1] as number);
  for (let i = n - 2; i >= 0; i -= 1) {
    a[i] = ((c[i] as number) - (a[i + 1] as number)) / (b[i] as number);
  }
  b[n - 1] = ((x[n] as number) + (a[n - 1] as number)) / 2;
  for (let i = 0; i < n - 1; i += 1) {
    b[i] = 2 * (x[i + 1] as number) - (a[i + 1] as number);
  }
  return [a, b];
};

/** One run of defined points after its `M`, through `curve` (two or more points). */
const run = (xs: readonly number[], ys: readonly number[], curve: SparklineCurve): string => {
  const n = xs.length;
  let d = "";
  if (curve === "step") {
    for (let i = 1; i < n; i += 1) {
      d += `H${r(((xs[i - 1] as number) + (xs[i] as number)) / 2)}V${r(ys[i] as number)}`;
    }
    return `${d}H${r(xs[n - 1] as number)}`;
  }
  // Two points are a straight segment under every smooth curve (d3 draws a lineTo).
  if (n === 2 || curve === "linear") {
    for (let i = 1; i < n; i += 1) {
      d += `L${r(xs[i] as number)},${r(ys[i] as number)}`;
    }
    return d;
  }
  if (curve === "natural") {
    const [px0, px1] = controlPoints(xs);
    const [py0, py1] = controlPoints(ys);
    for (let i = 0; i < n - 1; i += 1) {
      d += `C${r(px0[i] as number)},${r(py0[i] as number)},${r(px1[i] as number)},${r(py1[i] as number)},${r(xs[i + 1] as number)},${r(ys[i + 1] as number)}`;
    }
    return d;
  }
  // monotone (x): the tangent at every point, then a cubic per segment with its handles a third of the way along x.
  const t = new Array<number>(n);
  for (let i = 1; i < n - 1; i += 1) {
    t[i] = slope3(xs[i - 1] as number, ys[i - 1] as number, xs[i] as number, ys[i] as number, xs[i + 1] as number, ys[i + 1] as number);
  }
  t[0] = slope2(xs[0] as number, ys[0] as number, xs[1] as number, ys[1] as number, t[1] as number);
  t[n - 1] = slope2(xs[n - 2] as number, ys[n - 2] as number, xs[n - 1] as number, ys[n - 1] as number, t[n - 2] as number);
  for (let i = 0; i < n - 1; i += 1) {
    const x0 = xs[i] as number;
    const y0 = ys[i] as number;
    const x1 = xs[i + 1] as number;
    const y1 = ys[i + 1] as number;
    const dx = (x1 - x0) / 3;
    d += `C${r(x0 + dx)},${r(y0 + dx * (t[i] as number))},${r(x1 - dx)},${r(y1 - dx * (t[i + 1] as number))},${r(x1)},${r(y1)}`;
  }
  return d;
};

/** Each run of defined points (a missing value breaks the line), as `[xs, ys]`; d3 skips a point repeating the one before it. */
const runs = (points: readonly SparklinePoint[]): [number[], number[]][] => {
  const out: [number[], number[]][] = [];
  let xs: number[] = [];
  let ys: number[] = [];
  for (const point of points) {
    if (Number.isFinite(point.y)) {
      if (xs.length === 0 || point.x !== xs.at(-1) || point.y !== ys.at(-1)) {
        xs.push(point.x);
        ys.push(point.y);
      }
    } else if (xs.length > 0) {
      out.push([xs, ys]);
      xs = [];
      ys = [];
    }
  }
  if (xs.length > 0) {
    out.push([xs, ys]);
  }
  return out;
};

export function sparklineLinePath(points: readonly SparklinePoint[], curve: SparklineCurve): string {
  let d = "";
  for (const [xs, ys] of runs(points)) {
    d += `M${r(xs[0] as number)},${r(ys[0] as number)}${xs.length === 1 ? "Z" : run(xs, ys, curve)}`;
  }
  return d;
}

/** The line closed down to the baseline: d3's area() with a constant `y0`, whose return along the baseline is a straight line. */
export function sparklineAreaPath(points: readonly SparklinePoint[], curve: SparklineCurve, baselineY: number): string {
  const base = r(baselineY);
  let d = "";
  for (const [xs, ys] of runs(points)) {
    const x0 = r(xs[0] as number);
    d += `M${x0},${r(ys[0] as number)}${xs.length === 1 ? "" : run(xs, ys, curve)}L${r(xs.at(-1) as number)},${base}L${x0},${base}Z`;
  }
  return d;
}

/** One bar as a path segment, rounding the corners away from the baseline. */
export function sparklineBarSegment(cx: number, barWidth: number, y: number, baselineY: number, radius: number): string {
  const height = Math.abs(baselineY - y);
  if (height === 0 || barWidth <= 0) {
    return "";
  }
  const x0 = r(cx - barWidth / 2);
  const x1 = r(cx + barWidth / 2);
  const corner = Math.min(radius, barWidth / 2, height);
  const tip = r(y);
  const base = r(baselineY);
  if (corner <= 0) {
    return `M${x0},${base}V${tip}H${x1}V${base}Z`;
  }
  const up = y < baselineY;
  const shoulder = r(tip + (up ? corner : -corner));
  const rr = r(corner);
  const sweep = up ? 1 : 0;
  return `M${x0},${base}V${shoulder}A${rr},${rr} 0 0 ${sweep} ${r(x0 + corner)},${tip}H${r(x1 - corner)}A${rr},${rr} 0 0 ${sweep} ${x1},${shoulder}V${base}Z`;
}

export const sparklineBarWidth = (band: number, gap: number): number => Math.max(1, band - gap);

/** Every bar as one path: one DOM node whatever the point count. */
export function sparklineBarsPath(layout: SparklineLayout, gap: number, radius: number): string {
  const barWidth = sparklineBarWidth(layout.band, gap);
  let d = "";
  for (const point of layout.points) {
    if (Number.isFinite(point.y)) {
      d += sparklineBarSegment(point.x, barWidth, point.y, layout.baselineY, radius);
    }
  }
  return d;
}
