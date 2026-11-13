/** Numeric-literal semantics shared by the FCT result/count translators and
 * approved numeric-facet query projections. This is an explicit opt-in policy:
 * RDF terms are never silently rewritten or retyped in storage. */
export const COERCIBLE_NUMERIC_MODE = "finite-lexical-v1" as const;
export const NUMERIC_FACET_PROJECTION = "?facetNumber" as const;

// SPARQL regex: signed integers, decimals (.5, -2., +3.125) and exponent
// notation (1e-3). Deliberately excludes time offsets, units, NaN and INF.
// Character class [.] avoids embedded SPARQL/backslash escaping differences.
export const NUMERIC_LEXICAL_PATTERN = "^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$";

export function isCoercibleNumericLexical(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 80 &&
    new RegExp(NUMERIC_LEXICAL_PATTERN).test(trimmed) && Number.isFinite(Number(trimmed));
}

/** Use the same lexical guard for domain aggregates and FCT range filtering.
 * IF deliberately guards bif:number: Virtuoso's conversion raises an SQL error
 * when applied to an arbitrary non-numeric string. */
export function guardedNumericRangeFilter(term: string, operator: ">=" | "<=", bound: string): string {
  const lexical = `bif:trim(STR(${term}))`;
  return `(isLiteral(${term}) && IF(REGEX(${lexical}, "${NUMERIC_LEXICAL_PATTERN}"), bif:number(${lexical}) ${operator} ${bound}, false))`;
}

export function numericFacetBinding(term = "?facetValue"): string {
  const lexical = `bif:trim(STR(${term}))`;
  return `FILTER (isLiteral(${term})) BIND (IF(REGEX(${lexical}, "${NUMERIC_LEXICAL_PATTERN}"), bif:number(${lexical}), 0) AS ?facetNumber) FILTER (REGEX(${lexical}, "${NUMERIC_LEXICAL_PATTERN}") && bif:isfinitenumeric(?facetNumber))`;
}
