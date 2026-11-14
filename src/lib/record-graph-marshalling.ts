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
import { snapshotFctQueryXml } from "@/lib/fct-query-clone";

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
  if (blankQueryXml) {
    const doc = new DOMParser().parseFromString(snapshotFctQueryXml(blankQueryXml, "data"), "application/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error("Invalid blank-node FCT selection.");
    const views = Array.from(doc.getElementsByTagName("*")).filter(node => node.localName === "view");
    if (views.length !== 1) throw new Error("Expected one FCT view.");
    const view = views[0];
    doc.documentElement.removeAttribute("src"); // Projection is not a Features navigation.
    const rootFocus = view.parentElement === doc.documentElement;
    // For a root blank-node Record, the Results page itself is the identity.
    // Preserve that page's offset and do not expand its candidate set to the
    // full Sheet ceiling. Nested URI-anchored paths start at offset zero.
    const pageSize = Number(view.getAttribute("limit") ?? limits.candidates);
    const pageOffset = Number(view.getAttribute("offset") ?? 0);
    if (rootFocus && (!Number.isSafeInteger(pageSize) || pageSize < 1 ||
                      !Number.isSafeInteger(pageOffset) || pageOffset < 0))
      throw new Error("Invalid root blank-node Results page.");
    view.setAttribute("bnode", "yes");
    view.setAttribute("type", "graphs");
    view.setAttribute("record", "yes");
    view.setAttribute("candidates", String(rootFocus ? Math.min(limits.candidates, pageSize) : limits.candidates));
    view.setAttribute("candidateOffset", String(rootFocus ? pageOffset : 0));
    view.setAttribute("limit", String(limits.graphs));
    view.setAttribute("offset", "0");
    return new XMLSerializer().serializeToString(doc);
  }
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

export function readRecordGraphFctResponse(xml: string): { graphs: string[]; complete: boolean } {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("Invalid FCT graph response.");
  const all = Array.from(doc.getElementsByTagName("*"));
  const error = all.find(el => el.localName === "error");
  if (error) throw new Error(error.textContent?.trim() || "Record graph query failed.");
  const result = all.find(el => el.localName === "result" && el.getAttribute("type") === "graphs");
  if (!result) throw new Error("FCT did not return a Graphs view.");
  const graphs = new Set<string>();
  for (const row of Array.from(result.children).filter(el => el.localName === "row")) {
    const cell = Array.from(row.children).find(el => el.localName === "column");
    const iri = cell?.textContent?.trim() ?? "";
    if (cell?.getAttribute("datatype") === "uri" && safeIri(iri)) graphs.add(iri);
  }
  const max = Number(all.find(el => el.localName === "view")?.getAttribute("limit") ?? 0);
  const upstreamComplete = all.find(el => el.localName === "complete")?.textContent?.trim() === "yes";
  // LIMIT can hide additional graphs even when the server reports a complete
  // SPARQL execution. Do not present a saturated page as exhaustive.
  return { graphs: [...graphs], complete: upstreamComplete && (max <= 0 || graphs.size < max) };
}
