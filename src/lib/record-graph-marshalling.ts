/**
 * Record graph marshalling stays in the FCT query language. There is no
 * bespoke graph-list HTTP response: <view type="graphs" record="yes"/> is
 * compiled by the normal FCT translator and dispatched by /proxy/api/fct.
 *
 * A URI Record gets an unscoped root URI focus: merely having a selected
 * graph in the Browse UI does not prove where all its triples live.
 * A blank-node Record reuses its *actual FCT-derived identity query*, so a
 * temporary _: label is never passed across requests. If that executed FCT
 * selection contains GRAPH <iri>, the translator binds that graph directly.
 * Otherwise it marshals physical graphs from incoming AND outgoing triples.
 */
import type { RecordGraphDiscoveryLimits } from "@/lib/record-graph-limits";
import { ALL_GRAPHS } from "@/lib/graph-address-mode";
import { blankNodeGraphFctQuery } from "@/lib/bnode/record-graphs";

const FCT_NS = "http://openlinksw.com/services/facets/1.0";
const safeIri = (s: string): boolean => /^[A-Za-z][A-Za-z0-9+.-]*:[^\s<>"{}|^`\\\u0000-\u001f]+$/u.test(s);

export function recordGraphFctQuery(args: {
  addr: string; uri?: string; blankQueryXml?: string;
  limits: RecordGraphDiscoveryLimits;
}): string {
  const { addr, uri, blankQueryXml, limits } = args;
  if (!Number.isSafeInteger(limits.candidates) || limits.candidates < 1 || limits.candidates > 10000 ||
      !Number.isSafeInteger(limits.graphs) || limits.graphs < 1 || limits.graphs > 500) {
    throw new Error("Invalid Record graph limits.");
  }
  if (blankQueryXml) return blankNodeGraphFctQuery(blankQueryXml, limits);
  if (!uri || !safeIri(uri)) throw new Error("Record graph discovery needs an RDF URI or FCT-derived blank-node query.");
  const at = addr.indexOf("@");
  if (at < 0 || !addr.slice(at + 1).trim()) throw new Error("The live FCT query has no graph-server address.");
  // An ordinary URI Record SELECT is unscoped unless the Record query itself
  // carries a GRAPH constraint. Do not confuse the Browse graph with that.
  const unscopedAddr = `${ALL_GRAPHS}@${addr.slice(at + 1).trim()}`;
  const doc = document.implementation.createDocument(FCT_NS, "query", null);
  const root = doc.documentElement;
  root.setAttribute("addr", unscopedAddr);
  const value = doc.createElementNS(FCT_NS, "value");
  value.setAttribute("datatype", "uri");
  value.textContent = uri;
  root.appendChild(value);
  const view = doc.createElementNS(FCT_NS, "view");
  for (const [name, value] of Object.entries({type:"graphs",record:"yes",candidates:"1",limit:String(limits.graphs),offset:"0"}))
    view.setAttribute(name, value);
  root.appendChild(view);
  return new XMLSerializer().serializeToString(doc);
}

export function readRecordGraphFctResponse(xml: string): {
  graphs: string[]; complete: boolean; upstreamComplete: boolean; saturated: boolean;
} {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("Invalid FCT graph response.");
  const all = Array.from(doc.getElementsByTagName("*"));
  const error = all.find(el => el.localName === "error");
  if (error) throw new Error(error.textContent?.trim() || "Record graph query failed.");
  const result = all.find(el => el.localName === "result" && el.getAttribute("type") === "graphs");
  if (!result) throw new Error("FCT did not return a Graphs view.");
  const graphs = new Set<string>();
  const rows = Array.from(result.children).filter(el => el.localName === "row");
  for (const row of rows) {
    const cell = Array.from(row.children).find(el => el.localName === "column");
    const iri = cell?.textContent?.trim() ?? "";
    if (cell?.getAttribute("datatype") === "uri" && safeIri(iri)) graphs.add(iri);
  }
  const view = all.find(el => el.localName === "view");
  const max = Number(view?.getAttribute("limit") ?? 0);
  if (!Number.isSafeInteger(max) || max < 1) throw new Error("Record graph response omitted its page limit; completeness cannot be established.");
  const upstreamComplete = all.find(el => el.localName === "complete")?.textContent?.trim() === "yes";
  // LIMIT can hide additional graphs even when the server reports a complete
  // SPARQL execution. Do not present a saturated page as exhaustive.
  const saturated = rows.length >= max;
  return { graphs: [...graphs], complete: upstreamComplete && !saturated,
    upstreamComplete, saturated };
}

/** Page the existing Record Graphs projection; this is not a population probe.
 * Only return a graph list if all graph pages completed. If the configured
 * server/Sheet ceiling is exhausted, fail closed rather than showing an
 * incomplete list as authoritative. */
export async function loadCompleteRecordGraphList(
  firstProjection: string,
  fetchPage: (projection: string) => Promise<string>,
  signal: AbortSignal,
  maxPages = 20,
): Promise<string[]> {
  const doc = new DOMParser().parseFromString(firstProjection, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("Invalid Record graph FCT projection.");
  const view = Array.from(doc.getElementsByTagName("*")).find(node => node.localName === "view");
  if (!view || view.getAttribute("type") !== "graphs" || view.getAttribute("record") !== "yes")
    throw new Error("Expected a Record Graphs FCT projection.");
  const limit = Number(view.getAttribute("limit"));
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error("Invalid Record graph page limit.");
  const graphs = new Set<string>();
  for (let page = 0; page < maxPages; page++) {
    if (signal.aborted) throw signal.reason;
    view.setAttribute("offset", String(page * limit));
    const response = readRecordGraphFctResponse(await fetchPage(new XMLSerializer().serializeToString(doc)));
    if (!response.upstreamComplete) throw new Error("Record graph discovery timed out or returned partial results; graph filters remain unavailable.");
    for (const graph of response.graphs) graphs.add(graph);
    if (!response.saturated) return [...graphs];
  }
  throw new Error("Record graph discovery reached the bounded graph-page ceiling; graph filters remain unavailable.");
}
