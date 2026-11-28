import { isBlankNodeTerm } from "@/lib/bnode";
import { normalizeMaestroConcurrency } from "@/lib/maestro-concurrency";
import { clientFromRequest, newProxyClientId, MAESTRO_CLIENT_COOKIE, saveProxyClientPreferences } from "@/lib/maestro-proxy-client-preferences";
import { rescheduleMaestroQueries } from "@/lib/graph-server-query-scheduler";
import { getUserGraph, getShapesGraph, graphForFile, queryPersonalSparql, PersonalSparqlHttpError } from "@/lib/personal-sparql";
import { currentProxyClient, withProxyClient } from "@/lib/maestro-proxy-client-preferences";
import { weightMaestroQuery } from "@/lib/graph-server-query-scheduler";
import { withProxyQueryTelemetry } from "@/lib/proxy-query-telemetry";
import { traceVirtuosoDispatch } from "@/lib/proxy-query-events";
import { createHash } from "node:crypto";
import { canonicalQueryIdentityXml } from "@/lib/query-identity";
import { cloneFctListStatusView } from "@/lib/fct-status-projection";
import { verifyApprovalBookmark, readPolicyApprovals } from "@/lib/policy-approval-store";
import { getPersonalStatusGraph, getQueryObservationGraph } from "@/lib/personal-status-graph";
import { unscopedGraph, ALL_GRAPHS } from "@/lib/graph-address-mode";
import { FCT_VIEW_TYPES } from "@/lib/fct-view-types";
import { predicateAnalysisPage, DEFAULT_PREDICATE_CLUSTER_CUTOFF, type PredicateAnalysis } from "@/lib/fct-predicate-analytics";
import { PredicateIncidenceAccumulator } from "@/lib/predicate-incidence";
import { collectFacetUtilityRanking, FacetUtilityStatisticsError } from "@/lib/facet-utility-ranking";
import { LIST_VALUES_MAX_RESOURCES } from "@/lib/list-values-transport";
import { logProxyCaller } from "@/lib/proxy-debug-server";
import { NextResponse } from "next/server";
import { XMLParser } from "fast-xml-parser";
import { compileFctXmlToSparql as compileFctXmlBase, type SparqlJsonResults, type SparqlBindingTerm } from "@/lib/fct-sparql-translator";
import { validMaestroLanguage } from "@/lib/maestro-language";
import { getQueryCache, queryCacheKey, setQueryCache } from "@/lib/query-cache";
import { getConfiguredFctEndpoints, getPersonalSession, personalSparqlUrl, normalizeGraphServerUri } from "@/lib/personal-sparql";
import { permittedGraphServerTarget, checkGraphServerDestination } from "@/lib/graph-server-target";
import { graphServerUrlMatches } from "@/lib/graph-server-health";
import { probeSparqlEndpoint } from "@/lib/sparql-health-probe";
import { describeUpstreamError, sanitizeUpstreamDiagnostic, withUpstreamTransport, UpstreamTransportError } from "@/lib/upstream-error";
import { updateFctExecutionAddress } from "@/lib/fct-execution-address";
import { proxyLog } from "@/lib/maestro-logger";
import { withGraphServerSlot } from "@/lib/server-query-scheduler";
import { virtuosoRankFailure, virtuosoAggregateFailure } from "@/lib/virtuoso-query-fallbacks";
import { isVirtuosoAnytime, virtuosoAnytimeMessage, anytimeResponseHeaders } from "@/lib/virtuoso-anytime";
import { fetchVirtuosoRead } from "@/lib/virtuoso-read-transport";
import { predicateAnalyticsUpstreamFailure, predicateAnalyticsEndpointWithTimeout, PredicateAnalyticsUpstreamError, type PredicateUpstreamPhase } from "@/lib/predicate-analytics-upstream";


function parseResults(text: string): SparqlJsonResults | null {
  try {
    const parsed = JSON.parse(text) as SparqlJsonResults;
    if (!parsed || !parsed.head || !Array.isArray(parsed.head.vars) || !parsed.results || !Array.isArray(parsed.results.bindings)) return null;
    if (!parsed.head.vars.every(name => typeof name === "string") || !parsed.results.bindings.every(row => row && typeof row === "object" && !Array.isArray(row) && Object.values(row).every(term => term && typeof term.type === "string" && typeof term.value === "string"))) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Same population key for the three derived projections; paging and view IDs
 * do not alter the statistical universe. All other filters remain significant. */
function predicateAnalysisScope(xml: string): { key: string; cutoff: number } {
  const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", removeNSPrefix: true }).parse(xml) as Record<string, unknown>;
  let viewFound = false;
  let cutoff = DEFAULT_PREDICATE_CLUSTER_CUTOFF;
  const normalize = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(normalize);
    if (!node || typeof node !== "object") return node;
    const row = node as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(row)) {
      if (name === "view" && value && typeof value === "object" && !Array.isArray(value)) {
        if (viewFound) throw new Error("Predicate analysis requires exactly one FCT view.");
        viewFound = true;
        const attributes = value as Record<string, unknown>;
        if (attributes["@_cutoff"] !== undefined) {
          cutoff = Number(attributes["@_cutoff"]);
          if (!Number.isFinite(cutoff) || cutoff < 0 || cutoff > 1)
            throw new Error("Predicate cluster cutoff must be a number between 0 and 1.");
        }
        const normalized = normalize(value) as Record<string, unknown>;
        delete normalized["@_type"];
        delete normalized["@_limit"];
        delete normalized["@_offset"];
        delete normalized["@_id"];
        // The algorithm has its own cache namespace. Structural rank must
        // continue sharing the exact same incidence run as both cluster views.
        delete normalized["@_algorithm"];
        result[name] = normalized;
      } else result[name] = normalize(value);
    }
    return result;
  };
  const key = JSON.stringify(normalize(doc));
  if (!viewFound) throw new Error("Predicate analytics view is missing.");
  return { key, cutoff };
}

/** Incomplete or inconsistent incidence pages cannot publish exact clusters. */
class PredicateAnalyticsQueryError extends Error {
  constructor(message: string, readonly status = 502) { super(message); }
}

const pendingPredicateAnalytics = new Map<string, {
  promise: Promise<PredicateAnalysis>; controller: AbortController; waiters: number;
}>();

/** Single-flight without coupling one browser request's cancellation to another.
 * Abort upstream only when every waiting request has abandoned the calculation. */
function awaitPredicateAnalysis(
  key: string, signal: AbortSignal, run: (signal: AbortSignal) => Promise<PredicateAnalysis>,
): Promise<PredicateAnalysis> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("Cancelled"));
  let pending = pendingPredicateAnalytics.get(key);
  if (!pending) {
    const controller = new AbortController();
    const job = { controller, waiters: 0, promise: Promise.resolve(null) as unknown as Promise<PredicateAnalysis> };
    job.promise = Promise.resolve().then(() => run(controller.signal)).finally(() => {
      if (pendingPredicateAnalytics.get(key) === job) pendingPredicateAnalytics.delete(key);
    });
    // A request can abort before all consumers attach to the shared promise.
    void job.promise.catch(() => {});
    pendingPredicateAnalytics.set(key, job);
    pending = job;
  }
  const job = pending;
  job.waiters++;
  return new Promise<PredicateAnalysis>((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return false;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      job.waiters--;
      return true;
    };
    const onAbort = () => {
      if (!finish()) return;
      if (job.waiters === 0) {
        if (pendingPredicateAnalytics.get(key) === job) pendingPredicateAnalytics.delete(key);
        job.controller.abort();
      }
      reject(signal.reason ?? new Error("Cancelled"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) { onAbort(); return; }
    job.promise.then(value => { if (finish()) resolve(value); }, error => { if (finish()) reject(error); });
  });
}

const VIRTRDF_LABEL = "http://www.openlinksw.com/schemas/virtrdf#label";

/** Parse browser language preferences in their declared order. */
function preferredLanguages(header: string | null): string[] {
  return (header ?? "").split(",").map((part, index) => {
    const [tag, ...parameters] = part.trim().split(";");
    const q = parameters.map((p) => p.trim()).find((p) => p.startsWith("q="));
    return { tag: (tag ?? "").toLowerCase(), q: q ? Number(q.slice(2)) : 1, index };
  }).filter((item) => item.tag && item.tag !== "*" && Number.isFinite(item.q) && item.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index).map((item) => item.tag);
}

function labelLanguage(term: SparqlBindingTerm): string {
  return (term["xml:lang"] ?? "").toLowerCase();
}

