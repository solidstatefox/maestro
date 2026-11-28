"use client";

import { loadPersonalAuthSession } from "@/lib/personal-auth";
import { providerCatalogGraph } from "@/lib/graph-context";
import { selectPersonal, personalContext } from "@/lib/client-personal-sparql";
import { sparqlBindingsToXml } from "@/lib/sparql-results-xml";

const validIri = (uri: string) => /^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(uri);
const SH = "http://www.w3.org/ns/shacl#";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";

/** Fetch the SHACL graph's full path/list closure, including sh:or RDF lists.
 * A finite FCT DESCRIBE may omit rdf:first/rest, which makes valid provider
 * query templates appear ineligible. This is a client-owned SPARQL read. */
export async function readProviderShapeXml(shape: string, signal?: AbortSignal): Promise<string> {
  if (!validIri(shape)) throw new Error("Invalid SHACL shape IRI.");
  const session = await loadPersonalAuthSession();
  if (!session) throw new Error("Log in to read a personal SHACL shape.");
  const { graph } = providerCatalogGraph(session, "policies");
  const ctx = await personalContext();
  const rows = await selectPersonal(`PREFIX sh: <${SH}> PREFIX rdf: <${RDF}>
    SELECT DISTINCT ?s ?p ?o WHERE {
      GRAPH <${graph}> {
        <${shape}> (sh:property|sh:in|sh:or|sh:and|sh:xone|sh:not|sh:node|sh:qualifiedValueShape|sh:path|sh:alternativePath|sh:inversePath|sh:zeroOrMorePath|sh:oneOrMorePath|sh:zeroOrOnePath|rdf:first|rdf:rest)* ?s .
        ?s ?p ?o .
      }
    } LIMIT 10000`, ctx, signal,"provider-shape:readProviderShapeXml","view",{tab:"personal",ribbon:"session"});
  if (!rows.length) throw new Error(`SHACL input shape ${shape} is missing or inaccessible.`);
  if (rows.length >= 10000) throw new Error("SHACL shape closure exceeds its safety limit.");
  const binding = (term: {type?:string; value?:string; datatype?:string} | undefined) => ({
    type: term?.type === "uri" ? "uri" as const : term?.type === "bnode" ? "bnode" as const : "literal" as const,
    value: term?.value ?? "",
    ...(term?.datatype && term?.type === "literal" ? {datatype: term.datatype} : {}),
  });
  return sparqlBindingsToXml({head:{vars:["s","p","o"]},results:{bindings:rows.map(row=>({
    s: binding(row.s), p: binding(row.p), o: binding(row.o),
  }))}});
}
