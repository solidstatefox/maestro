import { currentProxyClient, withProxyClient } from "@/lib/maestro-proxy-client-preferences";
import { weightMaestroQuery } from "@/lib/graph-server-query-scheduler";
import { streamProxyQuery, MAESTRO_EVENT_HEADER } from "@/lib/proxy-query-stream";
import { traceVirtuosoDispatch } from "@/lib/proxy-query-events";
import { compileScopedStateFederation } from "@/lib/scoped-state-federation";
import { createHash } from "node:crypto";
import { canonicalQueryIdentityXml } from "@/lib/query-identity";
import { getUserGraph, personalSparqlUrl } from "@/lib/personal-sparql";
import { unscopedGraph, ALL_GRAPHS } from "@/lib/graph-address-mode";
import { FCT_VIEW_TYPES } from "@/lib/fct-view-types";
import { LIST_VALUES_MAX_RESOURCES } from "@/lib/list-values-transport";
import { logProxyCaller } from "@/lib/proxy-debug-server";
import { NextResponse } from "next/server";
import { XMLParser } from "fast-xml-parser";
import { compileFctXmlToSparql, type SparqlJsonResults, type SparqlBindingTerm } from "@/lib/fct-sparql-translator";
import { getQueryCache, queryCacheKey, setQueryCache } from "@/lib/query-cache";
import { getConfiguredFctEndpoints, normalizeGraphServerUri, resolveConfiguredFctEndpoint } from "@/lib/personal-sparql";
import { describeUpstreamError } from "@/lib/upstream-error";
import { proxyLog } from "@/lib/maestro-logger";
import { withGraphServerSlot } from "@/lib/server-query-scheduler";
import { virtuosoRankFailure, virtuosoAggregateFailure } from "@/lib/virtuoso-query-fallbacks";
import { isVirtuosoAnytime, virtuosoAnytimeMessage, anytimeResponseHeaders } from "@/lib/virtuoso-anytime";


