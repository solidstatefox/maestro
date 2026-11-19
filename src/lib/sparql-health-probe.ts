import { describeUpstreamError, sanitizeUpstreamDiagnostic } from "@/lib/upstream-error";
/** Read-only SPARQL Protocol checks. A reachable HTML editor is not sufficient
 * evidence of a functioning SPARQL endpoint, and a single unsupported request
 * method/format must not label a working endpoint unavailable. */
export type SparqlHealthState = "ok" | "server-error" | "http-error" | "timeout" | "unreachable" | "probe-error";
export type SparqlHealthAttempt = {
  url: string; status: number | null; state: SparqlHealthState;
  method: "GET" | "POST"; query: "ASK" | "SELECT";
  /** Status is genuinely null when fetch failed before an HTTP response. */
  statusText?: string; contentType?: string; responseUrl?: string; location?: string;
  responseBody?: string; responseHeaders?: Record<string, string>; error?: string; errorName?: string; durationMs?: number;
};
export type SparqlHealthResult = {
  status: number | null;
  state: SparqlHealthState;
  testedUrl: string;
  diagnostic?: string;
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
      const startedAt = Date.now();
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
        const diagnostic = {
          url: endpointUrl, status: response.status, method, query: kind,
          statusText: sanitizeUpstreamDiagnostic(response.statusText),
          contentType: response.headers.get("content-type") ?? undefined,
          responseHeaders: Object.fromEntries([...response.headers].filter(([name]) =>
            !/(?:authorization|cookie|token|secret|api[-_]?key|credential|session)/i.test(name))
            .map(([name, value]) => [name, sanitizeUpstreamDiagnostic(value)])),
          responseUrl: sanitizeUpstreamDiagnostic(response.url || endpointUrl),
          location: response.headers.get("location") ? sanitizeUpstreamDiagnostic(response.headers.get("location")!) : undefined,
          durationMs: Date.now() - startedAt,
        };
        // A response can arrive successfully even when reading its body fails.
        // Do not collapse its actual HTTP status back to null/unreachable.
        let body: string;
        try { body = await response.text(); }
        catch (error) {
          attempts.push({ ...diagnostic,
            state: response.ok ? "probe-error" : response.status >= 500 ? "server-error" : "http-error",
            errorName: error instanceof Error ? error.name : typeof error,
            error: `Could not read HTTP response body: ${describeUpstreamError(error)}` });
          continue;
        }
        if (response.ok && isSparqlResultBody(body)) {
          attempts.push({ ...diagnostic, state: "ok" });
          return { status: 200, state: "ok", testedUrl: endpointUrl, attempts };
        }
        attempts.push({ ...diagnostic,
          responseBody: sanitizeUpstreamDiagnostic(body),
          state: response.ok ? "probe-error" : response.status >= 500 ? "server-error" : "http-error" });
      } catch (error) {
        const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        attempts.push({ url: endpointUrl, status: null, state: timeout ? "timeout" : "unreachable",
          method, query: kind, errorName: error instanceof Error ? error.name : typeof error,
          error: describeUpstreamError(error, "Graph-server request failed without an HTTP response"),
          durationMs: Date.now() - startedAt });
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
  return { status: failure?.status ?? null,
    state: failure?.state ?? "unreachable", testedUrl: endpointUrl,
    diagnostic: failure?.error ?? ([failure?.status !== null && failure?.status !== undefined ? `HTTP ${failure.status}` : "", failure?.statusText, failure?.responseBody].filter(Boolean).join(": ") || undefined),
    attempts };
}
