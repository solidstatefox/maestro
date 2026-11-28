import { sanitizeUpstreamDiagnostic } from "./upstream-error";

/** Lossless upstream diagnostic transport for FCT/proxy failures.
 * The browser consumes XML, so preserve Virtuoso's complete decoded response
 * and a UTF-8 base64 representation (both redacted only for secrets), no
 * 300-character truncation or invented
 * 504 for a real HTTP 206. Credentials and hop-by-hop HTTP response headers
 * are not exposed as client response headers.
 */
const FCT_NS = "http://openlinksw.com/services/facets/1.0/";

/** Virtuoso's public SPARQL endpoint and front-end caches recognize the
 * protocol timeout in the URL query string. Send the same budget in the POST
 * form body too (executeSparql already does so). Do not modify ordinary FCT
 * requests or assume the server will honor more than its configured maximum.
 */
export function predicateAnalyticsEndpointWithTimeout(endpoint: string, timeoutMs: number): string {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000) return endpoint;
  const url = new URL(endpoint);
  url.searchParams.set("timeout", String(timeoutMs));
  return url.toString();
}

function xml(value: unknown): string {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]|\p{Surrogate}/gu, "\ufffd")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

// Preserve all ordinary Virtuoso diagnostic/response headers, while excluding
// authentication/session secrets and hop-by-hop transport internals.
const privateHeader = /^(?:set-cookie|set-cookie2|authorization|proxy-authorization|proxy-authenticate|www-authenticate|x-api-key|x-auth-token|x-access-token|x-maestro-iteracompute-key|connection|transfer-encoding|keep-alive|trailer|upgrade)$/i;
export type PredicateUpstreamPhase = "incidence" | "value-counts" | "candidates" | "counts" | "population" | "overlaps" | "fct" | "fct-json" | "ask" | "describe" | "describe-expanded";
export type PredicateUpstreamFailure = {
  phase: PredicateUpstreamPhase; response: Response; body: string; query: string; endpoint: string;
  proxyStatus?: number; explanation?: string;
};

export class PredicateAnalyticsUpstreamError extends Error {
  readonly upstreamStatus: number;
  readonly status: number;
  private readonly xml: string;
  private readonly incomplete: boolean;
  constructor(args: PredicateUpstreamFailure) {
    const {response, phase, body, query, endpoint, explanation} = args;
    const upstreamStatus = response.status;
    const incomplete = response.status === 206 || response.headers.get("X-SQL-State")?.toUpperCase() === "S1TAT";
    // Fetch Response forbids a body with 204/205/304. These are invalid
    // replies for a SPARQL result; retain their actual status as provenance
    // while using 502 for the enclosing FCT error document.
    const status = args.proxyStatus ?? ([204, 205, 304].includes(upstreamStatus) ? 502 : upstreamStatus);
    const sqlState = response.headers.get("X-SQL-State") || "";
    const sqlMessage = sanitizeUpstreamDiagnostic(response.headers.get("X-SQL-Message") || "", Infinity);
    const safeBody = sanitizeUpstreamDiagnostic(body, Infinity);
    const safeQuery = sanitizeUpstreamDiagnostic(query, Infinity);
    const safeEndpoint = sanitizeUpstreamDiagnostic(endpoint, Infinity);
    const message = `${phase}: Virtuoso HTTP ${upstreamStatus} ${response.statusText || ""}`.trim() +
      (sqlState ? ` (${sqlState})` : "") + (sqlMessage ? `: ${sqlMessage}` : "") +
      (explanation ? `; ${explanation}` : "") + (incomplete ? "; incomplete statistics cannot be used" : "");
    super(message);
    this.name = "PredicateAnalyticsUpstreamError";
    this.upstreamStatus = upstreamStatus;
    this.status = status;
    this.incomplete = incomplete;
    const headers = [...response.headers.entries()]
      .filter(([name]) => !privateHeader.test(name))
      .map(([name, value]) => `<fct:header name="${xml(name)}">${xml(sanitizeUpstreamDiagnostic(value, Infinity))}</fct:header>`).join("");
    const base64 = Buffer.from(safeBody, "utf8").toString("base64");
    this.xml = `<fct:facets xmlns:fct="${FCT_NS}">` +
      `<fct:complete>no</fct:complete><fct:error>${xml(message)}</fct:error>` +
      `<fct:upstream phase="${xml(phase)}" endpoint="${xml(safeEndpoint)}" response-url="${xml(sanitizeUpstreamDiagnostic(response.url, Infinity))}" redirected="${response.redirected ? "true" : "false"}" status="${upstreamStatus}" status-text="${xml(response.statusText)}">` +
      `<fct:headers>${headers}</fct:headers>` +
      `<fct:body>${xml(safeBody)}</fct:body>` +
      `<fct:body-base64 encoding="base64" charset="utf-8">${base64}</fct:body-base64>` +
      `</fct:upstream><fct:sparql>${xml(safeQuery)}</fct:sparql></fct:facets>`;
  }
  toResponse(): Response {
    return new Response(this.xml, {status:this.status,headers:{
      "Content-Type":"application/xml; charset=utf-8", "Cache-Control":"no-store",
      "X-Maestro-Failure-Origin":"upstream-http", "X-Maestro-Upstream-Status":String(this.upstreamStatus),
      "X-Maestro-Incomplete":this.incomplete ? "true" : "false",
    }});
  }
}

export function predicateAnalyticsUpstreamFailure(args: PredicateUpstreamFailure): PredicateAnalyticsUpstreamError {
  return new PredicateAnalyticsUpstreamError(args);
}
