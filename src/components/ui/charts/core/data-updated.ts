import { sameValue } from "./guards";

type Rows = readonly Readonly<Record<string, unknown>>[];

export const sameRows = (a: Rows, b: Rows): boolean =>
  a === b || (a.length === b.length && a.every((row, i) => {
    const other = b[i];
    const keys = Object.keys(row);
    return keys.length === Object.keys(other).length && keys.every((key) => sameValue(row[key], other[key]));
  }));

/** Fed each data array the chart draws, from `first` on: true once one differs in content from `first`. Builders use it to tell a later update
 * (bklit snaps everything, guides included) from the entrance (guides fade in); an equal re-created array stays false. Compared once per array identity. */
export function createDataUpdated(first: Rows): (data: Rows) => boolean {
  let seen: { readonly data: Rows; readonly updated: boolean } = { data: first, updated: false };
  return (data) => {
    if (seen.data !== data) {
      seen = { data, updated: seen.updated || !sameRows(first, data) };
    }
    return seen.updated;
  };
}
