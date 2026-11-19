export interface TrendPoint {
  x: number;
  y: number;
}

/** `y = slope * x + intercept`. */
export interface LinearRegression {
  slope: number;
  intercept: number;
}

/** Fitted segment endpoints in data space (regression x units, then the value). */
export interface TrendSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Ordinary least-squares fit `y = slope * x + intercept`. Non-finite points are skipped; `null` for fewer than two finite points or
 * no x variance (a single x). Mean-centred in one pass of sums, so epoch-millisecond x values keep their precision.
 */
export function computeLinearRegression(points: readonly TrendPoint[]): LinearRegression | null {
  let n = 0;
  let sumX = 0;
  let sumY = 0;
  for (const { x, y } of points) {
    if (Number.isFinite(x) && Number.isFinite(y)) {
      n += 1;
      sumX += x;
      sumY += y;
    }
  }
  if (n < 2) {
    return null;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  let covXY = 0;
  let varX = 0;
  for (const { x, y } of points) {
    if (Number.isFinite(x) && Number.isFinite(y)) {
      const dx = x - meanX;
      covXY += dx * (y - meanY);
      varX += dx * dx;
    }
  }
  if (varX === 0) {
    return null;
  }
  const slope = covXY / varX;
  return { slope, intercept: meanY - slope * meanX };
}

/** The regression line evaluated at the smallest and largest finite x of `points`; `null` when there is no fit. */
export function computeTrendSegment(points: readonly TrendPoint[]): TrendSegment | null {
  const fit = computeLinearRegression(points);
  if (!fit) {
    return null;
  }
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  for (const { x, y } of points) {
    if (Number.isFinite(x) && Number.isFinite(y)) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }
  }
  return { x1: minX, y1: fit.slope * minX + fit.intercept, x2: maxX, y2: fit.slope * maxX + fit.intercept };
}

/** Linear blend between two segments (`t` in 0..1). */
export function interpolateTrendSegment(from: Readonly<TrendSegment>, to: Readonly<TrendSegment>, t: number): TrendSegment {
  return {
    x1: from.x1 + (to.x1 - from.x1) * t,
    y1: from.y1 + (to.y1 - from.y1) * t,
    x2: from.x2 + (to.x2 - from.x2) * t,
    y2: from.y2 + (to.y2 - from.y2) * t,
  };
}
