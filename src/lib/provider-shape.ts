"use client";

import { loadPersonalAuthSession } from "@/lib/personal-auth";
import { featuresGraph } from "@/lib/graph-context";
import { fctRead } from "@/lib/fct-client";
import { sparqlBindingsToXml } from "@/lib/sparql-results-xml";

const validIri = (uri: string) => /^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(uri);
const escapeXml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

/**
 * Retrieve a SHACL shape's connected RDF through the shared FCT expanded
 * DESCRIBE view; preserve blank nodes and expose standard SPARQL Results XML
 * to the provider's XSLT (not a specialized provider-shape web response).
 */
export async function readProviderShapeXml(shape: string, signal?: AbortSignal): Promise<string> {
  if (!validIri(shape)) throw new Error("Invalid SHACL shape IRI.");
  const session = await loadPersonalAuthSession();
  if (!session) throw new Error("Log in to read a personal SHACL shape.");
  const { graph, personalEndpointUrl } = featuresGraph(session, "policies");
  const query = `<query xmlns="http://openlinksw.com/services/facets/1.0" addr="${escapeXml(`${graph}@${personalEndpointUrl}`)}"><value datatype="uri">${escapeXml(shape)}</value><view type="describe" expand="bnodes" depth="5" incoming="yes" limit="5000" offset="0"/></query>`;
  const result = await fctRead(query, signal);
  if (result.incomplete) throw new Error("Incomplete SHACL shape graph; cannot run its provider XSLT.");
  const asBinding = (column: {value:string;termType?: string;datatype?: string;lang?: string}) => ({
    type: column.termType === "uri" ? "uri" : column.termType === "bnode" ? "bnode" : "literal",
    value: column.value,
    ...(column.datatype && column.termType === "literal" ? {datatype: column.datatype} : {}),
    ...(column.lang ? {"xml:lang": column.lang} : {}),
  });
  return sparqlBindingsToXml({ head: { vars: ["s", "p", "o"] }, results: { bindings: result.describe.map(row => ({
    s: asBinding(row.subject), p: asBinding(row.predicate), o: asBinding(row.object),
  })) } });
}
