import { maxOf, minOf } from "../range";
import { scaleLinear } from "../scales";
import { DEFAULT_Y_AXIS_ID, toDate } from "./series";
import type { ResolvedSeries, Row } from "./series";

/** Width of the x domain around a lone time: a zero-width domain collapses everything onto one pixel (d3 centres it), so bars have no width. The point stays centred. */
export const SINGLE_TIME_SPAN_MS = 86_400_000;

/** A cell's number; a missing one (`null`, `undefined`, `""`) is NaN, so a line breaks there instead of dropping to zero (withBollingerBands' warm-up rows). */
export const toNumber = (value: unknown): number => {
  if (value === null || value === undefined || value === "") {
    return Number.NaN;
  }
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : Number.NaN;
};

/** bklit builds every y scale with visx `nice: true` (d3 `.nice()`, count 10). */
export const niced = (domain: readonly [number, number]): [number, number] => {
  const [lo, hi] = scaleLinear().domain(domain).nice().domain();
  return [lo, hi];
};

/** bklit's auto y domain before `nice()` (resolveTimeSeriesYDomain): [0, max*1.1] for non-negative data, else 5% padded; null without a number. */
export function rawYDomain(values: readonly number[]): [number, number] | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    if (Number.isFinite(v)) {
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
  }
  if (!Number.isFinite(min)) {
    return null;
  }
  if (min >= 0) {
    return [0, max <= 0 ? 100 : max * 1.1];
  }
  const pad = (max - min) * 0.05 || 1;
  return [min - pad, max + pad];
}

/** A per-axis `yDomains` override (y-domain-utils.ts `YDomainOverride`, typed loosely here to keep this module free of it). */
type Override = readonly [number, number] | ((auto: [number, number]) => readonly [number, number]);

/** An auto domain with the axis' override applied (bklit applyYDomainOverride, before nice), niced; an override that returns no usable span keeps the auto domain. */
function overridden(auto: [number, number], override: Override): [number, number] {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- bklit's public `YDomain | function` union, discriminated at its only boundary.
  const next = typeof override === "function" ? override([auto[0], auto[1]]) : override;
  const lo = Number(next[0]);
  const hi = Number(next[1]);
  return Number.isFinite(lo) && Number.isFinite(hi) && hi !== lo ? niced([Math.min(lo, hi), Math.max(lo, hi)]) : niced(auto);
}

/** bklit's y-domain rule: the auto domain, the axis' override applied (bklit applyYDomainOverride, before nice), niced; [0, 100] without a number and an override. */
export function bklitYDomain(values: readonly number[], override?: Override): [number, number] {
  const raw = rawYDomain(values);
  if (override === undefined) {
    return raw === null ? [0, 100] : niced(raw);
  }
  return overridden(raw ?? [0, 100], override);
}

/** bklit `resolveFloatingYDomain` on values, niced like every y scale: min..max padded 5% (1 when flat), not anchored at zero; the override as in `bklitYDomain`. */
function floatingYDomain(values: readonly number[], override?: Override): [number, number] {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) {
    return bklitYDomain(finite, override);
  }
  const lo = minOf(finite);
  const hi = maxOf(finite);
  const pad = (hi - lo) * 0.05 || 1;
  const auto: [number, number] = [lo - pad, hi + pad];
  return override === undefined ? niced(auto) : overridden(auto, override);
}

/** Rows visible in the (optional) brushed window, plus one neighbour each side so paths reach the edge. */
export function windowRows(data: readonly Row[], xKey: string, domain: readonly [Date, Date] | undefined): readonly Row[] {
  if (!domain) {
    return data;
  }
  const lo = domain[0].getTime();
  const hi = domain[1].getTime();
  const out: Row[] = [];
  for (let i = 0; i < data.length; i += 1) {
    const t = toDate(data[i]?.[xKey]).getTime();
    const next = toDate(data[i + 1]?.[xKey]).getTime();
    const prev = toDate(data[i - 1]?.[xKey]).getTime();
    if ((t >= lo && t <= hi) || (next >= lo && t < lo) || (prev <= hi && t > hi)) {
      const row = data[i];
      if (row) {
        out.push(row);
      }
    }
  }
  return out;
}

export function strictRows(rows: readonly Row[], xKey: string, domain: readonly [Date, Date]): Row[] {
  const lo = Math.min(domain[0].getTime(), domain[1].getTime());
  const hi = Math.max(domain[0].getTime(), domain[1].getTime());
  return rows.filter((row) => {
    const t = toDate(row[xKey]).getTime();
    return t >= lo && t <= hi;
  });
}

