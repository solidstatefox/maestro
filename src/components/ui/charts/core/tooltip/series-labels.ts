export type TooltipRowColor = string | ((value: number) => string);

/** The `label` of each series that sets one, keyed by dataKey (the body's `labels`); the first series of a key that names it wins. */
export const seriesLabels = (series: readonly { readonly dataKey: string; readonly label?: string }[]): Partial<Record<string, string>> => {
  const out: Partial<Record<string, string>> = {};
  for (const s of series) {
    if (s.label !== undefined && out[s.dataKey] === undefined) {
      out[s.dataKey] = s.label;
    }
  }
  return out;
};
