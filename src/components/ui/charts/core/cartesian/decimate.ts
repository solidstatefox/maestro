import { isNumber } from "../guards";
import { windowRows } from "./domains";
import type { CartesianInput } from "./input";
import type { Row } from "./series";

/** bklit decimate-time-series.ts:89-91: ~1.5 points per pixel, never below 64. */
function maxRenderPointsForWidth(innerWidth: number): number {
  return Math.max(64, Math.ceil(innerWidth * 1.5));
}

/** bklit decimate-time-series.ts:17-33: the mean of `valueKeys` (the row's first number without keys, else its index). */
function yOf(valueKeys: readonly string[], point: Row, index: number): number {
  if (valueKeys.length === 0) {
    return Object.values(point).find(isNumber) ?? index;
  }
  // bklit's flatMap and reduce, without an array per row: the same sum, in the same order.
  let sum = 0;
  let count = 0;
  for (const key of valueKeys) {
    const value = point[key];
    if (isNumber(value)) {
      sum += value;
      count += 1;
    }
  }
  return count > 0 ? sum / count : index;
}

interface Mean {
  readonly x: number;
  readonly y: number;
}

/** bklit decimate-time-series.ts:42-65: the next bucket's mean point (the last row when it is empty). */
function nextAverage(len: number, from: number, to: number, y: (index: number) => number): Mean {
  if (to <= from) {
    return { x: len - 1, y: y(len - 1) };
  }
  let sumX = 0;
  let sumY = 0;
  for (let j = from; j < to; j += 1) {
    sumX += j;
    sumY += y(j);
  }
  return { x: sumX / (to - from), y: sumY / (to - from) };
}

/** bklit decimate-time-series.ts:7-85: Largest-Triangle-Three-Buckets over the mean of `valueKeys`; keeps the first and last row. Rows are returned by reference. */
function decimateTimeSeries(data: readonly Row[], maxPoints: number, valueKeys: readonly string[] = []): readonly Row[] {
  const len = data.length;
  if (maxPoints >= len || maxPoints < 3) {
    return data;
  }
  // Each row's y once (the buckets read most rows three times).
  const ys = new Float64Array(len);
  for (let i = 0; i < len; i += 1) {
    ys[i] = yOf(valueKeys, data[i] ?? {}, i);
  }
  const y = (index: number): number => ys[index];
  const bucketSize = (len - 2) / (maxPoints - 2);
  const picked: number[] = [0];
  let previous = 0;
  for (let i = 0; i < maxPoints - 2; i += 1) {
    const rangeStart = Math.floor((i + 1) * bucketSize) + 1;
    const rangeEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, len - 1);
    const next = nextAverage(len, rangeStart, Math.min(Math.floor((i + 3) * bucketSize) + 1, len), y);
    const ay = y(previous);
    let maxArea = -1;
    let maxIndex = rangeStart;
    for (let j = rangeStart; j < rangeEnd; j += 1) {
      const area = Math.abs((previous - next.x) * (y(j) - ay) - (previous - j) * (next.y - ay)) * 0.5;
      if (area > maxArea) {
        maxArea = area;
        maxIndex = j;
      }
    }
    picked.push(maxIndex);
    previous = maxIndex;
  }
  picked.push(len - 1);
  return picked.map((index) => data[index]);
}

interface RowSets {
  readonly rows: readonly Row[];
  readonly drawRows: readonly Row[];
  /** What the line / area paths draw: with a window, the whole decimated series (bklit time-series-chart-shell.tsx:294-297), so a window change keeps the path topology and morphs. */
  readonly pathRows: readonly Row[];
}

/** `rows`: the rows in the brushed window, the source of the y domain. `drawRows`: what the marks draw, `data` LTTB-decimated past max(64, 1.5 x innerWidth)
 * (bklit time-series-chart-shell.tsx:309-315) and then windowed. `pathRows`: the line / area rows. Nothing is cut before the plot is measured (a 0 width would reduce a chart to 64 rows for one render). */
export function rowSets(input: CartesianInput): RowSets {
  const { data, xKey, xDomain, innerWidth } = input;
  const rows = windowRows(data, xKey, xDomain);
  if (innerWidth === undefined || innerWidth <= 0) {
    return { rows, drawRows: rows, pathRows: data };
  }
  const keys = input.series.map((s) => s.dataKey);
  const decimated = decimateTimeSeries(data, maxRenderPointsForWidth(innerWidth), keys);
  const drawRows = windowRows(decimated, xKey, xDomain);
  return { rows, drawRows, pathRows: xDomain ? decimated : drawRows };
}
