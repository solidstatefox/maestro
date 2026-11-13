/** Retry only when Virtuoso explicitly rejects ranking or grouped facet counts.
 * Messages can contain echoed SPARQL, so a bare IRI_RANK or GROUP BY is
 * NOT evidence that ordering or aggregation caused the error. */
export function virtuosoRankFailure(message: string): boolean {
  return /(?:\b(?:SR185|SR353)\b|sorted results (?:limit|exceed)|sort(?:ing)? limit|(?:unknown|undefined|unsupported|unrecognized|not supported|not defined)[^\n]{0,100}IRI_RANK|IRI_RANK[^\n]{0,100}(?:unknown|undefined|unsupported|not supported|not defined))/i.test(message);
}

export function virtuosoAggregateFailure(message: string): boolean {
  return /(?:\bSR319\b|\b(?:SR185|SR353)\b|estimated execution (?:time|cost)|aggregation (?:too expensive|timeout|time limit|not supported)|group(?:ing)? (?:too expensive|timeout|time limit)|query (?:too expensive|cost limit exceeded))/i.test(message);
}
