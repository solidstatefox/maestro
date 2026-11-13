/** Read-only SPARQL Protocol checks. A reachable HTML editor is not sufficient
 * evidence of a functioning SPARQL endpoint, and a single unsupported request
 * method/format must not label a working endpoint unavailable. */
export type SparqlHealthState = "ok" | "server-error" | "http-error" | "timeout" | "unreachable" | "probe-error";
export type SparqlHealthAttempt = { url: string; status: number | null; state: SparqlHealthState; method: "GET" | "POST"; query: "ASK" | "SELECT" };
export type SparqlHealthResult = {
  status: number | null;
  state: SparqlHealthState;
  testedUrl: string;
  attempts: SparqlHealthAttempt[];
};

export function isSparqlResultBody(body: string): boolean {
  const trimmed = body.trim();
  if (trimmed === "true" || trimmed === "false" || /^(?:boolean|\?boolean)\s*[\r\n]+(?:true|false)\s*$/i.test(trimmed)) return true;
  try {
    const result: unknown = JSON.parse(trimmed);
    if (result && typeof result === "object") {
      const value = result as Record<string, unknown>;
      if (typeof value.boolean === "boolean") return true;
      const head = value.head as { vars?: unknown } | undefined;
      const rows = value.results as { bindings?: unknown } | undefined;
      if (head && (Array.isArray(head.vars) || Object.keys(head).length === 0) && Array.isArray(rows?.bindings)) return true;
    }
  } catch { /* Another supported SPARQL results format may follow. */ }
  // SPARQL Results XML: check both the root and a result-bearing child. Do not
  // accept arbitrary HTTP 200 HTML (including SPARQL editor landing pages).
  return /^(?:<\?xml[^>]*\?>\s*)?<(?:(?:[A-Za-z][\w.-]*):)?sparql\b[^>]*>/i.test(trimmed) &&
    /<(?:[A-Za-z][\w.-]*:)?(?:boolean|results)\b/i.test(trimmed);
}

/** Try both SPARQL Protocol methods and ASK/SELECT representations. */
export async function probeSparqlEndpoint(
  endpointUrl: string,
  options: { fetcher?: typeof fetch; headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<SparqlHealthResult> {
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? 6000;
  const attempts: SparqlHealthAttempt[] = [];
  const accept = "application/sparql-results+json, application/sparql-results+xml;q=0.9, application/json;q=0.8, text/plain;q=0.5";
  const queries = [
    { kind: "ASK" as const, query: "ASK WHERE { }" },
    { kind: "SELECT" as const, query: "SELECT * WHERE { } LIMIT 1" },
  ];
  for (const { kind, query } of queries) {
    for (const method of ["GET", "POST"] as const) {
      const probeUrl = new URL(endpointUrl);
      if (method === "GET") {
        probeUrl.searchParams.set("query", query);
        probeUrl.searchParams.set("format", "application/sparql-results+json");
      }
      try {
        const response = await fetcher(probeUrl.toString(), {
          method,
          headers: {
            ...options.headers,
            Accept: accept,
            ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" } : {}),
          },
          ...(method === "POST" ? { body: new URLSearchParams({ query }).toString() } : {}),
          redirect: "manual", // do not follow an editor redirect and call it SPARQL health
          cache: "no-store",
          signal: AbortSignal.timeout(timeoutMs),
        });
        const body = await response.text();
        if (response.ok && isSparqlResultBody(body)) {
          attempts.push({ url: endpointUrl, status: response.status, state: "ok", method, query: kind });
          return { status: 200, state: "ok", testedUrl: endpointUrl, attempts };
        }
        attempts.push({ url: endpointUrl, status: response.status,
          state: response.ok ? "probe-error" : response.status >= 500 ? "server-error" : "http-error", method, query: kind });
      } catch (error) {
        const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        attempts.push({ url: endpointUrl, status: null, state: timeout ? "timeout" : "unreachable", method, query: kind });
      }
    }
  }
  // Prefer the known protocol failure over a transport failure; a 200 with
  // unexpected content means the probe is inconclusive, not that the host is down.
  const failure = attempts.find((attempt) => attempt.state === "probe-error") ??
    attempts.find((attempt) => attempt.status === 401 || attempt.status === 403) ??
    attempts.find((attempt) => attempt.state === "server-error") ??
    attempts.find((attempt) => attempt.state === "http-error") ??
    attempts.find((attempt) => attempt.state === "timeout") ?? attempts[0];
  return { status: failure?.state === "probe-error" ? null : failure?.status ?? null,
    state: failure?.state ?? "unreachable", testedUrl: endpointUrl, attempts };
}
