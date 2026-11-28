import type { PredicateQueryTraceEntry } from "./predicate-query-trace";
export type QueryTrace = PredicateQueryTraceEntry[];
export function traceFromFct(xml: string, fallback: QueryTrace): QueryTrace {
  const root = new DOMParser().parseFromString(xml,"application/xml").documentElement;
  const trace = Array.from(root.children).find(node=>node.localName === "query-trace");
  if (!trace) return fallback;
  return Array.from(trace.children).filter(node=>node.localName === "request").map(node=>({
    label:node.getAttribute("label") || "Query",query:node.textContent || "",
    language:node.getAttribute("language") === "xml" ? "xml" : "sparql",endpoint:node.getAttribute("endpoint") || undefined,
  }));
}
/** Diagnostic text remains plain text, never rendered as upstream HTML. */
export function analyticalFctError(status: number, xml: string, label: string): Error {
  const root = new DOMParser().parseFromString(xml,"application/xml").documentElement;
  const child = (node: Element, name: string) => Array.from(node.children).find(n=>n.localName===name);
  const upstream = child(root,"upstream");
  if (!upstream) return new Error(`${label}: HTTP ${status}${child(root,"error")?.textContent ? ` — ${child(root,"error")?.textContent}` : ""}\n${xml}`);
  const headers = Array.from(child(upstream,"headers")?.children ?? []).map(n=>`${n.getAttribute("name")}: ${n.textContent ?? ""}`).join("\n");
  const body = child(upstream,"body")?.textContent ?? "";
  return new Error([`${label}: HTTP ${status} — ${child(root,"error")?.textContent ?? ""}`,
    `Endpoint: ${upstream.getAttribute("endpoint")}`,`Phase: ${upstream.getAttribute("phase")}`,`Upstream HTTP ${upstream.getAttribute("status")} ${upstream.getAttribute("status-text")}`,
    headers,`Upstream response body:\n${body}`,`SPARQL:\n${child(root,"sparql")?.textContent ?? ""}`,
    `Original proxy diagnostic XML:\n${xml}`].join("\n\n"));
}
