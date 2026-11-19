export const range = (count: number): number[] => Array.from({ length: count }, (_unused, index) => index);

/** The smallest of `values` (Infinity when empty): a loop, since `Math.min(...values)` overflows the stack past ~120,000 values. */
export const minOf = (values: readonly number[]): number => {
  let min = Number.POSITIVE_INFINITY;
  for (const value of values) {
    min = Math.min(min, value);
  }
  return min;
};

/** The largest of `values` (-Infinity when empty): a loop, since `Math.max(...values)` overflows the stack past ~120,000 values. */
export const maxOf = (values: readonly number[]): number => {
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    max = Math.max(max, value);
  }
  return max;
};
