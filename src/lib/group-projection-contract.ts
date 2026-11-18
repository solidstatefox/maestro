"use client";
import type { FctResult } from "@/canvas/utils/fct-response";

/** Group headings are enumerated through the same derived FCT value query as
 * the matching Personal facet, not a separate grouped SELECT. The established
 * FCT facet wire format is [typed value, distinct focus-resource count].
 * SPARQL projection aliases are arbitrary and MUST NOT be reverse-engineered
 * from the executed query's text. Native grouped SELECT compilation remains
 * supported for other consumers, independently of this facet decoder. */
export function decodeFctFacetGroupRows(
  rows: readonly FctResult[],
  labelForUri: (uri: string) => string,
  populationCount: number | null,
): FctResult[] {
  return rows.filter(row => (row.columns?.length ?? 0) >= 2).map(row => {
    const value = row.columns![0];
    const count = row.columns![1];
    const members = Number(count?.value);
    if (!value?.value || !Number.isSafeInteger(members) || members < 0) {
      throw new Error("The group facet returned a value without a valid distinct-resource count.");
    }
    if (populationCount !== null && members > populationCount) {
      throw new Error(`The group facet returned ${members} members, exceeding the ${populationCount} resources in this population.`);
    }
    return {
      ...row, uri: value.value, termType: value.termType ?? "literal",
      datatype: value.datatype, lang: value.lang,
      title: value.label || (value.termType === "uri" ? labelForUri(value.value) : value.value),
      columns: [value, count],
    };
  });
}
