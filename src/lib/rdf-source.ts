"use client";

import { fctRead } from "./fct-client";
import { snapshotFctQueryXml } from "./fct-query-api";
import { createBlankNodeLabelAllocator, BNODE_DESCRIBE_MAX_TRIPLES } from "@/lib/bnode";

const iri = (value: string) => /^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(value);
const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Read RDF through the normal FCT DESCRIBE view, scoped to the live graph address. */
export async function describeFctSource(liveXml: string, resource: string, signal?: AbortSignal): Promise<{code: string; query: string}> {
  if (!iri(resource)) throw new Error("Invalid RDF resource IRI.");
  const doc = new DOMParser().parseFromString(snapshotFctQueryXml(liveXml, "data"), "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Malformed live FCT XML.");
  const root = doc.documentElement;
  if (root.localName !== "query" || !root.getAttribute("addr")) throw new Error("FCT graph address is missing.");
  // This is a source-inspection query, not a Features approval listing.
  // Do not trigger a redundant bookmark/curation lookup from its navigation src.
  root.removeAttribute("src");
  while (root.firstChild) root.removeChild(root.firstChild);
  const value = doc.createElementNS(root.namespaceURI, "value");
  value.setAttribute("datatype", "uri"); value.textContent = resource; root.appendChild(value);
  const view = doc.createElementNS(root.namespaceURI, "view");
  view.setAttribute("type", "describe");
  view.setAttribute("expand", "bnodes");
  view.setAttribute("depth", "5");
  view.setAttribute("incoming", "yes");
  view.setAttribute("limit", String(BNODE_DESCRIBE_MAX_TRIPLES));
  root.appendChild(view);
  const result = await fctRead(new XMLSerializer().serializeToString(doc), signal);
  if (result.incomplete) throw new Error("Expanded RDF source was incomplete; source text cannot be trusted.");
  const blankNodeId = createBlankNodeLabelAllocator("bn");
  const literal = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t").replace(/[\u0000-\u001f]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`)}"`;
  const term = (col: { value: string; termType?: string; lang?: string; datatype?: string }) => {
    if (col.termType === "uri") return `<${col.value}>`;
    if (col.termType === "bnode") return `_:${blankNodeId(col.value)}`;
    return `${literal(col.value)}${col.lang ? `@${col.lang}` : col.datatype && col.datatype !== "string" ? `^^<${col.datatype}>` : ""}`;
  };
  const code = result.describe.map(row => `${term(row.subject)} ${term(row.predicate)} ${term(row.object)} .`).join("\n");
  return { code: code || `# No RDF triples for <${esc(resource)}>`, query: result.sparql };
}
