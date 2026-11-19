export function numberValue(value: unknown): number | undefined {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- this is the parse boundary the rule asks for; callers branch on the typed result.
  return typeof value === "number" ? value : undefined;
}

export function stringValue(value: unknown): string | undefined {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- the parse boundary, as above.
  return typeof value === "string" ? value : undefined;
}

/** The x column holds a Date, an ISO string or epoch ms by the chart's data contract. */
export function dateValue(value: unknown): Date {
  // SAFETY: a Date is returned as is; anything else is the string or epoch-ms form the data contract promises.
  return value instanceof Date ? value : new Date(value as string | number);
}
