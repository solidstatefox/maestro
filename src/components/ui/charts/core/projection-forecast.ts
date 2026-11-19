import type { ProjectionAutoMethod, ProjectionPathDensity, ProjectionPoint } from "./projection-utils";

interface HistoryPoint {
  readonly timeMs: number;
  readonly value: number;
}

// Offset of the second-to-last history point (the "previous" point of the last segment).
const PENULTIMATE_OFFSET = -2;

// OLS slope as in bklit projection-utils.ts:114 (no @tanstack/charts/regression, ~4 KB min).
const linearRegressionSlope = (points: readonly HistoryPoint[]): number => {
  const n = points.length;
  if (n < 2) {return 0;}
  let sumT = 0;
  let sumV = 0;
  for (const { timeMs, value } of points) {
    sumT += timeMs;
    sumV += value;
  }
  const meanT = sumT / n;
  const meanV = sumV / n;
  let cov = 0;
  let variance = 0;
  for (const { timeMs, value } of points) {
    cov += (timeMs - meanT) * (value - meanV);
    variance += (timeMs - meanT) ** 2;
  }
  return variance === 0 ? 0 : cov / variance;
}

const slopeFromLastSegment = (historyPoints: readonly HistoryPoint[]): number => {
  if (historyPoints.length < 2) {return 0;}
  const prev = historyPoints.at(PENULTIMATE_OFFSET);
  const last = historyPoints.at(-1);
  if (!(prev && last)) {return 0;}
  const deltaMs = last.timeMs - prev.timeMs;
  return deltaMs === 0 ? 0 : (last.value - prev.value) / deltaMs;
}

const resolveAutoSlope = (autoMethod: ProjectionAutoMethod, historyPoints: readonly HistoryPoint[]): number => {
  if (autoMethod === "lastSegment" && historyPoints.length >= 2) {return slopeFromLastSegment(historyPoints);}
  return linearRegressionSlope(historyPoints);
}

interface SteppedProjectionOptions {
  readonly anchorTime: number;
  readonly anchorValue: number;
  readonly slope: number;
  readonly horizonPoints: number;
  readonly intervalMs: number;
}

const buildEndpointProjectionValues = (options: Readonly<SteppedProjectionOptions>): ProjectionPoint[] => {
  const { anchorTime, anchorValue, slope, horizonPoints, intervalMs } = options;
  const endTime = anchorTime + intervalMs * horizonPoints;
  const endValue = anchorValue + slope * intervalMs * horizonPoints;
  return [
    { date: new Date(anchorTime), value: anchorValue },
    { date: new Date(endTime), value: endValue },
  ];
}

const buildSteppedProjectionValues = (options: Readonly<SteppedProjectionOptions>): ProjectionPoint[] => {
  const { anchorTime, anchorValue, slope, horizonPoints, intervalMs } = options;
  const result: ProjectionPoint[] = [{ date: new Date(anchorTime), value: anchorValue }];
  for (let horizonStep = 1; horizonStep <= horizonPoints; horizonStep += 1) {
    result.push({ date: new Date(anchorTime + intervalMs * horizonStep), value: anchorValue + slope * intervalMs * horizonStep });
  }
  return result;
}

interface BuildAutoFutureValuesOptions {
  readonly anchorTime: number;
  readonly anchorValue: number;
  readonly autoMethod: ProjectionAutoMethod;
  readonly historyPoints: readonly HistoryPoint[];
  readonly horizonPoints: number;
  readonly intervalMs: number;
  readonly pathDensity?: ProjectionPathDensity;
}

const buildAutoFutureValues = (options: Readonly<BuildAutoFutureValuesOptions>): ProjectionPoint[] => {
  const { anchorTime, anchorValue, autoMethod, historyPoints, horizonPoints, intervalMs, pathDensity = "endpoints" } = options;
  const slope = resolveAutoSlope(autoMethod, historyPoints);
  if (pathDensity === "endpoints") {
    return buildEndpointProjectionValues({ anchorTime, anchorValue, horizonPoints, intervalMs, slope });
  }
  return buildSteppedProjectionValues({ anchorTime, anchorValue, horizonPoints, intervalMs, slope });
}

export type { HistoryPoint };
export { buildAutoFutureValues, slopeFromLastSegment };
