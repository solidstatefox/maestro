/** Virtuoso ANYTIME can finish with usable rows and SQL state S1TAT. */
export function isVirtuosoAnytime(response: Response, body = ""): boolean {
  return response.headers.get("x-sql-state")?.trim().toUpperCase() === "S1TAT"
    || /\bS1TAT\b|\bANYTIME\s+timeout\b|Returning incomplete results, query interrupted by result timeout/i.test(body);
}

export function virtuosoAnytimeMessage(response: Response, body = ""): string {
  return response.headers.get("x-sql-message")?.trim()
    || body.match(/(?:S1TAT[^\r\n]*|Returning incomplete results[^\r\n]*)/i)?.[0]
    || "Virtuoso returned an incomplete result set (ANYTIME timeout).";
}

export function anytimeResponseHeaders(response: Response, incomplete: boolean): Record<string, string> {
  return incomplete ? {
    "X-Maestro-Incomplete": "true",
    "X-Maestro-Upstream-SQL-State": response.headers.get("x-sql-state") || (response.status === 206 ? "PARTIAL" : "S1TAT"),
  } : {};
}
