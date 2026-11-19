export const X_WINDOW_MIN_POINTS = 2048;
/** Slack (px) around the nearest column: a point's focus coordinate can differ from its `x` by float noise. */
const SLACK_PX = 1;

interface XPoint {
  readonly x: number;
}

/** The points within `reach` of `x`, in input order (a point without a finite x never is). */
const within = <P extends XPoint>(points: readonly P[], x: number, reach: number): readonly P[] => points.filter((p) => Math.abs(p.x - x) <= reach);

/** For a pointer at `x`: the points of the nearest column(s) and of any column as near (within a pixel's slack), in input order;
 * `points` itself when it is small. A strategy run on the result returns what it returns on `points`. */
export function nearestXWindow<P extends XPoint>(points: readonly P[], x: number): readonly P[] {
  if (points.length < X_WINDOW_MIN_POINTS || !Number.isFinite(x)) {
    return points;
  }
  let best = Number.POSITIVE_INFINITY;
  for (const p of points) {
    best = Math.min(best, Math.abs(p.x - x));
  }
  return Number.isFinite(best) ? within(points, x, best + SLACK_PX) : points;
}

/** The points sharing `point`'s column (within a pixel's slack), in input order; `points` when small. */
export const columnWindow = <P extends XPoint>(points: readonly P[], point: XPoint): readonly P[] =>
  points.length < X_WINDOW_MIN_POINTS || !Number.isFinite(point.x) ? points : within(points, point.x, SLACK_PX);

const navigations = new WeakMap<readonly XPoint[], readonly unknown[]>();

/** A strategy's `navigation` order of a large points array, computed once per array (it sorts every point). */
export function cachedNavigation<P extends XPoint, R extends readonly P[]>(points: readonly P[], navigation: (points: readonly P[]) => R): R {
  if (points.length < X_WINDOW_MIN_POINTS) {
    return navigation(points);
  }
  // SAFETY: stored by this function for this same array, from `navigation(points)`.
  let order = navigations.get(points) as R | undefined;
  if (!order) {
    order = navigation(points);
    navigations.set(points, order);
  }
  return order;
}
