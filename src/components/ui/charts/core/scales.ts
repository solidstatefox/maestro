import type { ScaleLinear, ScaleTime } from "d3-scale";
import { tickIncrement, ticks, timeTickInterval, timeTicks } from "./scale-ticks";

/**
 * Two-point numeric and temporal scales with d3-scale's call, `domain`, `range`, `invert`, `ticks`, `nice`, `copy`, `clamp`,
 * `unknown` and `rangeRound` behaviour. d3-scale's `scaleLinear`/`scaleTime` also bundle color interpolation, d3-format and
 * d3-time-format (about 25 KB min) for `interpolate` and `tickFormat`, which no chart here uses: every axis passes explicit
 * tick formatters. Accepted divergences from d3-scale: no `tickFormat`, no `interpolate`, and domains and ranges are two-point
 * (every scale in the kit is).
 */

type Kind = "linear" | "time" | "utc";

function create(kind: Kind, initial: [number, number], initialRange: [number, number]) {
  let [d0, d1] = initial;
  let [r0, r1] = initialRange;
  let clamped = false;
  let rounded = false;
  let unknownValue: number | undefined;
  const temporal = kind !== "linear";

  const normalize = (x: number, a: number, b: number) => (b - a ? (x - a) / (b - a) : Number.isNaN(b - a) ? Number.NaN : 0.5);
  const clampX = (x: number) => (clamped ? Math.max(Math.min(d0, d1), Math.min(Math.max(d0, d1), x)) : x);
  const toNumber = (value: unknown) => (value instanceof Date ? +value : temporal ? +new Date(+(value as number)) : +(value as number));
  const present = (t: number) => (temporal ? new Date(t) : t);
  // d3-scale `continuous.js` bimap: a descending input interval is normalized and interpolated reversed, which keeps its rounding.
  const map = (x: number, a0: number, a1: number, b0: number, b1: number, round: boolean) => {
    const [from0, from1, to0, to1] = a1 < a0 ? [a1, a0, b1, b0] : [a0, a1, b0, b1];
    const t = normalize(x, from0, from1);
    const v = to0 * (1 - t) + to1 * t;
    return round ? Math.round(v) : v;
  };

  const scale = (x: unknown): number | undefined => {
    const v = x == null ? Number.NaN : +(x as number);
    return Number.isNaN(v) ? unknownValue : map(clampX(v), d0, d1, r0, r1, rounded);
  };
  scale.invert = (y: number) => present(clampX(map(y, r0, r1, d0, d1, false)));
  scale.domain = (...args: [ArrayLike<unknown>?]) => {
    if (args.length === 0) return [present(d0), present(d1)];
    d0 = toNumber(args[0]![0]);
    d1 = toNumber(args[0]![1]);
    return scale;
  };
  scale.range = (...args: [ArrayLike<number>?]) => {
    if (args.length === 0) return [r0, r1];
    r0 = args[0]![0];
    r1 = args[0]![1];
    return scale;
  };
  scale.rangeRound = (value: ArrayLike<number>) => {
    r0 = value[0];
    r1 = value[1];
    rounded = true;
    return scale;
  };
  scale.clamp = (...args: [boolean?]) => {
    if (args.length === 0) return clamped;
    clamped = !!args[0];
    return scale;
  };
  scale.unknown = (...args: [number?]) => {
    if (args.length === 0) return unknownValue;
    unknownValue = args[0];
    return scale;
  };
  scale.ticks = (count?: number) => {
    if (kind === "linear") return ticks(d0, d1, count ?? 10);
    return timeTicks(kind === "utc", new Date(d0), new Date(d1), count ?? 10);
  };
  scale.nice = (count?: number) => {
    if (temporal) {
      const interval = timeTickInterval(kind === "utc", d0, d1, count ?? 10);
      if (!interval) return scale;
      // d3-scale `nice.js`: floor the lower end and ceil the upper end of the (possibly reversed) domain.
      if (d1 < d0) [d0, d1] = [interval.ceil(d0), interval.floor(d1)];
      else [d0, d1] = [interval.floor(d0), interval.ceil(d1)];
      return scale;
    }
    // d3-scale `linear.js` nice: iterate tickIncrement until the step stops changing.
    let start = Math.min(d0, d1);
    let stop = Math.max(d0, d1);
    let prestep: number | undefined;
    for (let iteration = 0; iteration < 10; iteration++) {
      const step = tickIncrement(start, stop, count ?? 10);
      if (step === prestep) {
        [d0, d1] = d1 < d0 ? [stop, start] : [start, stop];
        return scale;
      }
      if (step > 0) {
        start = Math.floor(start / step) * step;
        stop = Math.ceil(stop / step) * step;
      } else if (step < 0) {
        start = Math.ceil(start * step) / step;
        stop = Math.floor(stop * step) / step;
      } else return scale;
      prestep = step;
    }
    // d3-scale leaves the domain untouched when the step never settles (domains straddling zero at count 1 oscillate).
    return scale;
  };
  scale.copy = () => {
    const next = create(kind, [d0, d1], [r0, r1]);
    next.clamp(clamped);
    next.unknown(unknownValue);
    if (rounded) next.rangeRound([r0, r1]);
    return next;
  };
  return scale;
}

export const scaleLinear = () => create("linear", [0, 1], [0, 1]) as unknown as ScaleLinear<number, number>;
export const scaleTime = () => create("time", [+new Date(2000, 0, 1), +new Date(2000, 0, 2)], [0, 1]) as unknown as ScaleTime<number, number>;
export const scaleUtc = () => create("utc", [Date.UTC(2000, 0, 1), Date.UTC(2000, 0, 2)], [0, 1]) as unknown as ScaleTime<number, number>;
