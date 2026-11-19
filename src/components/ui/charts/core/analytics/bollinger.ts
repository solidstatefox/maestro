export interface BollingerBandsOptions {
  /** Numeric key the bands are computed for. */
  dataKey: string;
  /**
   * Rolling window length, in rows.
   * @default 20
   */
  period?: number;
  /**
   * Standard deviations above and below the moving average.
   * @default 2
   */
  multiplier?: number;
  /**
   * Finite values the window needs before a row gets bands (pandas `min_periods`), clamped to 1..`period`. Defaults to `period`: a gap
   * until the window fills. `1` warms up from the first row over a partial window.
   */
  minPeriods?: number;
  /** Key of the upper band. Defaults to `${dataKey}Upper`. */
  upperKey?: string;
  /** Key of the lower band. Defaults to `${dataKey}Lower`. */
  lowerKey?: string;
  /** Key of the moving average. Defaults to `${dataKey}Sma`. */
  middleKey?: string;
}

/**
 * New rows with Bollinger band keys: the rolling simple moving average over the last `period` rows ± `multiplier` × the population
 * standard deviation of the finite values in that window. A row whose window holds fewer than `minPeriods` finite values gets `null`
 * for all three keys, which a line draws as a gap. The input is left untouched. One pass with running sums (O(n), not bklit's O(n·period)).
 */
export function withBollingerBands<T extends Record<string, unknown>>(data: readonly T[], options: BollingerBandsOptions): (T & Record<string, number | null>)[] {
  const { dataKey, period = 20, multiplier = 2, upperKey = `${dataKey}Upper`, lowerKey = `${dataKey}Lower`, middleKey = `${dataKey}Sma`, minPeriods = period } = options;
  const windowSize = Math.max(1, Math.floor(period));
  const required = Math.min(windowSize, Math.max(1, Number.isFinite(minPeriods) ? Math.floor(minPeriods) : windowSize));
  // Sums of the values less the first finite one: the variance is shift-invariant, and small sums keep `sumSq / n - mean²` exact.
  const shift = data.map((row) => row[dataKey]).find((value): value is number => typeof value === "number" && Number.isFinite(value)) ?? 0;
  const valueAt = (index: number): number | undefined => {
    const value = data[index]?.[dataKey];
    return typeof value === "number" && Number.isFinite(value) ? value - shift : undefined;
  };
  let count = 0;
  let sum = 0;
  let sumSq = 0;
  return data.map((row, index) => {
    const entering = valueAt(index);
    if (entering !== undefined) {
      count += 1;
      sum += entering;
      sumSq += entering * entering;
    }
    const leaving = index >= windowSize ? valueAt(index - windowSize) : undefined;
    if (leaving !== undefined) {
      count -= 1;
      sum -= leaving;
      sumSq -= leaving * leaving;
      if (count === 0) {
        sum = 0;
        sumSq = 0;
      }
    }
    let upper: number | null = null;
    let lower: number | null = null;
    let middle: number | null = null;
    if (count >= required && count > 0) {
      const mean = sum / count;
      // Population variance from the running sums; clamped, as rounding can leave it a hair under zero on a flat window.
      const spread = multiplier * Math.sqrt(Math.max(0, sumSq / count - mean * mean));
      middle = mean + shift;
      upper = middle + spread;
      lower = middle - spread;
    }
    // SAFETY: the row's own keys plus three number-or-null keys, which is the declared return type.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
    return { ...row, [upperKey]: upper, [lowerKey]: lower, [middleKey]: middle } as T & Record<string, number | null>;
  });
}
