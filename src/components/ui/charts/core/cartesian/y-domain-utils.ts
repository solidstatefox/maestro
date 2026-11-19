import type { ScaleLinear } from "d3-scale";
import type { ChartPhase } from "../motion/phase";
import type { LineConfig } from "../types/context";
import { niced } from "./domains";
import { axisId } from "./series";

/** @internal */
export type YDomain = [number, number];

/** bklit chart-phase.ts Y_DOMAIN_TWEEN_SKIP_THRESHOLD: a y domain that moves less than this share of its span snaps. */
const Y_DOMAIN_TWEEN_SKIP_THRESHOLD = 0.02;

/**
 * A per-axis y-domain override (ComposedChart, LineChart and AreaChart `yDomains`): a fixed `[min, max]`, or a function of the auto
 * domain (before it is niced) returning the one to use, e.g. `([, max]) => [0, max * 3]` to push volume bars into the bottom third.
 */
export type YDomainOverride = YDomain | ((auto: YDomain) => YDomain);

/** The auto domain with an axis' override applied (none: the auto domain). */
export function applyYDomainOverride(auto: YDomain, override: YDomainOverride | undefined): YDomain {
  if (!override) {
    return auto;
  }
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- bklit's public `YDomain | function` union, discriminated at its only boundary.
  return typeof override === "function" ? override([auto[0], auto[1]]) : [override[0], override[1]];
}

/**
 * Floating y domain (no zero anchor): min..max of every numeric `dataKeys` value, padded 5% (1 for a flat series), `[0, 100]` padded
 * when nothing is numeric. For price-like series such as candlesticks, where a zero baseline would flatten every candle.
 */
export function resolveFloatingYDomain(data: readonly Readonly<Record<string, unknown>>[], dataKeys: readonly string[]): YDomain {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const row of data) {
    for (const key of dataKeys) {
      const value = row[key];
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- rows are untyped user data; this is the one boundary parse.
      if (typeof value === "number" && Number.isFinite(value)) {
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
    }
  }
  if (min === Number.POSITIVE_INFINITY) {
    min = 0;
    max = 100;
  }
  const pad = (max - min) * 0.05 || 1;
  return [min - pad, max + pad];
}

/** @internal */
export const niceYDomain = (domain: YDomain): YDomain => niced(domain);

/**
 * Whether a y domain moves by at least the skip threshold (relative to the larger span).
 * @internal
 */
export function shouldTweenYDomain(from: Readonly<YDomain>, to: Readonly<YDomain>): boolean {
  const span = Math.max(Math.abs(to[1] - to[0]), Math.abs(from[1] - from[0]), 1);
  return Math.abs(to[0] - from[0]) / span >= Y_DOMAIN_TWEEN_SKIP_THRESHOLD || Math.abs(to[1] - from[1]) / span >= Y_DOMAIN_TWEEN_SKIP_THRESHOLD;
}

/** @internal */
export const isLoadingChromePhase = (phase: ChartPhase): boolean => phase === "loading" || phase === "revealingLoading";

/** @internal */
export const isYDomainTweenPhase = (phase: ChartPhase): boolean => phase === "gridTweenLoading" || phase === "gridTweenReady";

/**
 * Merge domain maps, normalising axis ids to strings.
 * @internal
 */
export function mergeYDomainRecords(...records: readonly Readonly<Record<string, YDomain>>[]): Record<string, YDomain> {
  const merged: Record<string, YDomain> = {};
  for (const record of records) {
    for (const [id, domain] of Object.entries(record)) {
      merged[axisId(id)] = domain;
    }
  }
  return merged;
}

/**
 * Niced y domain per axis id; `left` always exists.
 * @internal
 */
export function computeYDomainsByAxis({ lines, resolveDomain }: { readonly lines: readonly LineConfig[]; readonly resolveDomain: (dataKeys: string[]) => YDomain }): Record<string, YDomain> {
  const keysByAxis = new Map<string, string[]>();
  for (const line of lines) {
    const id = axisId(line.yAxisId);
    keysByAxis.set(id, [...(keysByAxis.get(id) ?? []), line.dataKey]);
  }
  const domains: Record<string, YDomain> = {};
  for (const [id, keys] of keysByAxis) {
    domains[id] = niceYDomain(resolveDomain(keys));
  }
  domains.left ??= niceYDomain([0, 100]);
  return domains;
}

/**
 * The primary (`left`) y scale, else the first one, else `fallback`.
 * @internal
 */
export function getPrimaryYScale<T extends ScaleLinear<number, number>>(yScales: Readonly<Record<string, T>>, fallback: T): T {
  return yScales.left ?? Object.values(yScales)[0] ?? fallback;
}