function parseResults(text: string): SparqlJsonResults | null {
  try {
    const parsed = JSON.parse(text) as SparqlJsonResults;
    if (!parsed || !parsed.head || !Array.isArray(parsed.head.vars) || !parsed.results || !Array.isArray(parsed.results.bindings)) return null;
    return parsed;
  } catch {
    return null;
  }
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
 * Reproduce FCT's label-wrapper architecture: first fetch RDF terms in the
 * list query, then resolve labels through Virtuoso's virtrdf:label inference
 * graph instead of invoking the SQL-only fct_label() function in SPARQL.
 */
async function resolveFctLabels(
  endpoint: string,
  bindings: Record<string, SparqlBindingTerm>[],
  acceptLanguage: string | null,
  timeoutMs: number,
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
  const query = [
    'DEFINE input:inference "facets"',
    "SELECT ?s ?p ?label WHERE {",
    `  VALUES ?s { ${values} }`,
    "  ?s ?p ?label .",
    "  FILTER (?p IN (",
    `    <${VIRTRDF_LABEL}>,`,
    "    <http://www.w3.org/2000/01/rdf-schema#label>,",
    "    <http://www.w3.org/2004/02/skos/core#prefLabel>,",
    "    <http://xmlns.com/foaf/0.1/name>,",
    "    <http://purl.org/dc/terms/title>,",
    "    <http://purl.org/dc/elements/1.1/title>,",
    "    <https://schema.org/name>",
    "  ))",
    "  FILTER (isLiteral(?label))",
    "}",
    "ORDER BY STR(?s)",
  ].join("\n");
  try {
    const result = await executeSparql(endpoint, query, undefined, timeoutMs || 20000);
    if (!result.response.ok) return labels;
    const parsed = parseResults(result.text);
    if (!parsed) return labels;
    if (result.response.status === 200) setQueryCache(result.key, result.text);

    const candidates = new Map<string, { predicate: string; label: SparqlBindingTerm }[]>();
    const predicatePriority = new Map<string, number>([
      [VIRTRDF_LABEL, 0],
      ["http://www.w3.org/2000/01/rdf-schema#label", 1],
      ["http://www.w3.org/2004/02/skos/core#prefLabel", 2],
      ["http://xmlns.com/foaf/0.1/name", 3],
      ["http://purl.org/dc/terms/title", 4],
      ["http://purl.org/dc/elements/1.1/title", 5],
      ["https://schema.org/name", 6],
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
  const key = queryCacheKey("sparql", url, `${accept}\\u0000${query}`);
  const cached = bypassCache ? undefined : getQueryCache<string>(key);
  if (cached !== undefined) {
    return {
      response: new Response(cached, { status: 200, headers: { "Content-Type": accept.toLowerCase().includes("xml") || accept.toLowerCase().includes("rdf") ? "application/rdf+xml; charset=utf-8" : "application/sparql-results+json; charset=utf-8" } }),
      text: cached,
      key,
    };
  }
  const pendingKey = `${currentProxyClient()}:${key}`;
  const pending = requestSignal ? undefined : inFlightFctSparql.get(pendingKey);
  if (pending) return pending;

  const requestPromise = (async (): Promise<ExecutedSparql> => {
    const response = await withGraphServerSlot(
      endpoint, /\bCOUNT\s*\(|\bGROUP BY\b/i.test(query) ? "count" : "interactive", requestSignal,
      () => traceVirtuosoDispatch(() => fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Accept: accept,
      },
      body: new URLSearchParams({ query, ...(timeoutMs >= 1000 ? { timeout: String(timeoutMs) } : {}) }).toString(),
      cache: "no-store",
      signal: requestSignal
        ? AbortSignal.any([requestSignal, AbortSignal.timeout(Math.max(120000, timeoutMs * 3))])
        : AbortSignal.timeout(Math.max(120000, timeoutMs * 3)),
    })), weightMaestroQuery(query, /\bCOUNT\s*\(|\bGROUP BY\b/i.test(query) ? "count" : "interactive"));
    const text = await response.text();
    return { response, text, key };
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
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function fctError(message: string, status: number, details?: string): Response {
  const body = `<fct:facets xmlns:fct="${FCT_NS}"><fct:error>${xmlText(message)}${details ? `: ${xmlText(details)}` : ""}</fct:error></fct:facets>`;
  return new Response(body, { status, headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store" } });
}

function fctColumn(term: SparqlBindingTerm | undefined, label?: string, extraAttrs?: Record<string, string>): string {
  if (!term) return "<fct:column/>";
  const datatype = term.type === "uri" ? "uri" : term.type === "bnode" ? "bnode" : term.datatype;
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
    sqlState: anytime ? "S1TAT" : response.headers.get("X-SQL-State") ?? "",
    sqlMessage: anytime ? virtuosoAnytimeMessage(response, body) : response.headers.get("X-SQL-Message") ?? "",
    execMilliseconds: response.headers.get("X-Exec-Milliseconds") ?? "",
    execDbActivity: response.headers.get("X-Exec-DB-Activity") ?? "",
  };
}

function fctResponseXml(args: {
  query: string; view: string; limit: number; offset: number; bindings?: Record<string, SparqlBindingTerm>[];
  vars?: string[]; elapsedMs: number; complete: boolean; timeoutMs?: number; graphOnly?: boolean; countOnly?: boolean;
  labels?: Map<string, string>; error?: string;
  badgeColumns?: Array<{ colName: string; property: string; direction: "forward" | "reverse" }>;
  sqlState?: string; sqlMessage?: string; execMilliseconds?: string; execDbActivity?: string;
}): string {
  const { query, view, limit, offset, elapsedMs, complete, sqlState, sqlMessage, execMilliseconds, execDbActivity } = args;
  if (args.error) return `<fct:facets xmlns:fct="${FCT_NS}"><fct:sparql>${xmlText(query)}</fct:sparql><fct:time>${elapsedMs}</fct:time><fct:complete>no</fct:complete><fct:error>${xmlText(args.error)}</fct:error></fct:facets>`;
  const vars = args.vars ?? [];
  const bindings = args.bindings ?? [];
  const badgeMap = new Map((args.badgeColumns ?? []).map((b) => [b.colName, b]));
  let resultType = args.countOnly ? "count" : args.graphOnly ? FCT_VIEW_TYPES.GRAPHS : view;
  const labelFor = (term: SparqlBindingTerm | undefined) =>
    term?.type === "uri" ? args.labels?.get(term.value) : undefined;
  const rows = bindings.map((binding) => {
    if (args.countOnly) {
      const count = binding.n ?? Object.values(binding)[0];
      return `<fct:row>${fctColumn(count, labelFor(count))}</fct:row>`;
    }
    return `<fct:row>${vars.map((name) => {
      const badgeInfo = badgeMap.get(name);
      const extraAttrs = badgeInfo ? { property: badgeInfo.property, direction: badgeInfo.direction } : undefined;
      return fctColumn(binding[name], labelFor(binding[name]), { ...(extraAttrs ?? {}), var: name });
    }).join("")}</fct:row>`;
  }).join("");
  const metadata = fctExecutionMetadataXml({
    query, elapsedMs, complete, timeoutMs: args.timeoutMs ?? 0,
    processed: bindings.length, limit, offset,
    sqlState, sqlMessage, execMilliseconds, execDbActivity,
  });
  return `<fct:facets xmlns:fct="${FCT_NS}">${metadata}<fct:result type="${xmlText(resultType)}">${rows}</fct:result></fct:facets>`;
}

/** Safe absolute RDF IRIs may use schemes beyond HTTP (e.g. urn:, gttp:).
 * Validate IRIREF syntax before interpolating a term into SPARQL VALUES.
 * RDF results may also be literals, which retain their datatype and language.
 */
function validProjectionIri(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:[^\s<>"{}|^`\\\u0000-\u001f]+$/u.test(value);
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
async function expandListValues(args: {
  endpoint: string;
  page: Record<string, SparqlBindingTerm>[];
  columns: Array<{ property: string; direction: "forward" | "reverse"; path?: string[] }>;
  graph: string;
  timeoutMs: number;
}): Promise<{ rows: Record<string, SparqlBindingTerm[]>; query: string; complete: boolean; upstream?: ReturnType<typeof fctUpstreamMetadata> }> {
  const uniqueTerms = new Map<string, string>();
  for (const row of args.page) {
    if (!row.c1) continue;
    const encoded = serializeProjectionResource(row.c1);
    if (encoded) uniqueTerms.set(encoded, row.c1.value);
  }
  const values = [...new Set(uniqueTerms.values())];
  const validIri = (value: string) => /^https?:\/\/[^\s<>"{}|^`\\]+$/i.test(value);
  const columns = args.columns.slice(0, 24).filter((column) => validIri(column.property));
  if (!values.length || !columns.length) return { rows: {}, query: "", complete: true };
  if (args.graph && !validIri(args.graph))
    throw new Error("Invalid RDF IRI in list-values projection.");
  // Bind the paginated resources inside every UNION branch. This avoids an
  // unbound ?resource in branches that some Virtuoso versions otherwise
  // evaluate separately, and guarantees that every projected value remains
  // associated with a member of the selected Results page.
  const subjectValues = [...uniqueTerms.keys()].join(" ");
  const branches = columns.map((column, index) => {
    const path = column.path?.length ? column.path : [column.property];
    if (path.some((predicate) => !validIri(predicate))) throw new Error("Invalid list-values property path.");
    const predicatePath = path.map((predicate) => `<${predicate}>`).join("/");
    const triple = column.direction === "reverse"
      ? `?value ${predicatePath} ?resource .`
      : `?resource ${predicatePath} ?value .`;
    const source = args.graph ? `GRAPH <${args.graph}> { ${triple} }` : triple;
    // VALUES is deliberately used instead of BIND for the column index:
    // it is a normal bound solution term on every row of this UNION branch.
    return `{ VALUES ?resource { ${subjectValues} } VALUES ?column { ${index} } ${source} }`;
  });
  // Do not LIMIT the enrichment globally: a multivalued resource must never
  // starve another resource. The proxy retains three distinct values per cell.
  const query = `SELECT ?resource ?column ?value WHERE { ${branches.join(" UNION ")} }`;
  const result = await executeSparql(args.endpoint, query, undefined, args.timeoutMs);
  if (!result.response.ok && !isVirtuosoAnytime(result.response, result.text)) {
    throw new Error(`list-values enrichment returned HTTP ${result.response.status}`);
  }
  const parsed = parseResults(result.text);
  const rows: Record<string, SparqlBindingTerm[]> = {};
  for (const row of parsed?.results?.bindings ?? []) {
    const resource = row.resource?.value;
    const position = Number(row.column?.value);
    const value = row.value;
    if (!resource || !values.includes(resource) || !Number.isInteger(position) || position < 0 || position >= columns.length || !value) continue;
    const key = `${resource}\u0000${position}`;
    const existing = rows[key] ?? (rows[key] = []);
    if (existing.length >= 3) continue;
    if (existing.some((term) => term.value === value.value && term.type === value.type && term.datatype === value.datatype && term["xml:lang"] === value["xml:lang"])) continue;
    existing.push(value);
  }
  if (result.response.status === 200) setQueryCache(result.key, result.text);
  if (!Object.keys(rows).length && !isVirtuosoAnytime(result.response, result.text)) {
    proxyLog("warn", "fct.list-values-no-projected-bindings", {
      endpoint: args.endpoint, resources: values.length, columns: columns.length,
      query, response: result.text.slice(0, 1000),
    });
  }
  return { rows, query, complete: result.response.status === 200 && !isVirtuosoAnytime(result.response, result.text), upstream: fctUpstreamMetadata(result.response, result.text) };
}

function listValuesXml(args: {
  page: Record<string, SparqlBindingTerm>[];
  columns: Array<{ property: string; direction: "forward" | "reverse"; path?: string[] }>;
  expansion: Record<string, SparqlBindingTerm[]>;
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
      return `<fct:column property="${xmlText(column.property)}" direction="${column.direction}" path="${xmlText((column.path ?? [column.property]).join(" "))}" var="value_${i + 1}">${terms.map((term) => {
        const datatype = term.type === "uri" ? "uri" : term.type === "bnode" ? "bnode" : term.datatype;
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
  return `<fct:facets xmlns:fct="${FCT_NS}">${metadata}<fct:result type="${FCT_VIEW_TYPES.LIST_VALUES}">${rows}</fct:result></fct:facets>`;
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
  let endpoints: Awaited<ReturnType<typeof getConfiguredFctEndpoints>>;
  try { endpoints = await getConfiguredFctEndpoints(request); }
  catch (error) {
    return NextResponse.json({ error: `Could not load graphs from the personal SPARQL store: ${describeUpstreamError(error, "unknown error")}` }, { status: 503 });
  }
  const url = new URL(request.url);
  if (url.searchParams.get("health") !== "1") {
    return NextResponse.json({ endpoints: endpoints.map(({ id, label, url, group, schemeInferred }) => ({ id, label, url, group, schemeInferred })) });
  }

  const endpointId = url.searchParams.get("endpointId") ?? "";
  const endpoint = endpoints.find((item) => item.id === endpointId);
  if (!endpoint) return NextResponse.json({ error: "Unknown SPARQL endpoint health check." }, { status: 400 });

  const probe = async (testedUrl: string) => {
    const response = await fetch(testedUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", Accept: "application/sparql-results+json, application/json;q=0.9" },
      body: new URLSearchParams({ query: "ASK WHERE { }" }).toString(),
      cache: "no-store",
      signal: AbortSignal.timeout(7000),
    });
    const responseText = await response.text();
    let validResults = false;
    try {
      const parsed = JSON.parse(responseText);
      validResults = response.ok && (typeof parsed?.boolean === "boolean" || parseResults(responseText) !== null);
    } catch { /* A non-SPARQL body is not a healthy SPARQL endpoint. */ }
    const status = validResults ? response.status : response.ok ? 502 : response.status;
    return { id: endpoint.id, status, state: validResults ? "ok" : status >= 500 ? "server-error" : "http-error", testedUrl };
  };
  try {
    const httpsResult = await probe(endpoint.url);
    // Only a real HTTP 404 permits falling back from an inferred HTTPS URL.
    if (endpoint.schemeInferred && endpoint.url.startsWith("https://") && httpsResult.status === 404) {
      const httpUrl = endpoint.url.replace(/^https:\/\//, "http://");
      try { return NextResponse.json({ check: await probe(httpUrl) }); }
      catch (error) {
        return NextResponse.json({ check: { id: endpoint.id, status: null,
          state: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "unreachable", testedUrl: httpUrl } });
      }
    }
    return NextResponse.json({ check: httpsResult });
  } catch (error) {
    return NextResponse.json({ check: { id: endpoint.id, status: null,
      state: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "unreachable", testedUrl: endpoint.url } });
  }
}

async function handlePost(request: Request) {
  logProxyCaller(request, "fct.POST");
  let stage: "compile" | "execute" = "compile";
  try {
    const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
    const requestBodyText = await request.text();
    const body: Record<string, unknown> | null = contentType.includes("xml")
      ? { queryXml: requestBodyText }
      : (() => { try { return JSON.parse(requestBodyText) as Record<string, unknown>; } catch { return null; } })();
    let endpoints: Awaited<ReturnType<typeof getConfiguredFctEndpoints>>;
    try { endpoints = await getConfiguredFctEndpoints(request); }
    catch (error) {
      return fctError(`Could not load graphs from the personal SPARQL store: ${error instanceof Error ? error.message : "unknown error"}`, 503);
    }

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
    const configuredEndpoint = resolveConfiguredFctEndpoint(endpoints, serverAddress);
    const endpoint = configuredEndpoint ? { ...configuredEndpoint, url: serverAddress } : undefined;
    if (!endpoint) return fctError(`The graph server in query addr is not configured: ${serverAddress}`, 400);

    // Discovery is the only intentionally unscoped data query: its purpose
    // is to discover a matching named graph before normal query processing.
    if (body?.discoverGraph === true) {
      const addressGraph = address?.slice(0, delimiter).trim() ?? "";
      if (addressGraph && addressGraph !== ALL_GRAPHS) return NextResponse.json({ graph: addressGraph, found: true });
      const probe = compileFctXmlToSparql(queryXml, undefined, false, false, true);
      stage = "execute";
      const result = await executeSparql(endpoint.url, probe.query, undefined, Math.min(probe.timeoutMs || 20000, 20000), request.signal);
      if (!result.response.ok || isVirtuosoAnytime(result.response, result.text) || result.response.status === 206) {
        return NextResponse.json({ error: "Graph discovery did not complete; normal queries remain blocked.", query: probe.query }, { status: 503 });
      }
      const parsed = parseResults(result.text);
      if (!parsed) return NextResponse.json({ error: "Could not parse graph-discovery response.", query: probe.query }, { status: 502 });
      const binding = parsed.results?.bindings?.[0]?.c1;
      if (!binding) return NextResponse.json({ graph: null, found: false, query: probe.query });
      if (binding.type !== "uri" || !binding.value) return NextResponse.json({ error: "Graph discovery returned a non-IRI graph." }, { status: 502 });
      return NextResponse.json({ graph: binding.value, found: true, query: probe.query });
    }
    const view = typeof body?.view === "string" ? body.view : undefined;
    const graphOnly = body?.graphOnly === true;
    const countOnly = body?.countOnly === true;
    let compiled = compileFctXmlToSparql(queryXml, view, graphOnly, countOnly);
    const hasStateConstraints = compiled.stateBindings.length > 0;
    const executionEndpoint = hasStateConstraints ? personalSparqlUrl(request).toString() : endpoint.url;
    const stateCompile = (source: typeof compiled) => {
      if (!source.stateBindings.length) return source.query;
      const hash = `sha256:${createHash("sha256").update(canonicalQueryIdentityXml(queryXml), "utf8").digest("hex")}`;
      const personalGraph = getUserGraph(request);
      return compileScopedStateFederation(source.query, source.stateBindings,
        endpoint.url, executionEndpoint, `${personalGraph}/state/${hash}`, `${personalGraph}/query-hash/hide`);
    };
    if (hasStateConstraints) compiled = { ...compiled, query: stateCompile(compiled) };
    const isDescribe = compiled.view === FCT_VIEW_TYPES.DESCRIBE;
    const responseCacheKey = queryCacheKey(
      // A Graphs response from an older query compiler must never survive
      // into the current grouped, rank-ordered Graphs pagination format.
      compiled.graphOnly ? "fct-response-graphs-v2" : "fct-response",
      endpoint.url,
      JSON.stringify([queryXml, view ?? null, graphOnly, countOnly, request.headers.get("accept-language") ?? ""]),
    );
    // A client that already has its paginated Results page may supply exactly
    // those resources. This is the second stage of list-values, not a second
    // pagination query. The request remains an FCT XML clone with explicit
    // projected siblings, and the proxy still owns all SPARQL construction.
    const suppliedResources = Array.isArray(body?.resources) && compiled.view === FCT_VIEW_TYPES.LIST_VALUES
      ? body.resources.map((raw: unknown): SparqlBindingTerm | null => {
          const term = typeof raw === "string" ? { type: "uri", value: raw } : raw;
          if (!term || typeof term !== "object") return null;
          const value = term as { type?: unknown; value?: unknown; datatype?: unknown; lang?: unknown };
          if (typeof value.value !== "string" || (value.type !== "uri" && value.type !== "literal")) return null;
          if ((value.datatype !== undefined && typeof value.datatype !== "string") ||
              (value.lang !== undefined && typeof value.lang !== "string")) return null;
          const candidate: SparqlBindingTerm = { type: value.type, value: value.value,
            ...(typeof value.datatype === "string" ? { datatype: value.datatype } : {}),
            ...(typeof value.lang === "string" ? { "xml:lang": value.lang } : {}),
          };
          return serializeProjectionResource(candidate) ? candidate : null;
        })
      : null;
    if (suppliedResources && suppliedResources.length > LIST_VALUES_MAX_RESOURCES)
      return fctError(`list-values received ${suppliedResources.length} resources; maximum ${LIST_VALUES_MAX_RESOURCES} per request.`, 400);
    if (suppliedResources && suppliedResources.some((term) => term === null))
      return fctError(`list-values received ${suppliedResources.filter((term) => term === null).length} invalid RDF terms; verify URI schemes, literal datatypes, and term types.`, 400);
    if (suppliedResources) {
      const startedAt = Date.now();
      const seen = new Set<string>();
      const page = suppliedResources.filter((term): term is SparqlBindingTerm => {
        if (!term) return false;
        const key = serializeProjectionResource(term)!;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).map((term) => ({ c1: term }));
      const address = queryXml.match(/\baddr\s*=\s*["']([^"']+)["']/)?.[1] ?? "";
      const graph = unscopedGraph(address.includes("@") ? address.slice(0, address.indexOf("@")) : "");
      const expansion = await expandListValues({
        endpoint: endpoint.url, page, columns: compiled.valueColumns ?? [], graph,
        timeoutMs: compiled.timeoutMs,
      });
      const xml = listValuesXml({
        page, columns: compiled.valueColumns ?? [], expansion: expansion.rows,
        labels: new Map(), query: expansion.query, limit: page.length,
        offset: 0, elapsed: Date.now() - startedAt, complete: expansion.complete,
        timeoutMs: compiled.timeoutMs, upstream: expansion.upstream,
      });
      return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store" } });
    }
    // Personal-state selections can change without changing the live FCT XML.
    // Never serve an old state-constrained response from the proxy cache.
    const cachedResponse = hasStateConstraints ? null : getQueryCache<{ body: string; contentType: string; status: number }>(responseCacheKey);
    if (cachedResponse) {
      return new Response(cachedResponse.body, {
        status: cachedResponse.status,
        headers: { "Content-Type": cachedResponse.contentType, "Cache-Control": "no-store", "X-Maestro-Cache": "HIT" },
      });
    }
    stage = "execute";
    const startedAt = Date.now();
    let activeQuery = compiled.query;
    let queryResult = await executeSparql(executionEndpoint, activeQuery, isDescribe && !compiled.describeLiteral ? "application/rdf+xml, application/xml;q=0.9" : undefined, compiled.timeoutMs, request.signal, hasStateConstraints);
    let countFreeFallback = false;
    let unorderedFallback = false;
    // A failed IRI_RANK sort should not make the primary Results pane unusable.
    // This retry removes only Maestro's optional ordering, never scope constraints.
    if (!countOnly && !graphOnly && (compiled.view === FCT_VIEW_TYPES.TEXT || compiled.view === FCT_VIEW_TYPES.LIST || compiled.view === FCT_VIEW_TYPES.LIST_VALUES) &&
        !queryResult.response.ok && !isVirtuosoAnytime(queryResult.response, queryResult.text) &&
        virtuosoRankFailure(queryResult.text + " " + (queryResult.response.headers.get("X-SQL-Message") ?? "")) &&
        /<LONG::IRI_RANK>/i.test(activeQuery)) {
      const unorderedXml = queryXml.replace(/<query\b[^>]*>/i, (tag) =>
        /\border\s*=/.test(tag) ? tag.replace(/\border\s*=\s*(["']).*?\1/i, 'order="no"')
          : tag.replace(/>$/, ' order="no">'));
      const unordered = compileFctXmlToSparql(unorderedXml, view, graphOnly, countOnly);
      if (stateCompile(unordered) !== activeQuery) {
        activeQuery = stateCompile(unordered);
        queryResult = await executeSparql(executionEndpoint, activeQuery, undefined, compiled.timeoutMs, request.signal, hasStateConstraints);
        unorderedFallback = true;
      }
    }
    if (!countOnly && !graphOnly && (compiled.view === FCT_VIEW_TYPES.PROPERTIES || compiled.view === FCT_VIEW_TYPES.PROPERTIES_IN || compiled.view === FCT_VIEW_TYPES.CLASSES) &&
        !queryResult.response.ok && !isVirtuosoAnytime(queryResult.response, queryResult.text) &&
        virtuosoAggregateFailure(queryResult.text + " " + (queryResult.response.headers.get("X-SQL-Message") ?? ""))) {
      const fallbackQuery = stateCompile(compileFctXmlToSparql(queryXml, view, graphOnly, false, false, true));
      activeQuery = fallbackQuery;
      queryResult = await executeSparql(executionEndpoint, fallbackQuery, undefined, compiled.timeoutMs, request.signal, hasStateConstraints);
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
      return fctError(`Virtuoso SPARQL endpoint returned HTTP ${response.status}${sqlState ? ` (${sqlState})` : ""}`, response.status, sqlMessage || text.slice(0, 16000));
    }

    if (anytime) proxyLog("warn", "fct.anytime", { endpoint: endpoint.url, view: compiled.view, status: response.status, sqlState, message: virtuosoAnytimeMessage(response, text) });

    const incompleteHeaders = anytimeResponseHeaders(response, partial);
    if (isDescribe) {
      if (!hasStateConstraints && response.status === 200 && !partial) setQueryCache(key, text);
      let bindings: Record<string, SparqlBindingTerm>[];
      try {
        if (compiled.describeLiteral) {
          const parsed = parseResults(text);
          if (!parsed) throw new Error("Invalid literal Record SELECT response.");
          bindings = (parsed.results?.bindings ?? []).filter((row) => row.s?.value && row.p?.value && row.o?.value)
            .map((row) => ({ s: row.s, p: row.p, o: row.o }));
        } else {
          bindings = parseDescribeRdfXml(text);
        }
      }
      catch (error) {
        if (!anytime) return fctError(error instanceof Error ? error.message : "Invalid DESCRIBE response", 502, text.slice(0, 1000));
        proxyLog("warn", "fct.describe-anytime-no-rows", { view: compiled.view, status: response.status });
        bindings = [];
      }
      // A literal Record can be returned promptly without a second network
      // query merely to decorate the subjects of its incoming Roles.
      const labels = compiled.describeLiteral ? new Map<string, string>()
        : await resolveFctLabels(endpoint.url, bindings, request.headers.get("accept-language"), compiled.timeoutMs);
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
      if (!hasStateConstraints && response.status === 200 && !partial && !countFreeFallback && !unorderedFallback) setQueryCache(responseCacheKey, { body: xml, contentType: "application/xml; charset=utf-8", status: 200 });
      return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store", "X-Maestro-Cache": "MISS", ...incompleteHeaders } });
    }

    if (compiled.view === FCT_VIEW_TYPES.ASK && !countOnly && !graphOnly) {
      // ASK returns a SPARQL Results boolean, never a SELECT bindings array.
      // A timeout/error must not be interpreted as a negative existence test.
      let askBoolean: boolean | undefined;
      try { const result = JSON.parse(text) as { boolean?: unknown }; if (typeof result.boolean === "boolean") askBoolean = result.boolean; } catch { /* invalid upstream result */ }
      if (partial || askBoolean === undefined) return fctError("Virtuoso did not complete the ASK preflight.", 502, text.slice(0, 1200));
      const metadata = fctExecutionMetadataXml({
        query: compiled.query, elapsedMs, complete: true, timeoutMs: compiled.timeoutMs,
        processed: 1, limit: compiled.limit, offset: compiled.offset,
        ...fctUpstreamMetadata(response, text),
      });
      const xml = `<fct:facets xmlns:fct="${FCT_NS}">${metadata}<fct:result type="${FCT_VIEW_TYPES.ASK}"><fct:boolean>${askBoolean ? "true" : "false"}</fct:boolean></fct:result></fct:facets>`;
      if (!hasStateConstraints && response.status === 200) setQueryCache(responseCacheKey, { body: xml, contentType: "application/xml; charset=utf-8", status: 200 });
      return new Response(xml, { status: 200, headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store" } });
    }
    const parsed = parseResults(text);
    if (!parsed && !anytime) return fctError("Virtuoso SPARQL endpoint returned an invalid SPARQL Results JSON document", 502, text.slice(0, 1500));
    // An ANYTIME timeout can arrive with an error-only body and no result rows.
    // No rows were received: do not fabricate rows or report a complete empty set.
    if (!parsed && anytime) proxyLog("warn", "fct.anytime-no-rows", { view: compiled.view, status: response.status });
    let bindings = parsed?.results?.bindings ?? [];
    let vars = parsed?.head?.vars ?? [];
    if (!hasStateConstraints && response.status === 200 && !partial) setQueryCache(key, text);
    const labels = countOnly || compiled.view === FCT_VIEW_TYPES.LIST_VALUES
      ? new Map<string, string>()
      : await resolveFctLabels(endpoint.url, bindings, request.headers.get("accept-language"), compiled.timeoutMs);
    if (compiled.view === FCT_VIEW_TYPES.LIST_VALUES && !countOnly && !graphOnly) {
      const address = queryXml.match(/\baddr\s*=\s*["']([^"']+)["']/)?.[1] ?? "";
      const graph = unscopedGraph(address.includes("@") ? address.slice(0, address.indexOf("@")) : "");
      // Labels only for the selected focus resources; the second query returns
      // all projected values without another label round-trip.
      const expansion = await expandListValues({
        endpoint: endpoint.url,
        page: bindings,
        columns: compiled.valueColumns ?? [],
        graph,
        timeoutMs: compiled.timeoutMs,
      });
      const xml = listValuesXml({
        page: bindings,
        columns: compiled.valueColumns ?? [],
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
        if (!hasStateConstraints) setQueryCache(responseCacheKey, { body: xml, contentType: "application/xml; charset=utf-8", status: 200 });
      return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store" } });
    }
    if (compiled.view === FCT_VIEW_TYPES.LIST && !countOnly && !graphOnly) {
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
    const xml = fctResponseXml({
      query: activeQuery, view: compiled.view, limit: compiled.limit, offset: compiled.offset,
      bindings, vars, elapsedMs: Date.now() - startedAt, complete, timeoutMs: compiled.timeoutMs, graphOnly, countOnly, labels,
      badgeColumns: compiled.badgeColumns,
      sqlState: anytime ? "S1TAT" : sqlState,
      sqlMessage: anytime ? virtuosoAnytimeMessage(response, text) : sqlMessage,
      execMilliseconds,
      execDbActivity,
    });
    if (!hasStateConstraints && response.status === 200 && !partial && !countFreeFallback && !unorderedFallback) setQueryCache(responseCacheKey, { body: xml, contentType: "application/xml; charset=utf-8", status: 200 });
    return new Response(xml, { status: 200, headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store", "X-Maestro-Cache": "MISS", ...(unorderedFallback ? { "X-Maestro-Ordering-Fallback": "true" } : {}),
      ...(countFreeFallback ? { "X-Maestro-Count-Fallback": "unavailable" } : {}), ...incompleteHeaders } });
  } catch (error) {
    proxyLog("error", "fct.POST.failed", { stage, err: error, message: describeUpstreamError(error) });
    const message = describeUpstreamError(error, "Failed to compile or execute the FCT query as SPARQL.");
    return fctError(message, stage === "compile" ? 400 : /aborted due to timeout|timed? out/i.test(message) ? 504 : 502);
  }
}


export async function POST(request: Request): Promise<Response> {
  if (request.headers.get(MAESTRO_EVENT_HEADER) === "1") {
    return streamProxyQuery(request, () => withProxyClient(request, () => handlePost(request)));
  }
  return withProxyClient(request, () => handlePost(request));
}