function uriFallbackLabel(uri: string): string {
  const hash = uri.lastIndexOf("#");
  const fragment = hash >= 0 ? uri.slice(hash + 1).split(/[?]/, 1)[0] : "";
  const withoutQueryOrFragment = uri.split(/[?#]/, 1)[0];
  const pathSegment = withoutQueryOrFragment.slice(withoutQueryOrFragment.lastIndexOf("/") + 1);
  const candidate = fragment || pathSegment || uri;
  try { return decodeURIComponent(candidate); } catch { return candidate; }
}

/**
 * Resolve display names for the already-selected FCT page. This never
 * re-evaluates the population, and is independent of the Personal session.
 *
 * In particular, do NOT use DEFINE input:inference "facets" here: unlike the
 * main query, this optional label lookup must work against endpoints which
 * do not publish a rule set named "facets" (including CORDIS). A failed lookup
 * previously returned a valid FCT result with URI-derived titles, hiding the
 * actual rdfs:label values from the center Results cards.
 */
async function resolveFctLabels(
  endpoint: string,
  bindings: Record<string, SparqlBindingTerm>[],
  acceptLanguage: string | null,
  timeoutMs: number,
  requestSignal?: AbortSignal,
): Promise<Map<string, string>> {
  // Resolve every URI term in the result rows, not just the primary list-view
  // column. Properties, Roles, Classes, Graphs and DESCRIBE all need labels too.
  const uris = [...new Set(bindings.flatMap((row) => Object.values(row)).filter(
    (term): term is SparqlBindingTerm => term?.type === "uri" && Boolean(term.value),
  ).map((term) => term.value))];
  // Keep only authoritative labels in this map. The browser's toLabel() owns
  // compact-IRI fallbacks when Virtuoso has no label for a URI.
  const labels = new Map<string, string>();
  if (!uris.length) return labels;

  // Only use RDF IRIREF-safe values. Invalid terms retain the URI fallback.
  const safeUris = uris.filter((uri) => !/[<>"{}|^`]/u.test(uri) && !/\s/u.test(uri) && !uri.includes("\\"));
  if (!safeUris.length) return labels;
  const values = safeUris.map((uri) => `<${uri}>`).join(" ");
  // Restrict both sides with VALUES. Besides avoiding a broad predicate scan,
  // this keeps the request to the selected page, not the original FCT WHERE.
  const query = [
    "SELECT ?s ?p ?label WHERE {",
    `  VALUES ?s { ${values} }`,
    "  VALUES ?p {",
    "    <http://www.w3.org/2000/01/rdf-schema#label>",
    "    <http://data.europa.eu/s66#title>",
    "    <http://www.w3.org/2004/02/skos/core#prefLabel>",
    "    <http://xmlns.com/foaf/0.1/name>",
    "    <http://purl.org/dc/terms/title>",
    "    <http://purl.org/dc/elements/1.1/title>",
    "    <https://schema.org/name>",
    "    <http://schema.org/name>",
    `    <${VIRTRDF_LABEL}>`,
    "  }",
    "  ?s ?p ?label .",
    "  FILTER (isLiteral(?label))",
    "}",
    "ORDER BY STR(?s)",
  ].join("\n");
  try {
    const result = await executeSparql(endpoint, query, undefined, timeoutMs, requestSignal);
    if (!result.response.ok) return labels;
    const parsed = parseResults(result.text);
    if (!parsed) return labels;
    if (result.response.status === 200 && !isVirtuosoAnytime(result.response, result.text)) setQueryCache(result.key, result.text);

    const candidates = new Map<string, { predicate: string; label: SparqlBindingTerm }[]>();
    const predicatePriority = new Map<string, number>([
      ["http://www.w3.org/2000/01/rdf-schema#label", 0],
      ["http://data.europa.eu/s66#title", 1],
      ["http://www.w3.org/2004/02/skos/core#prefLabel", 2],
      ["http://xmlns.com/foaf/0.1/name", 3],
      ["http://purl.org/dc/terms/title", 4],
      ["http://purl.org/dc/elements/1.1/title", 5],
      ["https://schema.org/name", 6],
      ["http://schema.org/name", 7],
      [VIRTRDF_LABEL, 8],
    ]);
    for (const row of parsed.results?.bindings ?? []) {
      const subject = row.s?.value;
      const predicate = row.p?.value;
      const label = row.label;
      if (!subject || !predicate || !label || label.type !== "literal" || !predicatePriority.has(predicate)) continue;
      const existing = candidates.get(subject) ?? [];
      existing.push({ predicate, label });
      candidates.set(subject, existing);
    }
    const languages = preferredLanguages(acceptLanguage);
    for (const [uri, options] of candidates) {
      options.sort((a, b) => {
        const predicateRank = (predicatePriority.get(a.predicate) ?? 99) - (predicatePriority.get(b.predicate) ?? 99);
        if (predicateRank) return predicateRank;
        const aLang = labelLanguage(a.label);
        const bLang = labelLanguage(b.label);
        const aIndex = aLang ? languages.findIndex((lang) => aLang === lang || aLang.startsWith(`${lang}-`)) : languages.length;
        const bIndex = bLang ? languages.findIndex((lang) => bLang === lang || bLang.startsWith(`${lang}-`)) : languages.length;
        const aRank = aIndex < 0 ? languages.length + 1 : aIndex;
        const bRank = bIndex < 0 ? languages.length + 1 : bIndex;
        return aRank - bRank;
      });
      labels.set(uri, options[0].label.value);
    }
  } catch {
    // Label lookup is supplementary: preserve the URI-derived fallback.
  }
  return labels;
}

type ExecutedSparql = { response: Response; text: string; key: string };
const inFlightFctSparql = new Map<string, Promise<ExecutedSparql>>();

async function executeSparql(endpoint: string, query: string, accept = "application/sparql-results+json, application/json;q=0.9", timeoutMs = 20000, requestSignal?: AbortSignal, bypassCache = false): Promise<ExecutedSparql> {
  const url = endpoint;
  const key = queryCacheKey("sparql", url, `${accept}\\u0000${timeoutMs}\\u0000${query}`);
  const cached = bypassCache ? undefined : getQueryCache<string>(key);
  if (cached !== undefined) {
    return {
      response: new Response(cached, { status: 200, headers: { "X-Maestro-Upstream-Source": "cache", "Content-Type": accept.toLowerCase().includes("xml") || accept.toLowerCase().includes("rdf") ? "application/rdf+xml; charset=utf-8" : "application/sparql-results+json; charset=utf-8" } }),
      text: cached,
      key,
    };
  }
  const pendingKey = `${currentProxyClient()}:${key}`;
  const pending = requestSignal ? undefined : inFlightFctSparql.get(pendingKey);
  if (pending) return pending;

  const requestPromise = (async (): Promise<ExecutedSparql> => {
    await checkGraphServerDestination(endpoint);
    const result = await withGraphServerSlot(
      endpoint, /\bCOUNT\s*\(|\bGROUP BY\b/i.test(query) ? "count" : "interactive", requestSignal,
      () => traceVirtuosoDispatch(() => withUpstreamTransport(async () => {
      const response = await fetchVirtuosoRead(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Accept: accept,
        
      },
      body: new URLSearchParams({ query, ...(timeoutMs >= 1000 ? { timeout: String(timeoutMs) } : {}) }).toString(),
      cache: "no-store",
      redirect: "manual",
      signal: requestSignal,
    });
      const text = await response.text();
      return { response, text, key };
    }, requestSignal)), weightMaestroQuery(query, /\bCOUNT\s*\(|\bGROUP BY\b/i.test(query) ? "count" : "interactive"));
    return result;
  })();
  if (!requestSignal) inFlightFctSparql.set(pendingKey, requestPromise);
  try {
    return await requestPromise;
  } finally {
    if (!requestSignal && inFlightFctSparql.get(pendingKey) === requestPromise) inFlightFctSparql.delete(pendingKey);
  }
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function xmlAttributeValue(value: string): string {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#x[0-9a-fA-F]+|#[0-9]+);/g, (entity) => {
    if (entity === "&amp;") return "&";
    if (entity === "&quot;") return '"';
    if (entity === "&apos;") return "'";
    if (entity === "&lt;") return "<";
    if (entity === "&gt;") return ">";
    const hex = entity.startsWith("&#x");
    const point = Number.parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
    return Number.isFinite(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
  });
}

const FCT_NS = "http://openlinksw.com/services/facets/1.0/";

function xmlText(value: unknown): string {
  // RDF literal content can contain XML 1.0-illegal controls (e.g. U+0019 in
  // an upstream CORDIS title). Escaping five markup characters is not enough.
  // Replace only illegal code points; preserve valid astral Unicode pairs.
  // No XML numeric character reference can represent these controls either.
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|\p{Surrogate}/gu, "\uFFFD")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** Produce the same transparent upstream diagnostic for ordinary FCT failures.
 * A usable HTTP 206 SELECT remains a partial FCT result with complete=no. */
function fctUpstreamFailure(phase: PredicateUpstreamPhase, response: Response, body: string, query: string,
  endpoint: string, proxyStatus?: number, explanation?: string): Response {
  return predicateAnalyticsUpstreamFailure({ phase, response, body, query, endpoint,
    proxyStatus, explanation }).toResponse();
}

function fctError(message: string, status: number, details?: string, origin = "proxy"): Response {
  const body = `<fct:facets xmlns:fct="${FCT_NS}"><fct:error>${xmlText(message)}${details ? `: ${xmlText(details)}` : ""}</fct:error></fct:facets>`;
  return new Response(body, { status, headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store", "X-Maestro-Failure-Origin": origin } });
}

function fctColumn(term: SparqlBindingTerm | undefined, label?: string, extraAttrs?: Record<string, string>): string {
  if (!term) return "<fct:column/>";
  const datatype = term.type === "uri" ? "uri" : isBlankNodeTerm(term.type) ? "bnode" : term.datatype;
  const safeLabel = term.type === "uri" && label && label !== term.value ? label : "";
  const extraAttrStr = extraAttrs
    ? Object.entries(extraAttrs).map(([k, v]) => ` ${k}="${xmlText(v)}"`).join("")
    : "";
  const attrs = [
    datatype ? ` datatype="${xmlText(datatype)}"` : "",
    term["xml:lang"] ? ` xml:lang="${xmlText(term["xml:lang"])}"` : "",
    safeLabel ? ` label="${xmlText(safeLabel)}"` : "",
    extraAttrStr,
  ].join("");
  return `<fct:column${attrs}>${xmlText(term.value)}</fct:column>`;
}

/**
 * Virtuoso FCT response metadata. The /sparql protocol exposes partial-result
 * status and execution statistics via HTTP headers, not through the JSON rows.
 * A missing upstream statistic stays empty rather than being fabricated.
 * `processed` is the number of result rows in this response, NOT an
 * unrestricted COUNT(DISTINCT ...) for the current facet scope.
 */
type FctExecutionMetadata = {
  query: string;
  elapsedMs: number;
  complete: boolean;
  timeoutMs: number;
  processed: number;
  limit: number;
  offset: number;
  sqlState?: string;
  sqlMessage?: string;
  execMilliseconds?: string;
  execDbActivity?: string;
};

function fctExecutionMetadataXml(meta: FctExecutionMetadata): string {
  const state = meta.sqlState?.trim() || "";
  const message = meta.sqlMessage?.trim() || "";
  // Original FCT fct_exec emits these seven direct children in this order.
  // The sql-* / exec-* children are Maestro's diagnostic extensions.
  return `<fct:sparql>${xmlText(meta.query)}</fct:sparql>`
    + `<fct:time>${Math.max(0, Math.round(meta.elapsedMs))}</fct:time>`
    + `<fct:complete>${meta.complete ? "yes" : "no"}</fct:complete>`
    + `<fct:timeout>${meta.timeoutMs}</fct:timeout>`
    + `<fct:db-activity>${xmlText(meta.execDbActivity ?? "")}</fct:db-activity>`
    + `<fct:processed>${meta.processed}</fct:processed>`
    + `<fct:view offset="${meta.offset}" limit="${meta.limit}"/>`
    + `<fct:sql-state>${xmlText(state)}</fct:sql-state>`
    + `<fct:sql-message>${xmlText(message)}</fct:sql-message>`
    + `<fct:exec-milliseconds>${xmlText(meta.execMilliseconds ?? "")}</fct:exec-milliseconds>`
    + (state === "S1TAT" ? `<fct:warning>${xmlText(message || "Virtuoso returned partial results because the ANYTIME timeout was reached.")}</fct:warning>` : "");
}

function fctUpstreamMetadata(response: Response, body: string): Pick<FctExecutionMetadata, "sqlState" | "sqlMessage" | "execMilliseconds" | "execDbActivity"> {
  const anytime = isVirtuosoAnytime(response, body);
  return {
    sqlState: response.headers.get("X-SQL-State")?.trim() || (anytime && response.status !== 206 ? "S1TAT" : ""),
    sqlMessage: anytime ? virtuosoAnytimeMessage(response, body) : response.headers.get("X-SQL-Message") ?? "",
    execMilliseconds: response.headers.get("X-Exec-Milliseconds") ?? "",
    execDbActivity: response.headers.get("X-Exec-DB-Activity") ?? "",
  };
}

function fctResponseXml(args: {
  query: string; view: string; limit: number; offset: number; executionAddr?: string; bindings?: Record<string, SparqlBindingTerm>[];
  vars?: string[]; elapsedMs: number; complete: boolean; timeoutMs?: number; graphOnly?: boolean; countOnly?: boolean;
  labels?: Map<string, string>; error?: string;
  datatypeEvidence?: Array<{ datatype: string; originalDatatype?: string; count: number }>;
  badgeColumns?: Array<{ colName: string; property: string; direction: "forward" | "reverse" }>;
  sqlState?: string; sqlMessage?: string; execMilliseconds?: string; execDbActivity?: string;
}): string {
  const { query, view, limit, offset, elapsedMs, complete, sqlState, sqlMessage, execMilliseconds, execDbActivity } = args;
  if (args.error) return `<fct:facets xmlns:fct="${FCT_NS}"><fct:sparql>${xmlText(query)}</fct:sparql><fct:time>${elapsedMs}</fct:time><fct:complete>no</fct:complete><fct:error>${xmlText(args.error)}</fct:error></fct:facets>`;
  const vars = args.vars ?? [];
  const bindings = args.bindings ?? [];
  const badgeMap = new Map((args.badgeColumns ?? []).map((b) => [b.colName, b]));
  let resultType = view === FCT_VIEW_TYPES.COUNT_DISTINCT ? FCT_VIEW_TYPES.COUNT_DISTINCT : args.countOnly ? "count" : args.graphOnly ? FCT_VIEW_TYPES.GRAPHS : view;
  const labelFor = (term: SparqlBindingTerm | undefined) =>
    term?.type === "uri" ? args.labels?.get(term.value) : undefined;
  const rows = bindings.map((binding) => {
    if (args.countOnly || view === FCT_VIEW_TYPES.COUNT_DISTINCT) {
      const count = binding.n ?? Object.values(binding)[0];
      return `<fct:row>${fctColumn(count, labelFor(count))}</fct:row>`;
    }
    return `<fct:row>${vars.map((name) => {
      const badgeInfo = badgeMap.get(name);
      const extraAttrs: Record<string, string> = { var: name };
      if (badgeInfo) {
        extraAttrs.property = badgeInfo.property;
        extraAttrs.direction = badgeInfo.direction;
      }
      return fctColumn(binding[name], labelFor(binding[name]), extraAttrs);
    }).join("")}</fct:row>`;
  }).join("");
  const metadata = fctExecutionMetadataXml({
    query, elapsedMs, complete, timeoutMs: args.timeoutMs ?? 0,
    processed: bindings.length, limit, offset,
    sqlState, sqlMessage, execMilliseconds, execDbActivity,
  });
  const datatypeXml = args.datatypeEvidence?.length ? `<fct:datatypeEvidence>${args.datatypeEvidence.map(item =>
    `<fct:datatype iri="${xmlText(item.datatype)}" originalDatatype="${xmlText(item.originalDatatype ?? "")}" count="${item.count}"/>`).join("")}</fct:datatypeEvidence>` : "";
  return `<fct:facets xmlns:fct="${FCT_NS}"${args.executionAddr ? ` execution-addr="${xmlText(args.executionAddr)}"` : ""}>${metadata}${datatypeXml}<fct:result type="${xmlText(resultType)}">${rows}</fct:result></fct:facets>`;
}

/** Safe absolute RDF IRIs may use schemes beyond HTTP (e.g. urn:, gttp:).
 * Validate IRIREF syntax before interpolating a term into SPARQL VALUES.
 * RDF results may also be literals, which retain their datatype and language.
 */
function validProjectionIri(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:[^\s<>"{}|^`\\\u0000-\u001f]+$/u.test(value);
}

/** Validate projection facets already compiled from self-contained FCT XML.
 * Their order determines the returned value-column order. */
type FctValueColumn = { id: string; property: string; direction: "forward" | "reverse"; path?: string[];
  hops?: Array<{ id: string; iri: string; direction: "forward" | "reverse" }>; boundValues?: SparqlBindingTerm[] };
function readListValueProjections(input: unknown): FctValueColumn[] {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 24) throw new Error("list-values projections must be an array of at most 24 columns.");
  return input.map((raw: unknown) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid list-values projection.");
    const item = raw as Record<string, unknown>;
    if (typeof item.property !== "string" || !validProjectionIri(item.property) ||
        (item.direction !== "forward" && item.direction !== "reverse"))
      throw new Error("A list-values projection needs a valid predicate IRI and direction.");
    const path = item.path;
    if (path !== undefined && (!Array.isArray(path) || path.length === 0 || path.length > 16 ||
      path.some((step: unknown) => typeof step !== "string" || !validProjectionIri(step))))
      throw new Error("A list-values projection path needs 1–16 valid predicate IRIs.");
    const rawBoundValues = item.boundValues as SparqlBindingTerm[] | undefined;
    if (rawBoundValues !== undefined && (!Array.isArray(rawBoundValues) || rawBoundValues.length > 24 ||
        rawBoundValues.some((value: unknown) => {
          if (!value || typeof value !== "object" || Array.isArray(value)) return true;
          const term = value as Record<string, unknown>;
          if ((term.type !== "uri" && term.type !== "literal") || typeof term.value !== "string" || term.value.length > 4096) return true;
          if (term.type === "uri" && !validProjectionIri(term.value)) return true;
          if (term.datatype !== undefined && (term.type !== "literal" || typeof term.datatype !== "string" || !validProjectionIri(term.datatype))) return true;
          if (term["xml:lang"] !== undefined && (term.type !== "literal" || typeof term["xml:lang"] !== "string" || !/^[A-Za-z]+(?:-[A-Za-z0-9]+)*$/.test(term["xml:lang"]))) return true;
          return false;
        }))) throw new Error("Invalid bound RDF terms in list-values projection.");
    if (typeof item.id !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(item.id))
      throw new Error("Invalid FCT projected column ID.");
    const hops = item.hops;
    if (hops !== undefined && (!Array.isArray(hops) || hops.length < 1 || hops.length > 16 ||
      hops.some((hop: unknown) => !hop || typeof hop !== "object" || Array.isArray(hop) ||
        typeof (hop as { iri?: unknown }).iri !== "string" || !validProjectionIri((hop as { iri: string }).iri) ||
        ((hop as { direction?: string }).direction !== "forward" && (hop as { direction?: string }).direction !== "reverse"))))
      throw new Error("Invalid FCT projection anchor path.");
    return { id: item.id, property: item.property as string, direction: item.direction as "forward" | "reverse",
      ...(path !== undefined ? { path: path as string[] } : {}),
      ...(hops !== undefined ? { hops: hops as FctValueColumn["hops"] } : {}),
      ...(rawBoundValues?.length ? { boundValues: rawBoundValues as SparqlBindingTerm[] } : {}) };
  });
}

function serializeProjectionResource(term: SparqlBindingTerm): string | null {
  const value = term.value;
  if (typeof value !== "string" || value.length > 4096) return null;
  if (term.type === "uri") return validProjectionIri(value) ? `<${value}>` : null;
  if (term.type !== "literal" || /[\u0000-\u001f]/.test(value)) return null;
  const lang = term["xml:lang"];
  const datatype = term.datatype === "string" ? undefined : term.datatype;
  if (lang && (!/^[A-Za-z]+(?:-[A-Za-z0-9]+)*$/.test(lang) || datatype)) return null;
  if (datatype && !validProjectionIri(datatype)) return null;
  const text = JSON.stringify(value);
  return lang ? `${text}@${lang}` : datatype ? `${text}^^<${datatype}>` : text;
}

/**
 * Maestro list-values extension. The first query has already selected the page.
 * This second query only retrieves projected triples for those page resources.
 * It never joins two projected properties, so multivalued fields cannot cause
 * cross-products or displace a resource from the page. Every returned cell is
 * bounded to three distinct RDF terms in the proxy response.
 */
const MUI_STATUS = "gttp://ggg.maestro.ecosys/ns/ui#status";
const APPROVAL_PROVENANCE = new Set([
  "triggeredBy", "lastRequestedBy", "lastRequestDate", "matchedRecord", "lastRequestHistory", "lastRequestComponent",
].map(name => `gttp://ggg.maestro.ecosys/ns/ui#${name}`));

async function expandListValues(args: {
  endpoint: string;
  page: Record<string, SparqlBindingTerm>[];
  columns: FctValueColumn[];
  graph: string;
  timeoutMs: number;
  request: Request;
}): Promise<{ rows: Record<string, SparqlBindingTerm[]>; query: string; complete: boolean; upstream?: ReturnType<typeof fctUpstreamMetadata> }> {
  const uniqueTerms = new Map<string, string>();
  for (const row of args.page) {
    if (!row.c1) continue;
    const encoded = serializeProjectionResource(row.c1);
    if (encoded) uniqueTerms.set(encoded, row.c1.value);
  }
  const values = [...new Set(uniqueTerms.values())];
  const validIri = (value: string) => /^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(value);
  const columns = args.columns.slice(0, 24).filter((column) => validIri(column.property));
  if (!values.length || !columns.length) return { rows: {}, query: "", complete: true };
  if (args.graph && !validIri(args.graph)) throw new Error("Invalid RDF IRI in list-values projection.");
  const subjectValues = [...uniqueTerms.keys()].join(" ");
  // The standard list-values projection may cross two graphs: the live result
  // graph and the authenticated personal Status/approval-provenance graph.
  // Neither graph is discovered with GRAPH ?g (which could scan inaccessible
  // JDBC-backed Virtuoso views). Bind the exact graph in each branch.
  const groups = new Map<string, string[]>();
  for (const [index, column] of columns.entries()) {
    const path = column.path?.length ? column.path : [column.property];
    if (path.some(predicate => !validIri(predicate))) throw new Error("Invalid FCT list-values predicate path.");
    const isStatus = path.length === 1 && column.property === MUI_STATUS;
    const isProvenance = path.length === 1 && APPROVAL_PROVENANCE.has(column.property);
    const personal = isStatus || isProvenance;
    const sourceGraph = isStatus ? getPersonalStatusGraph(args.request) : isProvenance
      ? `${getUserGraph(args.request)}#policy-approvals` : args.graph;
    const key = personal ? "personal" : "source";
    const hops = column.hops?.length ? column.hops : path.map((iri, index) => ({
      iri, id: "", direction: index === 0 ? column.direction : "forward" as const,
    }));
    // Each hop gets its own direction; reversing the entire property path
    // would be incorrect for mixed <property>/<property-of> chains.
    const triple = hops.map((hop, index) => {
      const from = index === 0 ? "?resource" : `?hop_${columns.indexOf(column)}_${index}`;
      const to = index === hops.length - 1 ? "?value" : `?hop_${columns.indexOf(column)}_${index + 1}`;
      return hop.direction === "reverse" ? `${to} <${hop.iri}> ${from} .` : `${from} <${hop.iri}> ${to} .`;
    }).join(" ");
    const source = sourceGraph ? `GRAPH <${sourceGraph}> { ${triple} }` : triple;
    const branch = `{ VALUES ?resource { ${subjectValues} } VALUES ?column { ${JSON.stringify(column.id)} } ${source} }`;
    groups.set(key, [...(groups.get(key) ?? []), branch]);
  }
  const rows: Record<string, SparqlBindingTerm[]> = {};
  let complete = true;
  let upstream: ReturnType<typeof fctUpstreamMetadata> | undefined;
  const queries: string[] = [];
  for (const [kind, branches] of groups) {
    const query = `SELECT ?resource ?column ?value WHERE { ${branches.join(" UNION ")} }`;
    queries.push(query);
    let payload: SparqlJsonResults | null;
    if (kind === "personal") {
      // Use the authenticated personal session, not an unauthenticated fetch.
      payload = await queryPersonalSparql(query, args.timeoutMs, args.request) as unknown as SparqlJsonResults;
    } else {
      const result = await executeSparql(args.endpoint, query, undefined, args.timeoutMs, args.request.signal);
      if (!result.response.ok && !isVirtuosoAnytime(result.response, result.text))
        throw new Error(`list-values enrichment returned HTTP ${result.response.status}`);
      payload = parseResults(result.text);
      complete &&= result.response.status === 200 && !isVirtuosoAnytime(result.response, result.text);
      upstream = fctUpstreamMetadata(result.response, result.text);
      if (complete) setQueryCache(result.key, result.text);
    }
    for (const row of payload?.results?.bindings ?? []) {
      const resource = row.resource?.value;
      const position = columns.findIndex(column => column.id === row.column?.value);
      const value = row.value;
      if (!resource || !values.includes(resource) || position < 0 || !value) continue;
      const key = `${resource}\u0000${position}`;
      const existing = rows[key] ?? (rows[key] = []);
      if (existing.length >= 3) continue;
      if (existing.some(term => term.value === value.value && term.type === value.type && term.datatype === value.datatype && term["xml:lang"] === value["xml:lang"])) continue;
      existing.push(value);
    }
  }
  // A bound facet is both a normal FCT filter and a visible column. The
  // original selected page was scoped by that binding, so carry its exact RDF
  // lexical term into every cell even when the enrichment graph is incomplete.
  for (const [index, column] of columns.entries()) {
    for (const term of column.boundValues ?? []) {
      for (const resource of values) {
        const key = `${resource}\u0000${index}`;
        const existing = rows[key] ?? (rows[key] = []);
        if (!existing.some(item => item.type === term.type && item.value === term.value &&
            item.datatype === term.datatype && item["xml:lang"] === term["xml:lang"])) {
          if (existing.length >= 3) existing.pop();
          existing.unshift(term);
        }
      }
    }
  }
  // One authorized, bookmarked list-values projection returns the *effective*
  // Status state of every URI. This includes virtual Unseen and Pending, and
  // curated Approved without requiring copied provider approval triples.
  const statusColumns = columns.flatMap((column, index) => column.property === MUI_STATUS && column.direction === "forward" && !column.path?.length ? [index] : []);
  if (statusColumns.length) {
    const resourceIris = values.filter(validIri);
    // The approval store accepts bounded VALUES batches. A large FCT page
    // must not fail because it contains more than 500 distinct RDF subjects.
    const policies = [] as Awaited<ReturnType<typeof readPolicyApprovals>>;
    for (let index = 0; index < resourceIris.length; index += 500)
      policies.push(...await readPolicyApprovals(resourceIris.slice(index, index + 500), args.request));
    const approval = new Map(policies.map(item => [item.uri, item.status]));
    const MUI = "gttp://ggg.maestro.ecosys/ns/ui#";
    for (const resource of resourceIris) for (const index of statusColumns) {
      const key = `${resource}\u0000${index}`;
      const existing = rows[key] ?? [];
      // Discard stale legacy Pending/Approved literals; the current effective
      // approval is calculated from curator membership and implementation digest.
      const active = existing.filter(term => term.value !== `${MUI}Pending` && term.value !== `${MUI}Approved`);
      if (!active.some(term => term.value === `${MUI}Seen` || term.value === `${MUI}Unseen`))
        active.push({ type: "uri", value: `${MUI}Unseen` });
      const effectiveApproval = approval.get(resource);
      if (effectiveApproval) active.push({ type: "uri", value: `${MUI}${effectiveApproval}` });
      rows[key] = active;
    }
  }
  return { rows, query: queries.join("\n\n"), complete, upstream };
}

function listValuesXml(args: {
  page: Record<string, SparqlBindingTerm>[];
  columns: FctValueColumn[];
  expansion: Record<string, SparqlBindingTerm[]>;
  view: "list-values" | "merge-values";
  labels: Map<string, string>;
  query: string;
  limit: number;
  offset: number;
  elapsed: number;
  complete: boolean;
  timeoutMs: number;
  upstream?: ReturnType<typeof fctUpstreamMetadata>;
}): string {
  const rows = args.page.map((binding) => {
    const focus = binding.c1;
    const resource = focus?.value ?? "";
    const label = args.labels.get(resource) ?? (focus?.type === "uri" ? uriFallbackLabel(resource) : resource);
    const cells = args.columns.map((column, i) => {
      const terms = args.expansion[`${resource}\u0000${i}`] ?? [];
      // Each property cell contains zero to three typed RDF values. Preserve
      // the projection's XML order even for empty fields.
      return `<fct:column id="${xmlText(column.id)}" property="${xmlText(column.property)}" direction="${column.direction}" path="${xmlText((column.path ?? [column.property]).join(" "))}" var="${xmlText(column.id)}">${terms.map((term) => {
        const datatype = term.type === "uri" ? "uri" : isBlankNodeTerm(term.type) ? "bnode" : term.datatype;
        return `<fct:value${datatype ? ` datatype="${xmlText(datatype)}"` : ""}${term["xml:lang"] ? ` xml:lang="${xmlText(term["xml:lang"])}"` : ""}>${xmlText(term.value)}</fct:value>`;
      }).join("")}</fct:column>`;
    }).join("");
    return `<fct:row>${fctColumn(focus, args.labels.get(resource), { var: "c1" })}${fctColumn({ type: "literal", value: label }, undefined, { var: "c2" })}${cells}</fct:row>`;
  }).join("");
  const metadata = fctExecutionMetadataXml({
    query: args.query, elapsedMs: args.elapsed, complete: args.complete,
    timeoutMs: args.timeoutMs, processed: args.page.length,
    offset: args.offset, limit: args.limit, ...args.upstream,
  });
  return `<fct:facets xmlns:fct="${FCT_NS}">${metadata}<fct:result type="${args.view}">${rows}</fct:result></fct:facets>`;
}

function parseDescribeRdfXml(source: string): Record<string, SparqlBindingTerm>[] {
  const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", removeNSPrefix: false, parseTagValue: false, trimValues: true }).parse(source) as Record<string, unknown>;
  const rootKey = Object.keys(parsed).find((key) => key === "rdf:RDF" || key.endsWith(":RDF") || key === "RDF");
  if (!rootKey || !parsed[rootKey] || typeof parsed[rootKey] !== "object") throw new Error("Virtuoso DESCRIBE did not return parseable RDF/XML.");
  const root = parsed[rootKey] as Record<string, unknown>;
  const namespaces = new Map<string, string>();
  for (const [key, value] of Object.entries(root)) {
    if (key.startsWith("@_xmlns:")) namespaces.set(key.slice(8), String(value));
    else if (key === "@_xmlns") namespaces.set("", String(value));
  }
  const descriptions = Object.entries(root).filter(([key]) => !key.startsWith("@_") && key !== "#text");
  const rows: Record<string, SparqlBindingTerm>[] = [];
  for (const rawDescription of descriptions.map(([, value]) => value)) {
    for (const description of Array.isArray(rawDescription) ? rawDescription : [rawDescription]) {
      if (!description || typeof description !== "object") continue;
      const node = description as Record<string, unknown>;
      const about = String(node["@_rdf:about"] ?? "");
      const nodeId = String(node["@_rdf:nodeID"] ?? "");
      const subject: SparqlBindingTerm | null = about ? { type: "uri", value: about } : nodeId ? { type: "bnode", value: nodeId } : null;
      if (!subject) continue;
      for (const [predicateQName, rawObjects] of Object.entries(node)) {
        if (predicateQName.startsWith("@_") || predicateQName === "#text") continue;
        const [prefix, local] = predicateQName.includes(":") ? predicateQName.split(":", 2) : ["", predicateQName];
        const namespace = namespaces.get(prefix);
        if (!namespace) continue;
        const predicate = { type: "uri", value: namespace + local };
        for (const rawObject of Array.isArray(rawObjects) ? rawObjects : [rawObjects]) {
          if (rawObject && typeof rawObject === "object") {
            const objectNode = rawObject as Record<string, unknown>;
            const resource = objectNode["@_rdf:resource"];
            const blank = objectNode["@_rdf:nodeID"];
            const datatype = objectNode["@_rdf:datatype"];
            const lang = objectNode["@_xml:lang"];
            const textValue = String(objectNode["#text"] ?? "");
            const object: SparqlBindingTerm = resource ? { type: "uri", value: String(resource) } : blank ? { type: "bnode", value: String(blank) } : { type: "literal", value: textValue, ...(datatype ? { datatype: String(datatype) } : {}), ...(lang ? { "xml:lang": String(lang) } : {}) };
            rows.push({ s: subject, p: predicate, o: object });
          } else rows.push({ s: subject, p: predicate, o: { type: "literal", value: String(rawObject ?? "") } });
        }
      }
    }
  }
  return rows;
}

export async function GET(request: Request) {
  logProxyCaller(request, "fct.GET");
  const url = new URL(request.url);
  if (url.searchParams.get("health") !== "1")
    return NextResponse.json({ error: "Use the courtesyGraphServers OpenAPI operation under /proxy/api/service." }, { status: 405 });

  const endpointId = url.searchParams.get("endpointId") ?? "";
  const preferredUrl = url.searchParams.get("graphServerUrl")?.trim() ?? "";
  // An explicit URL needs no courtesy-registry lookup. Health is optional
  // telemetry and must never block address selection or query execution.
  let endpoint: Awaited<ReturnType<typeof getConfiguredFctEndpoints>>[number] | undefined;
  if (preferredUrl) {
    if (!permittedGraphServerTarget(preferredUrl))
      return NextResponse.json({ error: "Invalid graph server health-check URL." }, { status: 400 });
    endpoint = { id: endpointId || `shared:${encodeURIComponent(preferredUrl)}`,
      url: preferredUrl, label: preferredUrl, group: "Shared" };
  } else {
    try { endpoint = (await getConfiguredFctEndpoints()).find(item => item.id === endpointId); }
    catch (error) { return NextResponse.json({ error: `Courtesy list unavailable: ${describeUpstreamError(error)}` }, { status: 503 }); }
  }
  if (!endpoint) return NextResponse.json({ error: "Invalid graph server health-check address." }, { status: 400 });

  // The live FCT addr is authoritative. A host-only registered server may
  // explicitly be addressed over HTTP although the registry infers HTTPS.
  // Validate the preferred URL against that entry: this route is not an
  // arbitrary URL-fetching health proxy.
  if (preferredUrl && !permittedGraphServerTarget(preferredUrl)) {
    return NextResponse.json({ error: "Invalid graph server health-check URL." }, { status: 400 });
  }
  const candidates = preferredUrl ? [preferredUrl] : [endpoint.url];
  if (!preferredUrl && endpoint.schemeInferred && endpoint.url.startsWith("https://")) {
    candidates.push(endpoint.url.replace(/^https:\/\//, "http://"));
  }

  let lastCheck: Awaited<ReturnType<typeof probeSparqlEndpoint>> | undefined;
  const attempts: NonNullable<typeof lastCheck>["attempts"] = [];
  for (const candidate of candidates) {
    // Never silently downgrade an inferred HTTPS endpoint on an authentication
    // error, timeout or protocol-format failure; the original HTTP fallback
    // is permitted only after HTTPS really returned 404. An explicit HTTP
    // live-query addr is checked over HTTP without any fallback.
    if (candidate !== candidates[0] && lastCheck?.status !== 404) break;
    await checkGraphServerDestination(candidate);
    const check = await probeSparqlEndpoint(candidate);
    attempts.push(...check.attempts);
    if (check.state === "ok") return NextResponse.json({ check: { id: endpoint.id, ...check, attempts } });
    lastCheck = check;
  }
  return NextResponse.json({ check: { id: endpoint.id, ...lastCheck, attempts } });
}

async function handlePost(request: Request) {
  // Request-scoped language; never keep a cross-user server preference.
  const effectiveLanguage = validMaestroLanguage(request.headers.get("x-maestro-language")) ?? "en";
  // Display-label selection obeys the same effective Sheet/URL language as FCT
  // execution. For 'all', preserve normal browser Accept-Language fallback.
  const labelAcceptLanguage = effectiveLanguage === "all"
    ? request.headers.get("accept-language") : effectiveLanguage;
  const compileFctXmlToSparql = (...args: Parameters<typeof compileFctXmlBase>) =>
    compileFctXmlBase(args[0], args[1], args[2], args[3], args[4], args[5], args[6], effectiveLanguage, args[8], args[9]);
  logProxyCaller(request, "fct.POST");
  let stage: "compile" | "execute" = "compile";
  try {
    // Quotas travel with the FCT query instead of a separate preferences API.
    const clientQuota = request.headers.get("x-maestro-concurrency");
    if (clientQuota) {
      try {
        const limits = JSON.parse(clientQuota) as unknown;
        const valid = limits && typeof limits === "object" && ["proxyConnections", "lightPerServer", "heavyPerServer"]
          .every(key => Number.isInteger((limits as Record<string, unknown>)[key]));
        if (valid && clientQuota.length <= 400) {
          saveProxyClientPreferences(clientFromRequest(request) ?? "anonymous", normalizeMaestroConcurrency(limits));
          rescheduleMaestroQueries();
        }
      } catch { /* Invalid advisory quota leaves safe defaults in place. */ }
    }
    const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
    const requestBodyText = await request.text();
    const body: Record<string, unknown> | null = contentType.includes("xml")
      ? { queryXml: requestBodyText }
      : (() => { try { return JSON.parse(requestBodyText) as Record<string, unknown>; } catch { return null; } })();
    let queryXml = typeof body?.queryXml === "string" ? body.queryXml.trim() : "";
    if (!queryXml && typeof body?.text === "string") {
      return fctError('A text query must be wrapped in an FCT <query> containing addr.', 400);
    }
    if (!queryXml) return fctError("An FCT query XML document is required.", 400);

    // Resolve the endpoint from this query's address, not the mutable selection
    // state. Only the first @ separates graph from graph-server URI.
    const rootTag = queryXml.match(/<query\b([^>]*)>/i)?.[1] ?? "";
    const addrMatch = rootTag.match(/\baddr\s*=\s*(["'])(.*?)\1/i);
    let address = addrMatch ? xmlAttributeValue(addrMatch[2]) : undefined;
    const delimiter = address?.indexOf("@") ?? -1;
    if (delimiter < 0 || !address?.slice(delimiter + 1).trim()) {
      return fctError('Every FCT query must have a valid addr="graph@graphserver" attribute; graph may be empty.', 400);
    }
    // The graph component of addr is an RDF graph IRI. Fragments are part of
    // graph identity (e.g. http://dbpedia.org/resource/classes#) and must not
    // be removed. Removing '#' silently changes the queried graph.
    const serverAddress = normalizeGraphServerUri(address.slice(delimiter + 1).trim());
    // addr is the execution authority. The seed list is not an allowlist.
    // Reject unsafe proxy targets, not previously unknown Shared addresses.
    if (!permittedGraphServerTarget(serverAddress)) return fctError("Invalid or unsafe graph server in query addr.", 400);
    const endpoint = { url: serverAddress };

    // Explicit <status addr> may only federate against configured graph servers.
    // Never allow untrusted FCT XML to become an unrestricted SERVICE target.
    const statusDocument = new XMLParser({ignoreAttributes:false,attributeNamePrefix:"@_",removeNSPrefix:true}).parse(queryXml) as unknown;
    const requestedStatusAddresses: string[] = [];
    const collectStatusAddresses = (value: unknown): void => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) { value.forEach(collectStatusAddresses); return; }
      for (const [tag, child] of Object.entries(value)) {
        if (tag === "status" && child && typeof child === "object") {
          for (const item of Array.isArray(child) ? child : [child]) {
            const address = (item as Record<string,unknown>)["@_addr"];
            if (address !== undefined) {
              if (typeof address !== "string") throw new Error("Invalid FCT status addr.");
              requestedStatusAddresses.push(address);
            }
          }
        }
        collectStatusAddresses(child);
      }
    };
    collectStatusAddresses(statusDocument);
    for (const statusAddress of requestedStatusAddresses) {
      const at = statusAddress.indexOf("@");
      if (at <= 0 || !statusAddress.slice(at + 1)) return fctError("Invalid status addr; expected graph@graphserver.", 400);
      const server = normalizeGraphServerUri(statusAddress.slice(at + 1).trim());
      if (!permittedGraphServerTarget(server))
        return fctError("Invalid or unsafe graph server in status addr.", 400);
    }

    // Discovery is deliberately separate from graph-server health. Green only
    // proves that the endpoint answers a cheap probe; ranking all matching
    // GRAPH ?g bindings is an expensive, possibly unsupported aggregation.
    if (body?.discoverGraph === true) {
      const addressGraph = address?.slice(0, delimiter).trim() ?? "";
      if (addressGraph === ALL_GRAPHS) return NextResponse.json({ graph: null, found: false, selection: "everywhere" });
      if (addressGraph) return NextResponse.json({ graph: addressGraph, found: true, selection: "explicit" });
      const rankedDiscovery = compileFctXmlToSparql(queryXml, undefined, false, false, true);
      if (!rankedDiscovery.graphDiscoveryHasSourcePattern) {
        // Do not run GRAPH ?g { } for an unbound root query. Nothing in that
        // scope can identify which named graph is relevant to this live view.
        return NextResponse.json({ graph: null, found: false, selection: "unscoped" });
      }

      // Preserve the ranked selection when affordable, but do not let a single
      // global MAX(IRI_RANK)/GROUP BY query monopolize the selected server.
      // The fallback uses the IDENTICAL FCT focus and filters, selecting a
      // first matching named graph without the rank aggregate.
      type DiscoveryAttempt = { ok: true; graph: string | null } |
        { ok: false; timeout: boolean; status: number };
      const tryDiscovery = async (mode: "ranked" | "first-match"): Promise<DiscoveryAttempt> => {
        const timeoutMs = mode === "ranked" ? 5500 : 10000;
        const attemptSignal = request.signal;
        const compiled = mode === "ranked" ? rankedDiscovery : compileFctXmlToSparql(queryXml, undefined, false, false, "first");
        try {
          stage = "execute";
          const result = await executeSparql(endpoint.url, compiled.query, undefined, timeoutMs, attemptSignal);
          const timeout = result.response.status === 504 || result.response.status === 206 ||
            isVirtuosoAnytime(result.response, result.text);
          if (!result.response.ok || timeout)
            return { ok: false, timeout, status: result.response.status };
          const parsed = parseResults(result.text);
          if (!parsed) return { ok: false, timeout: false, status: 502 };
          const binding = parsed.results?.bindings?.[0]?.c1;
          if (!binding) return { ok: true, graph: null };
          if (binding.type !== "uri" || !binding.value)
            return { ok: false, timeout: false, status: 502 };
          return { ok: true, graph: binding.value };
        } catch (error) {
          if (request.signal.aborted) throw error;
          const timedOut = attemptSignal.aborted || /timed? out|timeout|signal timed out/i.test(
            error instanceof Error ? error.message : String(error));
          return { ok: false, timeout: timedOut, status: timedOut ? 504 : 502 };
        }
      };
      const ranked = await tryDiscovery("ranked");
      if (ranked.ok) {
        proxyLog("debug", "fct.graph-discovery.ranked", { found: Boolean(ranked.graph), status: 200 });
        return NextResponse.json({ graph: ranked.graph, found: Boolean(ranked.graph), selection: "ranked" });
      }
      const first = await tryDiscovery("first-match");
      if (first.ok) {
        proxyLog("info", "fct.graph-discovery.fallback", { found: Boolean(first.graph), status: 200 });
        return NextResponse.json({ graph: first.graph, found: Boolean(first.graph), selection: "first-match" });
      }
      const timedOut = ranked.timeout || first.timeout;
      // Never return the SPARQL source to the browser on a failure. It can
      // contain user-supplied literal searches or personal status filters.
      proxyLog("warn", "fct.graph-discovery.unavailable", {
        status: timedOut ? 504 : 502, rankedStatus: ranked.status, fallbackStatus: first.status,
      });
      return NextResponse.json({
        error: timedOut ? "Graph discovery timed out; the graph server health check is independent."
          : "Graph discovery failed; the graph server may still be healthy.",
        code: timedOut ? "GRAPH_DISCOVERY_TIMEOUT" : "GRAPH_DISCOVERY_UNAVAILABLE",
      }, { status: timedOut ? 504 : 502 });
    }
    const view = typeof body?.view === "string" ? body.view : undefined;
    const graphOnly = body?.graphOnly === true;
    let countOnly = body?.countOnly === true;
    let compiled = compileFctXmlToSparql(queryXml, view, graphOnly, countOnly);
    countOnly = compiled.countOnly;
    if (body?.projections !== undefined || body?.resources !== undefined)
      return fctError("JSON list-values projection/resource payloads are retired; declare scoped properties and RDF terms in FCT XML.", 400);
    const valueColumns = (compiled.view === FCT_VIEW_TYPES.LIST_VALUES || compiled.view === FCT_VIEW_TYPES.MERGE_VALUES)
      ? readListValueProjections(compiled.listValueProjections) : [];
    const statusProjection = valueColumns.some(column => column.property === MUI_STATUS || APPROVAL_PROVENANCE.has(column.property));
    // A read of personal status/provenance requires an actual Bookmark, even
    // through the generic list-values FCT projection. A client flag is not enough.
    if (statusProjection) {
      const saved = body?.bookmarkQueryXml;
      if (typeof saved !== "string" || !(await verifyApprovalBookmark(saved, request)))
        return fctError("Bookmark the live query before reading provider statuses.", 409);
      const sourceAddr = saved.match(/<query\b[^>]*\baddr\s*=\s*(["'])(.*?)\1/i)?.[2];
      const projectionAddr = queryXml.match(/<query\b[^>]*\baddr\s*=\s*(["'])(.*?)\1/i)?.[2];
      if (!sourceAddr || sourceAddr !== projectionAddr) return fctError("Status projection source must match the bookmarked live graph address.", 409);
    }
    const hasStatusConstraints = compiled.statusBindings.length > 0;
    // A Features query must observe curated approvals *before* executing its
    // FCT status filter. This must not depend on having a <status> node: an
    // ordinary, bookmarked Features query also needs its Status facet counts.
    const bookmarkQueryXml = typeof body?.bookmarkQueryXml === "string" ? body.bookmarkQueryXml : queryXml;
    // Read-only Feature catalogs are ordinary FCT queries. Never verify a
    // bookmark merely to fetch a list of provider resources: approval metadata
    // is discovered independently by the browser's SPARQL policy reader.

    // list-status is an FCT view, not a policy-approvals JSON API.  Its focus
    // is the (unpaginated) cloned live query; the personal Status graph supplies
    // the grouped status bindings. The federated compiler omits SERVICE when
    // the live graph server and the personal server are identical.
    if (compiled.view === FCT_VIEW_TYPES.LIST_STATUS && !countOnly && !graphOnly) {
      if (!(await verifyApprovalBookmark(bookmarkQueryXml, request))) return fctError("Bookmark the live query before reading Status.", 409);
      // The bookmark has already been verified against the personal store.
      // Build the Status view *from that verified source*, never from a second
      // client-serialized DOM. The previous equality check compared a browser
      // XMLSerializer rendering against the live serializer and could return a
      // false 409 even though both were sent in the very same request.
      // Ignoring the caller's projection also prevents it from broadening the
      // bookmarked selection: only the bookmarked query supplies graph, path,
      // class, text, value and other predicates.
      const statusViewXml = cloneFctListStatusView(bookmarkQueryXml);
      const personalEndpoint = personalSparqlUrl(request).toString();
      const statusSelection = compileFctXmlToSparql(statusViewXml, undefined, false, false, false, false, {
        liveEndpoint: endpoint.url, executionEndpoint: personalEndpoint,
        defaultStatusAddr: `${getPersonalStatusGraph(request)}@${personalEndpoint}`,
        validateShapesGraph: getShapesGraph(request),
        providerOtcGraph: graphForFile("otc-transcoders.rdf",request),
      });
      if (statusSelection.view !== FCT_VIEW_TYPES.LIST_STATUS)
        return fctError("Could not derive Status from the bookmarked live query.", 400);
      const query = statusSelection.query;
      const started = Date.now();
      const statusTrace = {executionEndpoint: personalEndpoint, liveEndpoint: endpoint.url,
        statusGraph: getPersonalStatusGraph(request), timeoutMs:compiled.timeoutMs};
      // Restore the pre-regression Status path from maestro 2.zip: the
      // session-scoped personal SPARQL reader also used by Bookmarks/Providers.
      // Keep the existing FCT status compilation and graph exactly as-is.
      let parsed: SparqlJsonResults;
      try {
        parsed = await queryPersonalSparql(query, compiled.timeoutMs, request) as SparqlJsonResults;
        proxyLog("debug", "status.sparql.success", { status: 200, elapsedMs: Date.now()-started,
          rows: parsed.results?.bindings?.length ?? 0, ...statusTrace });
      } catch (error) {
        const status = error instanceof PersonalSparqlHttpError ? error.status : null;
        proxyLog("debug", "status.sparql.failure", { ...statusTrace, status,
          elapsedMs: Date.now()-started, responseBody: error instanceof PersonalSparqlHttpError ? error.responseBody : "",
          errorName: error instanceof Error ? error.name : "unknown" });
        if (status === 401 || status === 403) {
          // The ErrorDetails popover/copy action must contain the upstream
          // response *actually received* by the proxy, not merely our 401
          // interpretation. It cannot report SR619 unless ODS returned SR619.
          const upstreamBody = error instanceof PersonalSparqlHttpError
            ? sanitizeUpstreamDiagnostic(error.responseBody, 16000)
            : describeUpstreamError(error);
          const diagnostics = [
            `Executing SPARQL endpoint: ${sanitizeUpstreamDiagnostic(personalEndpoint)}`,
            `Remote population endpoint: ${sanitizeUpstreamDiagnostic(endpoint.url)}`,
            `Status graph: ${sanitizeUpstreamDiagnostic(getPersonalStatusGraph(request))}`,
            `Upstream response status: HTTP ${status}`,
            `Elapsed: ${Date.now() - started} ms`,
            `Upstream response body:`, upstreamBody || "(empty response)",
            `SPARQL submitted by Maestro:`, sanitizeUpstreamDiagnostic(query, 16000),
          ].join("\n");
          const failure = fctError(`Status SPARQL returned HTTP ${status}: personal store authorization required.`, status, diagnostics);
          // Opt-in browser Console diagnosis, independent from the real SPARQL response.
          // The session credential is never placed into an HTTP response header.
          failure.headers.set("X-Maestro-Status-Debug", Buffer.from(JSON.stringify({
            ...statusTrace, query: query.slice(0, 2500), queryTruncated: query.length > 2500,
            status, elapsedMs: Date.now()-started,
            responseBody: error instanceof PersonalSparqlHttpError ? error.responseBody.slice(0, 1200) : "",
          }), "utf8").toString("base64"));
          failure.headers.set("Cache-Control", "no-store");
          return failure;
        }
        throw error;
      }
      return new Response(fctResponseXml({ query, view: FCT_VIEW_TYPES.LIST_STATUS, limit: 0, offset: 0,
        executionAddr: updateFctExecutionAddress(address, { graph: getPersonalStatusGraph(request), endpoint: personalEndpoint }),
        bindings: (parsed.results?.bindings ?? []).map(row => ({ c1: row.status, c2: row.count })),
        vars: ["c1", "c2"], elapsedMs: Date.now() - started, complete: true,
        timeoutMs: compiled.timeoutMs }), { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store" } });
    }
    const isValidate = compiled.view === FCT_VIEW_TYPES.VALIDATE && !graphOnly && !countOnly;
    if (isValidate && !getPersonalSession(request))
      return fctError("Log in before discovering SHACL shapes.", 401);
    const executionEndpoint = (hasStatusConstraints || isValidate) ? personalSparqlUrl(request).toString() : endpoint.url;
    if (hasStatusConstraints || isValidate) {
      // Compile all status constraints directly from the FCT XML. No SPARQL
      // post-processing, WHERE extraction, or variable rewriting is permitted.
      const personalEndpoint = personalSparqlUrl(request).toString();
      compiled = compileFctXmlToSparql(queryXml, view, graphOnly, countOnly, false, false, {
        liveEndpoint: endpoint.url, executionEndpoint: personalEndpoint,
        defaultStatusAddr: `${getPersonalStatusGraph(request)}@${personalEndpoint}`,
        validateShapesGraph: getShapesGraph(request),
        providerOtcGraph: graphForFile("otc-transcoders.rdf",request),
      });
    }
    const isDescribe = compiled.view === FCT_VIEW_TYPES.DESCRIBE;
    const responseCacheKey = queryCacheKey(
      // A Graphs response from an older query compiler must never survive
      // into the current grouped, rank-ordered Graphs pagination format.
      // Counted LIST also changes its projection without changing FCT XML.
      compiled.view === FCT_VIEW_TYPES.PROPERTIES_RANK ? "fct-response-predicate-rank-fur-v1" :
      compiled.graphOnly ? "fct-response-graphs-v2" : "fct-response-page-labels-v2-anytime-v1-counted-population-v1",
      endpoint.url,
      JSON.stringify([queryXml, view ?? null, graphOnly, countOnly, valueColumns, labelAcceptLanguage ?? ""]),
    );
    // An already-selected resource page is expressed by root <value> terms
    // in the XML query itself. No parallel JSON resource list or projection
    // selector can override the FCT population.
    // Personal-status selections can change without changing the live FCT XML.
    // Never serve an old state-constrained response from the proxy cache.
    const componentRetry = request.headers.get("x-maestro-component-retry") === "1";
    const cachedResponse = (hasStatusConstraints || isValidate || componentRetry) ? null : getQueryCache<{ body: string; contentType: string; status: number }>(responseCacheKey);
    if (cachedResponse) {
      return new Response(cachedResponse.body, {
        status: cachedResponse.status,
        headers: { "Content-Type": cachedResponse.contentType, "Cache-Control": "no-store", "X-Maestro-Cache": "HIT" },
      });
    }
    stage = "execute";
    if ([FCT_VIEW_TYPES.PROPERTIES_RANK, FCT_VIEW_TYPES.PROPERTIES_CLUSTER, FCT_VIEW_TYPES.CLUSTERS].includes(compiled.view as typeof FCT_VIEW_TYPES.PROPERTIES_RANK | typeof FCT_VIEW_TYPES.PROPERTIES_CLUSTER | typeof FCT_VIEW_TYPES.CLUSTERS)) {
      if (countOnly || graphOnly) return fctError("Predicate analytics requires a normal FCT view request.", 400);
      const startedAt = Date.now();
      const { key: normalizedScope, cutoff } = predicateAnalysisScope(queryXml);
      const fur = compiled.view === FCT_VIEW_TYPES.PROPERTIES_RANK && compiled.predicateRankAlgorithm === "fur";
      const analyticsKey = queryCacheKey(fur ? "fct-predicate-fur-v1" : "fct-predicate-analytics-v2", executionEndpoint,
        JSON.stringify([normalizedScope, effectiveLanguage, labelAcceptLanguage, compiled.timeoutMs,
          compiled.maxPredicateCandidates, compiled.maxPredicateIncidenceRows,
          hasStatusConstraints ? clientFromRequest(request) : "public"]));
      const bypass = hasStatusConstraints || componentRetry;
      const cached = bypass ? undefined : getQueryCache<PredicateAnalysis>(analyticsKey);
      // If a complete structural cluster run is cached or already in flight,
      // structural ranks are free. On a cache miss, rank alone never runs AHC.
      // A rank-only result must never be cached as a full cluster analysis.
      const structuralRankOnly = !fur && compiled.view === FCT_VIEW_TYPES.PROPERTIES_RANK &&
        (bypass || (!cached && !pendingPredicateAnalytics.has(analyticsKey)));
      const workKey = structuralRankOnly ? queryCacheKey("fct-predicate-structural-rank-v1", executionEndpoint, analyticsKey) : analyticsKey;
      const cachedWork = cached ?? (bypass || !structuralRankOnly ? undefined : getQueryCache<PredicateAnalysis>(workKey));
      const federationContext = hasStatusConstraints ? {
        liveEndpoint: endpoint.url, executionEndpoint,
        defaultStatusAddr: `${getPersonalStatusGraph(request)}@${executionEndpoint}`,
      } : undefined;
      // Keep the provider's timeout on the actual Virtuoso request URL,
      // not only in the POST form, so public front-ends do not silently
      // execute the default 10-second budget. Scope this to predicate analytics.
      const analyticsSparqlEndpoint = predicateAnalyticsEndpointWithTimeout(executionEndpoint, compiled.timeoutMs);
      const build = async (signal: AbortSignal): Promise<PredicateAnalysis> => {
        const requireIncidencePage = async (query: string, phase: PredicateUpstreamPhase = "incidence"): Promise<SparqlJsonResults> => {
          signal.throwIfAborted();
          let upstream: Awaited<ReturnType<typeof executeSparql>>;
          // Do not interleave cached pages from separate source snapshots.
          try { upstream = await executeSparql(analyticsSparqlEndpoint, query, undefined, compiled.timeoutMs, signal, true); }
          catch (cause) {
            if (signal.aborted) throw cause;
            const detail = describeUpstreamError(cause);
            throw new PredicateAnalyticsQueryError(`Predicate analysis ${phase} transport failed before Virtuoso returned an HTTP response: ${detail}`,
              /timed? out|timeout|abort/i.test(detail) ? 504 : 502);
          }
          const interrupted = upstream.response.status === 206 || isVirtuosoAnytime(upstream.response, upstream.text);
          if (interrupted || upstream.response.status !== 200)
            throw predicateAnalyticsUpstreamFailure({phase, response: upstream.response,
              body: upstream.text, query, endpoint: analyticsSparqlEndpoint});
          const data = parseResults(upstream.text);
          if (!data) throw predicateAnalyticsUpstreamFailure({phase, response: upstream.response,
            body: upstream.text, query, endpoint: analyticsSparqlEndpoint,
            proxyStatus: 502, explanation: "Invalid SPARQL Results JSON returned by Virtuoso"});
          return data;
        };
        const pageSize = 500;
        if (fur) {
          // FUR does not need AHC or subject-overlap statistics. Fetch exact
          // aggregate frequencies independently of the structural cluster run.
          try {
            const ranks = await collectFacetUtilityRanking(async statisticsStage => {
              const query = compileFctXmlToSparql(queryXml, view, false, false, false, false,
                federationContext, undefined, undefined, statisticsStage).query;
              const data = await requireIncidencePage(query,
                statisticsStage.kind === "coverage" ? "counts" : statisticsStage.kind);
              return data.results?.bindings ?? [];
            }, compiled.maxPredicateCandidates ?? 200, compiled.maxPredicateIncidenceRows ?? 50000, signal, pageSize);
            return { ranks, assignments: [], clusters: [] };
          } catch (error) {
            if (error instanceof FacetUtilityStatisticsError)
              throw new PredicateAnalyticsQueryError(error.message, error.status);
            throw error;
          }
        }
        const accum = new PredicateIncidenceAccumulator(compiled.maxPredicateCandidates ?? 200,
          compiled.maxPredicateIncidenceRows ?? 50000);
        // Pages are sorted by focus URI and predicate URI. A full page does
        // not prove completeness; fetch one more (possibly empty) page.
        for (let offset = 0; ; offset += pageSize) {
          signal.throwIfAborted();
          const incidenceQuery = compileFctXmlToSparql(
            queryXml, view, false, false, false, false, federationContext, undefined, undefined,
            {kind:"incidence", offset, limit:pageSize},
          );
          const data = await requireIncidencePage(incidenceQuery.query);
          const focusName = incidenceQuery.target.replace(/^\?/, "");
          const rows = (data.results?.bindings ?? []).map(row => ({
            subject: row[focusName], predicate: row.maestroPredicate,
          }));
          try {
            if (accum.addPage(rows, pageSize)) break;
          } catch (error) {
            throw new PredicateAnalyticsQueryError(error instanceof Error ? error.message : "Invalid predicate incidence page.",
              /exceeds the configured|population exceeds/.test(String(error)) ? 422 : 502);
          }
        }
        try { return accum.result(cutoff, structuralRankOnly); }
        catch (err) { throw new PredicateAnalyticsQueryError(err instanceof Error ? err.message : "Invalid predicate incidence statistics."); }

      };
      try {
        const analysis = cachedWork ?? (bypass ? await build(request.signal)
          : await awaitPredicateAnalysis(workKey, request.signal, async signal => {
              const computed = await build(signal);
              if (!signal.aborted) setQueryCache(workKey, computed);
              return computed;
            }));
        request.signal.throwIfAborted();
        const page = predicateAnalysisPage(analysis, compiled.view as "properties-rank" | "properties-cluster" | "clusters", compiled.offset, compiled.limit);
        const nTerm = (n: number): SparqlBindingTerm => ({ type: "literal", value: String(n), datatype: "http://www.w3.org/2001/XMLSchema#integer" });
        const rows: Array<Record<string, SparqlBindingTerm>> = compiled.view === FCT_VIEW_TYPES.PROPERTIES_RANK
          ? (page as PredicateAnalysis["ranks"]).map(row => ({ c1: { type: "uri", value: row.property }, rank: nTerm(row.rank) }))
          : compiled.view === FCT_VIEW_TYPES.PROPERTIES_CLUSTER
            ? (page as PredicateAnalysis["assignments"]).map(row => ({ c1: { type: "uri", value: row.property }, cluster: { type: "literal", value: row.cluster } }))
            : (page as PredicateAnalysis["clusters"]).map(row => ({
                c1: { type: "literal", value: row.cluster }, n: nTerm(row.count), sample: { type: "uri", value: row.sample },
              }));
        const labels = await resolveFctLabels(endpoint.url, rows, labelAcceptLanguage, Math.min(compiled.timeoutMs || 5000, 5000), request.signal);
        if (compiled.view === FCT_VIEW_TYPES.CLUSTERS) {
          for (const row of rows) row.sampleLabel = { type: "literal", value: labels.get(row.sample.value) ?? uriFallbackLabel(row.sample.value) };
        }
        const vars = compiled.view === FCT_VIEW_TYPES.PROPERTIES_RANK ? ["c1", "rank"] :
          compiled.view === FCT_VIEW_TYPES.PROPERTIES_CLUSTER ? ["c1", "cluster"] : ["c1", "n", "sample", "sampleLabel"];
        const xml = fctResponseXml({ query: compiled.query, view: compiled.view,
          limit: compiled.limit, offset: compiled.offset, bindings: rows, vars, labels,
          executionAddr: updateFctExecutionAddress(address, { endpoint: executionEndpoint,
            ...(hasStatusConstraints ? { graph: getPersonalStatusGraph(request) } : {}) }),
          elapsedMs: Date.now() - startedAt, complete: true, timeoutMs: compiled.timeoutMs,
        });
        if (!bypass) setQueryCache(responseCacheKey, { body: xml, contentType: "application/xml; charset=utf-8", status: 200 });
        return new Response(xml, { status: 200, headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store" } });
      } catch (error) {
        request.signal.throwIfAborted();
        if (error instanceof PredicateAnalyticsQueryError)
          return fctError(error.message, error.status);
        if (error instanceof PredicateAnalyticsUpstreamError)
          return error.toResponse();
        throw error;
      }
    }
    const startedAt = Date.now();
    let activeQuery = compiled.query;
    let queryResult = await executeSparql(executionEndpoint, activeQuery, isDescribe && !compiled.describeLiteral && !compiled.describeExpanded ? "application/rdf+xml, application/xml;q=0.9" : undefined, compiled.timeoutMs, request.signal, hasStatusConstraints || isValidate || componentRetry);
    let countFreeFallback = false;
    let unorderedFallback = false;
    // A failed IRI_RANK sort should not make the primary Results pane unusable.
    // This retry removes only Maestro's optional ordering, never scope constraints.
    if (!countOnly && !graphOnly && (compiled.view === FCT_VIEW_TYPES.TEXT || compiled.view === FCT_VIEW_TYPES.LIST || compiled.view === FCT_VIEW_TYPES.LIST_VALUES || compiled.view === FCT_VIEW_TYPES.MERGE_VALUES) &&
        !queryResult.response.ok && !isVirtuosoAnytime(queryResult.response, queryResult.text) &&
        virtuosoRankFailure(queryResult.text + " " + (queryResult.response.headers.get("X-SQL-Message") ?? "")) &&
        /<LONG::IRI_RANK>/i.test(activeQuery)) {
      const unorderedXml = queryXml.replace(/<query\b[^>]*>/i, (tag) =>
        /\border\s*=/.test(tag) ? tag.replace(/\border\s*=\s*(["']).*?\1/i, 'order="no"')
          : tag.replace(/>$/, ' order="no">'));
      const unorderedQuery = compileFctXmlToSparql(unorderedXml, view, graphOnly, countOnly, false, false,
        hasStatusConstraints ? {liveEndpoint:endpoint.url,executionEndpoint,
          defaultStatusAddr:`${getPersonalStatusGraph(request)}@${executionEndpoint}`} : undefined).query;
      if (unorderedQuery !== activeQuery) {
        activeQuery = unorderedQuery;
        queryResult = await executeSparql(executionEndpoint, activeQuery, undefined, compiled.timeoutMs, request.signal, hasStatusConstraints || componentRetry);
        unorderedFallback = true;
      }
    }
    if (!countOnly && !graphOnly && (compiled.view === FCT_VIEW_TYPES.PROPERTIES || compiled.view === FCT_VIEW_TYPES.PROPERTIES_IN || compiled.view === FCT_VIEW_TYPES.CLASSES) &&
        !queryResult.response.ok && !isVirtuosoAnytime(queryResult.response, queryResult.text) &&
        virtuosoAggregateFailure(queryResult.text + " " + (queryResult.response.headers.get("X-SQL-Message") ?? ""))) {
      const fallbackQuery = compileFctXmlToSparql(queryXml, view, graphOnly, false, false, true,
        hasStatusConstraints ? {liveEndpoint:endpoint.url,executionEndpoint,
          defaultStatusAddr:`${getPersonalStatusGraph(request)}@${executionEndpoint}`} : undefined).query;
      activeQuery = fallbackQuery;
      queryResult = await executeSparql(executionEndpoint, fallbackQuery, undefined, compiled.timeoutMs, request.signal, hasStatusConstraints || componentRetry);
      countFreeFallback = true;
    }
    const { response, text, key } = queryResult;
    const elapsedMs = Date.now() - startedAt;
    const sqlState = response.headers.get("X-SQL-State")?.trim() ?? "";
    const anytime = isVirtuosoAnytime(response, text);
    const partial = anytime || response.status === 206;
    const sqlMessage = response.headers.get("X-SQL-Message") ?? "";
    const execMilliseconds = response.headers.get("X-Exec-Milliseconds") ?? "";
    const execDbActivity = response.headers.get("X-Exec-DB-Activity") ?? "";
    // S1TAT identifies a partial result set; its HTTP status alone must not
    // cause Maestro to discard the valid rows in the response body.
    if (!response.ok && !anytime) {
      proxyLog("error", "fct.upstream", { status: response.status, sqlState, sqlMessage, responseBody: text.slice(0, 16000) });
      return fctUpstreamFailure("fct", response, text, activeQuery, executionEndpoint);
    }

    if (anytime) proxyLog("warn", "fct.anytime", { endpoint: endpoint.url, view: compiled.view, status: response.status, sqlState, message: virtuosoAnytimeMessage(response, text) });

    const incompleteHeaders = { ...anytimeResponseHeaders(response, partial), "X-Maestro-Upstream-Status": String(response.status), "X-Maestro-Upstream-Source": executionEndpoint !== endpoint.url ? "federated" : response.headers.get("X-Maestro-Upstream-Source") === "cache" ? "cache" : "network" };
    if (isDescribe) {
      let bindings: Record<string, SparqlBindingTerm>[];
      try {
        if (compiled.describeLiteral || compiled.describeExpanded) {
          const parsed = parseResults(text);
          if (!parsed) throw new Error("Invalid expanded/literal DESCRIBE SELECT response.");
          bindings = (parsed.results?.bindings ?? []).filter((row) => row.s?.value && row.p?.value && row.o?.value)
            .map((row) => ({ s: row.s, p: row.p, o: row.o }));
        } else {
          bindings = parseDescribeRdfXml(text);
        }
      }
      catch (error) {
        // An error-only S1TAT response is not an RDF result document.
        return fctUpstreamFailure("describe", response, text, activeQuery, executionEndpoint, 502,
          error instanceof Error ? error.message : "Invalid DESCRIBE response");
      }
      // Do not mistake a size-capped subgraph for a complete SHACL document.
      // No partial answer or cache entry is allowed to masquerade as source.
      if (compiled.describeExpanded && (partial || bindings.length > (compiled.describeMaxTriples ?? 0)))
        return fctUpstreamFailure("describe-expanded", response, text, activeQuery, executionEndpoint,
          partial ? undefined : 422, "Expanded RDF subgraph is incomplete or exceeds the configured bound");
      if (!hasStatusConstraints && !isValidate && response.status === 200 && !partial) setQueryCache(key, text);
      // A literal Record can be returned promptly without a second network
      // query merely to decorate the subjects of its incoming Roles.
      const labels = partial || compiled.describeLiteral || compiled.describeExpanded ? new Map<string, string>()
        : await resolveFctLabels(endpoint.url, bindings, labelAcceptLanguage, compiled.timeoutMs, request.signal);
      const labelFor = (term: SparqlBindingTerm | undefined) => term?.type === "uri" ? labels.get(term.value) : undefined;
      const describeRows = bindings.map((binding) => `<fct:row>${fctColumn(binding.s, labelFor(binding.s))}${fctColumn(binding.p, labelFor(binding.p))}${fctColumn(binding.o, labelFor(binding.o))}</fct:row>`).join("");
      const describeComplete = !partial;
      const metadata = fctExecutionMetadataXml({
        query: compiled.query, elapsedMs: Date.now() - startedAt, complete: describeComplete,
        timeoutMs: compiled.timeoutMs, processed: bindings.length,
        limit: compiled.limit, offset: compiled.offset,
        ...fctUpstreamMetadata(response, text),
      });
      const xml = `<fct:facets xmlns:fct="${FCT_NS}">${metadata}<fct:result type="${FCT_VIEW_TYPES.DESCRIBE}">${describeRows}</fct:result></fct:facets>`;
      if (!hasStatusConstraints && !isValidate && response.status === 200 && !partial && !countFreeFallback && !unorderedFallback) setQueryCache(responseCacheKey, { body: xml, contentType: "application/xml; charset=utf-8", status: 200 });
      return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store", "X-Maestro-Cache": "MISS", ...incompleteHeaders } });
    }

    if (compiled.view === FCT_VIEW_TYPES.ASK && !countOnly && !graphOnly) {
      // ASK returns a SPARQL Results boolean, never a SELECT bindings array.
      // A timeout/error must not be interpreted as a negative existence test.
      let askBoolean: boolean | undefined;
      try { const result = JSON.parse(text) as { boolean?: unknown }; if (typeof result.boolean === "boolean") askBoolean = result.boolean; } catch { /* invalid upstream result */ }
      if (partial || askBoolean === undefined) return fctUpstreamFailure("ask", response, text, activeQuery, executionEndpoint,
        partial ? undefined : 502, "Virtuoso did not complete the ASK preflight");
      const metadata = fctExecutionMetadataXml({
        query: compiled.query, elapsedMs, complete: true, timeoutMs: compiled.timeoutMs,
        processed: 1, limit: compiled.limit, offset: compiled.offset,
        ...fctUpstreamMetadata(response, text),
      });
      const xml = `<fct:facets xmlns:fct="${FCT_NS}">${metadata}<fct:result type="${FCT_VIEW_TYPES.ASK}"><fct:boolean>${askBoolean ? "true" : "false"}</fct:boolean></fct:result></fct:facets>`;
      if (!hasStatusConstraints && !isValidate && response.status === 200) setQueryCache(responseCacheKey, { body: xml, contentType: "application/xml; charset=utf-8", status: 200 });
      return new Response(xml, { status: 200, headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store", ...incompleteHeaders } });
    }
    const parsed = parseResults(text);
    if (!parsed) return fctUpstreamFailure("fct-json", response, text, activeQuery, executionEndpoint,
      partial ? undefined : 502, partial ? "No usable result set delivered by Virtuoso" : "Invalid SPARQL Results JSON returned by Virtuoso");
    let bindings = parsed?.results?.bindings ?? [];
    let vars = parsed?.head?.vars ?? [];
    if (!hasStatusConstraints && !isValidate && response.status === 200 && !partial) setQueryCache(key, text);
    const labels = partial || countOnly || compiled.view === FCT_VIEW_TYPES.VALIDATE || (compiled.view === FCT_VIEW_TYPES.LIST_VALUES || compiled.view === FCT_VIEW_TYPES.MERGE_VALUES) ||
      (compiled.graphOnly && compiled.view === FCT_VIEW_TYPES.GRAPHS && /<view\b[^>]*\brecord=["']yes["']/i.test(queryXml))
      ? new Map<string, string>()
      : await resolveFctLabels(endpoint.url, bindings,
          labelAcceptLanguage, Math.min(compiled.timeoutMs || 5000, 5000), request.signal);
    if ((compiled.view === FCT_VIEW_TYPES.LIST_VALUES || compiled.view === FCT_VIEW_TYPES.MERGE_VALUES) && !countOnly && !graphOnly) {
      const address = queryXml.match(/\baddr\s*=\s*["']([^"']+)["']/)?.[1] ?? "";
      const graph = unscopedGraph(address.includes("@") ? address.slice(0, address.indexOf("@")) : "");
      // Labels only for the selected focus resources; the second query returns
      // all projected values without another label round-trip.
      // VALUES selection has no intrinsic SPARQL order. Preserve the exact
      // authoritative resource page even if the backend reorders bindings.
      if (compiled.resourcePage?.length) {
        const matching = (a: SparqlBindingTerm, b: SparqlBindingTerm) =>
          a.value === b.value && a.type === b.type && a.datatype === b.datatype && a["xml:lang"] === b["xml:lang"];
        bindings = compiled.resourcePage.map(term => bindings.find(row => row.c1 && matching(row.c1, term)) ?? { c1: term });
      }
      const expansion = await expandListValues({
        endpoint: endpoint.url,
        page: bindings,
        columns: valueColumns,
        graph,
        timeoutMs: compiled.timeoutMs, request,
      });
      const xml = listValuesXml({
        page: bindings, view: compiled.view,
        columns: valueColumns,
        expansion: expansion.rows,
        labels,
        query: [compiled.query, expansion.query].filter(Boolean).join("\n\n"),
        limit: compiled.limit,
        offset: compiled.offset,
        elapsed: Date.now() - startedAt,
        complete: !partial && expansion.complete,
        timeoutMs: compiled.timeoutMs, upstream: partial ? fctUpstreamMetadata(response, text) : expansion.upstream,
      });
      if (response.status === 200 && !partial && expansion.complete)
        if (!hasStatusConstraints) setQueryCache(responseCacheKey, { body: xml, contentType: "application/xml; charset=utf-8", status: 200 });
      return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store", ...anytimeResponseHeaders(response, partial || !expansion.complete), ...incompleteHeaders } });
    }
    if ((compiled.view === FCT_VIEW_TYPES.LIST || compiled.view === FCT_VIEW_TYPES.LIST_SUBJECTS || compiled.view === FCT_VIEW_TYPES.LIST_OBJECTS) && !countOnly && !graphOnly) {
      bindings = bindings.map((binding) => {
        const uri = binding.c1?.type === "uri" ? binding.c1.value : "";
        if (!uri) return binding;
        // FCT list views expose the label as column 2. If no RDF label exists,
        // provide a compact URI-segment fallback instead of the full IRI.
        return { ...binding, c2: { type: "literal", value: labels.get(uri) ?? uriFallbackLabel(uri) } };
      });
      if (!vars.includes("c2")) vars = [...vars, "c2"];
    }
    // FCT <complete> reports execution completion, not whether another page
    // exists. Virtuoso uses HTTP 206 for partial results.
    const complete = !partial;
    let datatypeEvidence: Array<{ datatype: string; originalDatatype?: string; count: number }> = [];
    let datatypeEvidenceUnavailable = false;
    if (compiled.datatypeEvidenceQuery && !countOnly && !partial) {
      try {
        // A separate unpaginated aggregate over the exact same FCT population.
        // A failed probe is not a negative SHACL match; surface the error.
        const evidenceQuery = compiled.datatypeEvidenceQuery;
        // The datatype population is independent of the value page offset.
        // Reuse a complete evidence query across pages, but never reuse errors,
        // partial results, protected status scopes, or an explicit component Retry.
        const evidenceResult = await executeSparql(executionEndpoint, evidenceQuery, undefined,
          compiled.timeoutMs, request.signal, hasStatusConstraints || isValidate || componentRetry);
        const evidenceAnytime = isVirtuosoAnytime(evidenceResult.response, evidenceResult.text) || evidenceResult.response.status === 206;
        if (!evidenceResult.response.ok || evidenceAnytime) {
          // Preserve the distinction between the successful main value-list request
          // and this independent datatype aggregate; do not invent an upstream 502.
          const status = evidenceResult.response.status;
          const kind = evidenceAnytime ? "incomplete/ANYTIME" : `HTTP ${status}`;
          throw new Error(`Facet datatype evidence probe failed (${kind}).`);
        }
        const evidence = parseResults(evidenceResult.text);
        if (!evidence) throw new Error("Facet datatype evidence probe returned invalid SPARQL Results JSON.");
        if (!hasStatusConstraints && !isValidate && !componentRetry && evidenceResult.response.status === 200)
          setQueryCache(evidenceResult.key, evidenceResult.text);
        datatypeEvidence = (evidence.results?.bindings ?? []).flatMap(row => {
          const datatype = row.datatype?.value;
          const originalDatatype = row.originalDatatype?.value;
          const count = Number(row.ct?.value ?? "0");
          return typeof datatype === "string" && validProjectionIri(datatype) && Number.isFinite(count) && count > 0
            ? [{ datatype, originalDatatype: originalDatatype && validProjectionIri(originalDatatype) ? originalDatatype : undefined, count }] : [];
        });
      } catch (error) {
        request.signal.throwIfAborted();
        datatypeEvidenceUnavailable = true;
        proxyLog("warn", "fct.datatype-evidence-unavailable", { message: describeUpstreamError(error) });
      }
    }
    const xml = fctResponseXml({
      datatypeEvidence,
      query: activeQuery, view: compiled.view, limit: compiled.limit, offset: compiled.offset,
      executionAddr: updateFctExecutionAddress(address, {
        endpoint: executionEndpoint,
        ...(hasStatusConstraints ? { graph: getPersonalStatusGraph(request) } : {}),
      }),
      bindings, vars, elapsedMs: Date.now() - startedAt, complete, timeoutMs: compiled.timeoutMs, graphOnly, countOnly, labels,
      badgeColumns: compiled.badgeColumns,
      sqlState: sqlState || (anytime && response.status !== 206 ? "S1TAT" : ""),
      sqlMessage: anytime ? virtuosoAnytimeMessage(response, text) : sqlMessage,
      execMilliseconds,
      execDbActivity,
    });
    if (!hasStatusConstraints && !isValidate && response.status === 200 && !partial && !datatypeEvidenceUnavailable && !countFreeFallback && !unorderedFallback) setQueryCache(responseCacheKey, { body: xml, contentType: "application/xml; charset=utf-8", status: 200 });
    return new Response(xml, { status: 200, headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store", "X-Maestro-Cache": "MISS", ...(unorderedFallback ? { "X-Maestro-Ordering-Fallback": "true" } : {}),
      ...(countFreeFallback ? { "X-Maestro-Count-Fallback": "unavailable" } : {}), ...(datatypeEvidenceUnavailable ? { "X-Maestro-Enrichment-Unavailable": "datatype-evidence" } : {}), ...incompleteHeaders } });
  } catch (error) {
    if (request.signal.aborted) {
      proxyLog("debug", "fct.POST.cancelled", { stage });
      return fctError("Query cancelled", 499, undefined, "cancelled");
    }
    proxyLog("error", "fct.POST.failed", { stage, err: error, message: describeUpstreamError(error) });
    const message = describeUpstreamError(error, "Failed to compile or execute the FCT query as SPARQL.");
    const origin = request.signal.aborted ? "cancelled" : error instanceof UpstreamTransportError ? "upstream-transport" : "proxy";
    return fctError(message, stage === "compile" ? 400 : /aborted due to timeout|timed? out/i.test(message) ? 504 : 502, undefined, origin);
  }
}


export async function POST(request: Request): Promise<Response> {
  // FCT's HTTP response always contains its native XML body. Queue, dispatch
  // and timer events are pushed independently to OpenAPI subscribeQueryEvents under /proxy/api/service.
  const result = await withProxyQueryTelemetry(request,
    () => withProxyClient(request, () => handlePost(request)));
  // The retired preferences route previously issued this cookie. FCT now
  // provisions it itself, so independent browser clients never share quotas.
  if (!clientFromRequest(request)) {
    const id = newProxyClientId();
    result.headers.append("Set-Cookie", `${MAESTRO_CLIENT_COOKIE}=${id}; Path=/; SameSite=Lax; Max-Age=2592000${new URL(request.url).protocol === "https:" ? "; Secure" : ""}; HttpOnly`);
  }
  return result;
}
