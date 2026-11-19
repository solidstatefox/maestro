import type { ProjectionPoint } from "./projection-utils";

interface ProjectionValueBounds {
  minValue: number;
  maxValue: number;
}

const trackProjectionValue = (bounds: ProjectionValueBounds, value: number): void => {
  if (value < bounds.minValue) {bounds.minValue = value;}
  if (value > bounds.maxValue) {bounds.maxValue = value;}
}

/** @internal */
const projectionValueExtents = (paths: ProjectionPoint[][]): { minValue: number; maxValue: number } | null => {
  const bounds: ProjectionValueBounds = { maxValue: Number.NEGATIVE_INFINITY, minValue: Number.POSITIVE_INFINITY };
  for (const path of paths) {
    for (const point of path) {
      trackProjectionValue(bounds, point.value);
    }
  }
  if (bounds.minValue === Number.POSITIVE_INFINITY) {return null;}
  return { maxValue: bounds.maxValue, minValue: bounds.minValue };
}

interface ProjectionTimeBounds {
  minTime: number;
  maxTime: number;
}

const trackProjectionTime = (bounds: ProjectionTimeBounds, time: number): void => {
  if (time < bounds.minTime) {bounds.minTime = time;}
  if (time > bounds.maxTime) {bounds.maxTime = time;}
}

/** @internal */
const projectionDateExtents = (paths: ProjectionPoint[][]): { minTime: number; maxTime: number } | null => {
  const bounds: ProjectionTimeBounds = { maxTime: Number.NEGATIVE_INFINITY, minTime: Number.POSITIVE_INFINITY };
  for (const path of paths) {
    for (const point of path) {
      trackProjectionTime(bounds, point.date.getTime());
    }
  }
  if (bounds.minTime === Number.POSITIVE_INFINITY) {return null;}
  return { maxTime: bounds.maxTime, minTime: bounds.minTime };
}

export { projectionDateExtents, projectionValueExtents };
