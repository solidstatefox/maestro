/**
 * Build a Virtuoso bif:contains operand from ordinary FCT search text.
 *
 * Every searchable word is quoted as a literal operand; AND is generated
 * only between operands. This prevents words such as AND/OR/NOT from being
 * interpreted as Boolean operators supplied by the user.
 *
 * Both the FCT translator and its derived distinct-count queries must use
 * this function, or facet counts can fail while Results still work.
 */
export function buildVirtuosoFullTextExpression(searchText: string): string | null {
  const terms = searchText.match(/[\p{L}\p{N}_]+\*?/gu) ?? [];
  if (terms.length === 0) return null;
  const operands = terms.map((term) => `"${term.toUpperCase()}"`);
  return operands.length === 1 ? operands[0] : `(${operands.join(" AND ")})`;
}
