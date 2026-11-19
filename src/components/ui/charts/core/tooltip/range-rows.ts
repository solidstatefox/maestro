import { intFmt } from "../format";

/** The edge keys of one band's tooltip row. */
export interface TooltipRange {
  readonly upperKey: string;
  readonly lowerKey: string;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** `low – high` of `datum` (the one value of a one-key band), null when an edge is missing; `format` formats each value (default `intFmt`). */
export function formatBandRange(datum: Readonly<Record<string, unknown>>, upperKey: string, lowerKey: string, format: (value: number) => string = intFmt): string | number | null {
  const upper = datum[upperKey];
  const lower = datum[lowerKey];
  if (!(finite(upper) && finite(lower))) {
    return null;
  }
  if (upperKey === lowerKey) {
    return format(upper);
  }
  return `${format(Math.min(lower, upper))} – ${format(Math.max(lower, upper))}`;
}

/** A row's value: the band range of a band's group key, else undefined (the caller formats the point's own value). */
export function rangeRowValue(
  range: TooltipRange | undefined,
  datum: unknown,
  format: ((value: number, label: string) => string | number) | undefined,
  key: string,
): string | number | undefined {
  if (range === undefined || datum === null || typeof datum !== "object") {
    return undefined;
  }
  // SAFETY: a band's focus point is built from a data row, a plain record.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
  const row = datum as Readonly<Record<string, unknown>>;
  return formatBandRange(row, range.upperKey, range.lowerKey, format === undefined ? intFmt : (value) => String(format(value, key))) ?? undefined;
}
