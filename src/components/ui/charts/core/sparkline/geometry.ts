import type { SparklineDataKey, SparklinePadding } from "../types/sparkline";

export interface SparklinePoint {
  readonly x: number;
  /** NaN when the source value is missing. */
  readonly y: number;
}

export interface SparklineLayout {
  readonly points: readonly SparklinePoint[];
  /** Pixel y of the baseline (0, clamped into the domain). */
  readonly baselineY: number;
  /** Pixel width of one bar slot (bars only; 0 for line and area). */
  readonly band: number;
}

/** Points sit on a grid (line, area) or in the middle of their bar slot (bars). */
export type SparklineSlot = "point" | "band";

export function resolveSparklinePadding(padding: number | Partial<SparklinePadding> | undefined, fallback: number): SparklinePadding {
  if (typeof padding === "number" || padding === undefined) {
    const p = padding ?? fallback;
    return { top: p, right: p, bottom: p, left: p };
  }
  return {
    top: padding.top ?? fallback,
    right: padding.right ?? fallback,
    bottom: padding.bottom ?? fallback,
    left: padding.left ?? fallback,
  };
}

/** Each row's value; a missing one (`null`, `undefined`, not a number) is NaN. */
export function resolveSparklineValues<T>(data: readonly T[], dataKey: SparklineDataKey<T>): number[] {
  const values = new Array<number>(data.length);
  for (let index = 0; index < data.length; index += 1) {
    const datum = data[index] as T;
    const raw = typeof dataKey === "function" ? dataKey(datum, index) : (datum as Record<PropertyKey, unknown>)[dataKey as PropertyKey];
    values[index] = raw === null || raw === undefined ? Number.NaN : typeof raw === "number" ? raw : Number(raw);
  }
  return values;
}

/** The value domain. Bars always include zero so heights read honestly; line and area hug the data. A flat series is centred. */
export function computeSparklineDomain(values: readonly number[], yMin: number | undefined, yMax: number | undefined, includeZero: boolean): [number, number] {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (Number.isFinite(value)) {
      if (value < min) {
        min = value;
      }
      if (value > max) {
        max = value;
      }
    }
  }
  if (min === Number.POSITIVE_INFINITY) {
    min = 0;
    max = 0;
  }
  if (includeZero) {
    min = Math.min(min, 0);
    max = Math.max(max, 0);
  }
  min = yMin ?? min;
  max = yMax ?? max;
  return min === max ? [min - 1, max + 1] : [min, max];
}

export function computeSparklineLayout(
  values: readonly number[],
  width: number,
  height: number,
  padding: SparklinePadding,
  domain: readonly [number, number],
  slot: SparklineSlot,
): SparklineLayout {
  const innerWidth = Math.max(0, width - padding.left - padding.right);
  const innerHeight = Math.max(0, height - padding.top - padding.bottom);
  const [d0, d1] = domain;
  const scale = innerHeight / (d1 - d0);
  const bottom = padding.top + innerHeight;
  const n = values.length;
  const band = slot === "band" && n > 0 ? innerWidth / n : 0;
  const step = n > 1 ? innerWidth / (n - 1) : 0;
  const points = new Array<SparklinePoint>(n);
  for (let i = 0; i < n; i += 1) {
    const value = values[i] as number;
    points[i] = {
      x: slot === "band" ? padding.left + band * (i + 0.5) : padding.left + (n > 1 ? step * i : innerWidth / 2),
      y: Number.isFinite(value) ? bottom - (value - d0) * scale : Number.NaN,
    };
  }
  return { points, baselineY: bottom - (Math.min(Math.max(0, d0), d1) - d0) * scale, band };
}

/** Whether two layouts draw the same shape (a re-created `data` array with the same values). */
export function sameSparklineShape(a: SparklineLayout, b: SparklineLayout): boolean {
  if (a === b) {
    return true;
  }
  if (a.points.length !== b.points.length || a.baselineY !== b.baselineY || a.band !== b.band) {
    return false;
  }
  for (let i = 0; i < a.points.length; i += 1) {
    const p = a.points[i] as SparklinePoint;
    const q = b.points[i] as SparklinePoint;
    if (p.x !== q.x || !Object.is(p.y, q.y)) {
      return false;
    }
  }
  return true;
}

/** Nearest data index for a pointer x position (in the sparkline's pixels). */
export function sparklineIndexAtX(x: number, count: number, width: number, padding: SparklinePadding, slot: SparklineSlot): number | null {
  if (count === 0) {
    return null;
  }
  const innerWidth = width - padding.left - padding.right;
  if (innerWidth <= 0) {
    return 0;
  }
  const t = (x - padding.left) / innerWidth;
  const raw = slot === "band" ? Math.floor(t * count) : Math.round(t * (count - 1));
  return Math.min(count - 1, Math.max(0, raw));
}

let compact: Intl.NumberFormat | undefined;
/** 3.1K, 4.2M (one formatter for every sparkline, made on first use). */
export const formatSparklineCompact = (value: number): string => {
  compact ??= new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
  return compact.format(value);
};

/** Screen-reader summary, e.g. "12 points, from 3.1K to 4.2K, up 35%". */
export function describeSparkline(values: readonly number[]): string {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) {
    return "No data";
  }
  const first = finite[0] as number;
  const last = finite.at(-1) as number;
  let summary = `${finite.length} points, from ${formatSparklineCompact(first)} to ${formatSparklineCompact(last)}`;
  if (first !== 0) {
    const change = ((last - first) / Math.abs(first)) * 100;
    summary += `, ${change >= 0 ? "up" : "down"} ${Math.abs(Math.round(change))}%`;
  }
  return summary;
}

/**
 * Tween frame between two layouts. Points take the target x; the previous shape is resampled onto the target grid so series of
 * different lengths rise and fall into place. Missing values snap.
 */
export function interpolateSparklineLayout(from: SparklineLayout, to: SparklineLayout, t: number): SparklineLayout {
  const m = from.points.length;
  const n = to.points.length;
  const fromYAt = (i: number): number => {
    if (m === 0) {
      return Number.NaN;
    }
    if (m === n) {
      return from.points[i]?.y ?? Number.NaN;
    }
    const position = n > 1 ? (i / (n - 1)) * (m - 1) : 0;
    const lo = Math.floor(position);
    const a = from.points[lo]?.y ?? Number.NaN;
    const b = from.points[Math.min(m - 1, lo + 1)]?.y ?? Number.NaN;
    return a + (b - a) * (position - lo);
  };
  const points = new Array<SparklinePoint>(n);
  for (let i = 0; i < n; i += 1) {
    const point = to.points[i] as SparklinePoint;
    const fromY = fromYAt(i);
    points[i] = Number.isFinite(fromY) && Number.isFinite(point.y) ? { x: point.x, y: fromY + (point.y - fromY) * t } : point;
  }
  return { points, baselineY: from.baselineY + (to.baselineY - from.baselineY) * t, band: to.band };
}
