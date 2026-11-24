"use client";
/** Generic, read-only second pass for provider-authored XSLT enrichment plans.
 * A stylesheet describes WHAT to query in mctx:requests; Maestro's transport
 * only validates the bounded SELECT shape and returns its RDF term bindings.
 * No ontology or domain-specific predicates are defined in this module. */
import { maestroQueryFetch } from "@/lib/client-query-cache";
import { validGraphServerUrl } from "@/lib/graph-server-directory";

const CONTEXT = "gttp://ggg.maestro.ecosys/ns/xslt/context#";
const FCT = "http://openlinksw.com/services/facets/1.0/";
type Term = { type?: string; value?: string; datatype?: string; "xml:lang"?: string };
type Binding = Record<string, Term | undefined>;

export function inspectRecordXsltSandboxPlan(plan: string, queryDocument: XMLDocument): { endpoint: string; queries: string[] } | null {
  if (plan.length > 160_000) throw new Error("Record XSLT sandbox plan exceeded its output limit.");
  const doc = new DOMParser().parseFromString(plan, "application/xml");
  if (doc.querySelector("parsererror") || doc.documentElement.namespaceURI !== CONTEXT || doc.documentElement.localName !== "requests")
    throw new Error("Record XSLT sandbox must produce mctx:requests XML.");
  const requests = Array.from(doc.documentElement.children);
  if (requests.length > 8 || requests.some(node => node.namespaceURI !== CONTEXT || node.localName !== "request"))
    throw new Error("Record XSLT sandbox supports at most eight SELECT requests.");
  const queryIds = new Set<string>();
  const queries: string[] = [];
  for (const request of requests) {
    const id = request.getAttribute("id") ?? "";
    const query = request.textContent?.trim() ?? "";
    if (!/^[a-z0-9-]{1,64}$/i.test(id) || queryIds.has(id) || query.length > 32_000)
      throw new Error("Record XSLT sandbox request ID or length is invalid.");
    queryIds.add(id);
    // The sandbox deliberately exposes ONLY read-only SELECT projections.
    // The proxy still independently verifies allowed endpoint and query form.
    if (!/\bSELECT\s+DISTINCT\s+\?subject\s+\?predicate\s+\?object\b/i.test(query) ||
        !/\bWHERE\s*\{/i.test(query) || !/\bLIMIT\s+(?:[1-9]\d{0,3})\s*$/i.test(query) ||
        Number(/\bLIMIT\s+(\d+)\s*$/i.exec(query)?.[1] ?? 0) > 2400 ||
        /\b(?:SERVICE|INSERT|DELETE|LOAD|CLEAR|DROP|CREATE|MOVE|COPY|ADD|WITH|USING|UPDATE|DEFINE|CONSTRUCT|DESCRIBE)\b/i.test(query))
      throw new Error("Record XSLT sandbox only accepts bounded, local SELECT ?subject ?predicate ?object queries.");
    queries.push(query);
  }
  const rawAddr = queryDocument.documentElement.getAttribute("addr") ?? "";
  const rawEndpoint = rawAddr.includes("@") ? rawAddr.slice(rawAddr.lastIndexOf("@") + 1) : rawAddr;
  const endpoint = validGraphServerUrl(rawEndpoint);
  if (queries.length && !endpoint) throw new Error("Record XSLT sandbox has no valid current graph-server endpoint.");
  return { endpoint: endpoint ?? "", queries };
}

export async function executeRecordXsltSandboxQueries(
  plan: string, liveQuery: XMLDocument, _describe: XMLDocument, signal?: AbortSignal,
): Promise<Element | null> {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  const inspected = inspectRecordXsltSandboxPlan(plan, liveQuery);
  if (!inspected?.queries.length) return null;
  const doc = document.implementation.createDocument(CONTEXT, "mctx:enrichment");
  const execute = async (query: string): Promise<Binding[]> => {
    const timeout = AbortSignal.timeout(20_000);
    const response = await maestroQueryFetch("/proxy/api/sparql", {
      method: "POST", cache: "no-store", credentials: "same-origin",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: {"x-maestro-debug-component":"record-xslt-sparql-sandbox:execute", "Content-Type": "application/json", "Accept": "application/json",
        "x-maestro-debug-source": "urn:maestro:component:record-xslt-sandbox" },
      body: JSON.stringify({ addr: `@${inspected.endpoint}`, query }),
    });
    if (!response.ok) throw new Error(`Record XSLT sandbox SELECT returned HTTP ${response.status}.`);
    const data = await response.json() as { results?: { bindings?: Binding[] }; incomplete?: boolean };
    if (data.incomplete || !Array.isArray(data.results?.bindings)) throw new Error("Record XSLT sandbox SELECT was incomplete or invalid.");
    if (data.results.bindings.length >= 2400) throw new Error("Record XSLT sandbox label batch reached its row cap; refusing partial labels.");
    return data.results.bindings;
  };
  const pages = await Promise.all(inspected.queries.map(execute));
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  const seen = new Set<string>();
  let count = 0;
  for (const rows of pages) for (const binding of rows) {
    const terms = [binding.subject, binding.predicate, binding.object];
    if (!terms.every(term => term && typeof term.value === "string" && term.value.length <= 8192) ||
        terms[0]?.type !== "uri" || terms[1]?.type !== "uri" ||
        !terms.every(term => ["uri", "literal", "typed-literal", "bnode"].includes(term?.type ?? ""))) continue;
    const key = JSON.stringify(terms);
    if (seen.has(key)) continue;
    seen.add(key);
    const row = doc.createElementNS(FCT, "fct:row");
    for (const term of terms as Term[]) {
      const column = doc.createElementNS(FCT, "fct:column");
      column.textContent = term.value ?? "";
      column.setAttribute("termType", term.type === "uri" ? "uri" : term.type === "bnode" ? "bnode" : "literal");
      if (term.datatype) column.setAttribute("datatype", term.datatype);
      if (term["xml:lang"]) column.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:lang", term["xml:lang"]);
      row.appendChild(column);
    }
    doc.documentElement.appendChild(row);
    if (++count > 14_000) throw new Error("Record XSLT enrichment exceeded its bounded row limit.");
  }
  return doc.documentElement;
}
