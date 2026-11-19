export const SEQUENTIAL_SCALE: readonly string[] = [
  "var(--chart-scale-02)",
  "var(--chart-scale-03)",
  "var(--chart-scale-04)",
  "var(--chart-scale-05)",
];

/** A readable number near `value`: two significant digits (whole numbers for counts). */
const readable = (value: number, whole: boolean): number => {
  const magnitude = 10 ** Math.floor(Math.log10(Math.abs(value) || 1) - 1);
  const rounded = Math.round(value / magnitude) * magnitude;
  return whole ? Math.max(1, Math.round(rounded)) : rounded;
};

/** Thresholds that cut `[min, max]` into `steps` fills on a square-root scale (the cuts at `(i / steps)²` of the range): skewed values
 * such as counts, most of them small, still spread over every fill. Each is rounded to a readable number and kept when above the last. */
export const sqrtThresholds = (min: number, max: number, steps: number, whole: boolean): number[] => {
  const out: number[] = [];
  if (!(max > min)) {
    return out;
  }
  for (let i = 1; i < steps; i += 1) {
    const value = readable(min + (max - min) * (i / steps) ** 2, whole);
    if (value > (out.at(-1) ?? min)) {
      out.push(value);
    }
  }
  return out;
};

/** The fill of `value`: the first color, then the next one at each threshold it reaches. */
export const stepColor = (value: number, colors: readonly string[], thresholds: readonly number[]): string => {
  let index = 0;
  while (index < thresholds.length && value >= (thresholds[index] ?? Number.POSITIVE_INFINITY)) {
    index += 1;
  }
  return colors[Math.min(index, colors.length - 1)] ?? "var(--chart-1)";
};