export function dataExtent(data: readonly Row[], xKey: string, extra: readonly Date[]): [Date, Date] | undefined {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const row of data) {
    const t = toDate(row[xKey]).getTime();
    lo = Math.min(lo, t);
    hi = Math.max(hi, t);
  }
  for (const d of extra) {
    lo = Math.min(lo, d.getTime());
    hi = Math.max(hi, d.getTime());
  }
  if (lo === hi) {
    return [new Date(lo - SINGLE_TIME_SPAN_MS / 2), new Date(hi + SINGLE_TIME_SPAN_MS / 2)];
  }
  return Number.isFinite(lo) ? [new Date(lo), new Date(hi)] : undefined;
}

interface YDomainInput {
  readonly series: readonly ResolvedSeries[];
  readonly rows: readonly Row[];
  readonly extraYValues: readonly number[];
  readonly overlayYValues: readonly number[];
  readonly projectionYValues: ReadonlyMap<string, readonly number[]>;
  /** Band edge values per axis (range-overlays.ts): they widen the domain before it is niced, as a series' values do. */
  readonly rangeYValues?: ReadonlyMap<string, readonly number[]>;
  readonly yDomainFrom: Readonly<Record<string, readonly [number, number]>> | undefined;
  /** The chart's `yDomains`: per-axis overrides of the auto domain. */
  readonly overrides?: Readonly<Record<string, Override>>;
  /** Values of marks the series list does not describe, by axis id (composed bars, scatters and candles on their own axes). */
  readonly extraYByAxis?: ReadonlyMap<string, readonly number[]>;
  /** Axes whose domain floats around their values instead of anchoring at zero (a composed Candlestick's). */
  readonly floatingAxes?: ReadonlySet<string>;
  readonly yScaleDomainMax?: number;
}

interface ResolvedYDomains {
  readonly yDomains: Map<string, [number, number]>;
  readonly targetY: Record<string, [number, number]>;
}

/** One y domain per axis id, plus the data-resolved `targetY` (differs from the returned map only in the "snap" step). */
export function resolveYDomains(input: YDomainInput): ResolvedYDomains {
  const valuesByAxis = new Map<string, number[]>();
  for (const s of input.series) {
    const list = valuesByAxis.get(s.yAxisId) ?? [];
    for (const row of input.rows) {
      list.push(toNumber(row[s.dataKey]));
    }
    valuesByAxis.set(s.yAxisId, list);
  }
  for (const [id, values] of input.rangeYValues ?? []) {
    valuesByAxis.set(id, [...(valuesByAxis.get(id) ?? []), ...values]);
  }
  const primaryValues = valuesByAxis.get(DEFAULT_Y_AXIS_ID) ?? [];
  primaryValues.push(...input.extraYValues, ...input.overlayYValues);
  if (!valuesByAxis.has(DEFAULT_Y_AXIS_ID)) {
    valuesByAxis.set(DEFAULT_Y_AXIS_ID, primaryValues);
  }
  for (const [id, values] of input.extraYByAxis ?? []) {
    const list = valuesByAxis.get(id) ?? [];
    list.push(...values);
    valuesByAxis.set(id, list);
  }
  const yDomains = new Map(
    [...valuesByAxis].map(([id, values]) => [id, input.floatingAxes?.has(id) === true ? floatingYDomain(values, input.overrides?.[id]) : bklitYDomain(values, input.overrides?.[id])] as const),
  );
  // bklit resolveTimeSeriesYDomain: a fixed top on a single-axis chart, [0, max × 1.1] (niced by the scale like every other domain); a `yDomains` override wins.
  const fixedTop = input.yScaleDomainMax;
  if (fixedTop !== undefined && fixedTop > 0 && valuesByAxis.size === 1 && valuesByAxis.has(DEFAULT_Y_AXIS_ID) && input.overrides?.[DEFAULT_Y_AXIS_ID] === undefined) {
    yDomains.set(DEFAULT_Y_AXIS_ID, niced([0, fixedTop * 1.1]));
  }
  // bklit mergeProjectionYDomain: the niced data domain is widened by the projection extent and NOT re-niced
  // ([0, max(niceTop, projMax) * 1.1] for non-negative data), so ticks no longer land on the plot edges.
  for (const [id, projected] of input.projectionYValues) {
    const [min, max] = yDomains.get(id) ?? [0, 100];
    const pMin = minOf(projected);
    const pMax = maxOf(projected);
    const nextMin = Math.min(min, pMin);
    const nextMax = Math.max(max, pMax);
    const pad = (nextMax - nextMin) * 0.05 || 1;
    yDomains.set(id, nextMin >= 0 && min >= 0 ? [0, nextMax <= 0 ? 100 : nextMax * 1.1] : [nextMin - pad, nextMax + pad]);
  }
  // Step "snap": the previous domains are kept while the new data lands (the glide step moves them).
  const targetY = Object.fromEntries(yDomains);
  if (input.yDomainFrom) {
    for (const [id, domain] of Object.entries(input.yDomainFrom)) {
      if (yDomains.has(id)) {
        yDomains.set(id, [domain[0], domain[1]]);
      }
    }
  }
  return { yDomains, targetY };
}
