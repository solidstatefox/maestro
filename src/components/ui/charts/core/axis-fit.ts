import { scaleLinear } from "./scales";

// Tick labels are 12px; a character is about 0.6em, and neighbours keep LABEL_GAP_PX apart.
const LABEL_CHAR_PX = 7.2;
const LABEL_GAP_PX = 12;

/** How many labels as long as the longest of `labels` fit across `length` px (at least one). */
export function labelsThatFit(labels: readonly string[], length: number): number {
  const longest = Math.max(1, ...labels.map((label) => label.length));
  return Math.max(1, Math.floor(length / (longest * LABEL_CHAR_PX + LABEL_GAP_PX)));
}

/** A label's estimated width in px (12px text). */
export const labelWidth = (label: string): number => label.length * LABEL_CHAR_PX;

/**
 * The categories to label along `length` px, one band each: every one when no two neighbours' labels run into each other, else every
 * n-th, evenly, from the first (the fewest dropped that clear), and the last: a waterfall's total, a year's last month. Undefined: all fit.
 */
export function fittingCategories<T>(categories: readonly T[], labels: readonly string[], length: number): T[] | undefined {
  const count = categories.length;
  if (length <= 0 || count < 2) {
    return undefined;
  }
  const pitch = length / count;
  const widths = categories.map((_, i) => labelWidth(labels[i] ?? ""));
  /** Whether the labels of categories `a` and `b` (a before b) stand clear of each other. */
  const apart = (a: number, b: number): boolean => ((widths[a] ?? 0) + (widths[b] ?? 0)) / 2 + LABEL_GAP_PX <= pitch * (b - a);
  let every = 1;
  const clears = (): boolean => {
    for (let i = every; i < count; i += every) {
      if (!apart(i - every, i)) {
        return false;
      }
    }
    return true;
  };
  while (every < count && !clears()) {
    every += 1;
  }
  if (every === 1) {
    return undefined;
  }
  const kept: number[] = [];
  for (let i = 0; i < count; i += every) {
    kept.push(i);
  }
  const last = count - 1;
  const before = kept.at(-1) ?? 0;
  if (before !== last) {
    // The last one takes the place of the one before it when the two would run together (never the first's).
    if (!apart(before, last) && before !== 0) {
      kept.pop();
    }
    if (apart(kept.at(-1) ?? 0, last)) {
      kept.push(last);
    }
  }
  return kept.map((i) => categories[i] as T);
}

/** A value axis' ticks along `length` px when `count` of them would run together: the most d3 ticks of `domain` whose labels fit, else
 * undefined (the axis keeps its own `count`). */
export function fittingValueTicks(domain: readonly [number, number], count: number, format: (value: number) => string, length: number): number[] | undefined {
  if (length <= 0) {
    return undefined;
  }
  const scale = scaleLinear().domain([domain[0], domain[1]]);
  const fits = (ticks: readonly number[]): boolean => ticks.length <= labelsThatFit(ticks.map(format), length);
  if (fits(scale.ticks(count))) {
    return undefined;
  }
  for (let n = count - 1; n >= 1; n -= 1) {
    const ticks = scale.ticks(n);
    if (fits(ticks)) {
      return ticks;
    }
  }
  return scale.ticks(1).slice(0, 1);
}
