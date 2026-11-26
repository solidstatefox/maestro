/** Virtuoso ANYTIME can finish with usable rows and SQL state S1TAT. */
export function isVirtuosoAnytime(response: Response, body = ""): boolean {
  if (response.status === 206 || response.headers.get("x-sql-state")?.trim().toUpperCase() === "S1TAT") return true;
  // Never search successful RDF/JSON data for diagnostic words: a literal can
  // legitimately contain S1TAT or "ANYTIME timeout". Only an error body is
  // eligible for diagnostic detection. A result parser still has to succeed.
  return !response.ok && /\bS1TAT\b|\bANYTIME\s+timeout\b|Returning incomplete results, query interrupted by result timeout/i.test(body);
}

export function virtuosoAnytimeMessage(response: Response, body = ""): string {
  return response.headers.get("x-sql-message")?.trim()
    || body.match(/(?:S1TAT[^\r\n]*|Returning incomplete results[^\r\n]*)/i)?.[0]
    || "Virtuoso returned an incomplete result set.";
}

export function anytimeResponseHeaders(response: Response, incomplete: boolean): Record<string, string> {
  return incomplete ? {
    "X-Maestro-Incomplete": "true",
    "X-Maestro-Upstream-SQL-State": response.headers.get("x-sql-state") || (response.status === 206 ? "PARTIAL" : "S1TAT"),
  } : {};
}
