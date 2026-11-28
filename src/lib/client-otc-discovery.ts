"use client";
import { GRAPH, resolveGraph } from "@/lib/constants/graphs";

import { personalContext, personalExists, selectPersonal } from "@/lib/client-personal-sparql";

const OTC = "gttp://ggg.openlink.sw/nlp/transcoder#";
const MUI = "gttp://ggg.maestro.ecosys/ns/ui#";
const DCT = "http://purl.org/dc/terms/";
const safeIri = (value: string) => /^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(value) && value.length <= 2048;

/** Catalog lookup is pure client code; the authenticated graph server decides access. */
export async function clientListTranscoders(rulesGraph: string, signal?: AbortSignal) {
  if (!safeIri(rulesGraph)) throw new Error("Invalid OTC rules graph IRI.");
  const ctx = await personalContext();
  const rows = await selectPersonal(`PREFIX otc: <${OTC}> PREFIX mui: <${MUI}> PREFIX dcterms: <${DCT}>
    SELECT DISTINCT ?transcoder ?title WHERE { GRAPH <${rulesGraph}> {
      ?transcoder a otc:Transcoder ; otc:hasRule ?rule . OPTIONAL { ?transcoder dcterms:title ?title }
    } } LIMIT 100`, ctx, signal,"client-otc-discovery:clientListTranscoders","view",{tab:"personal",ribbon:"session"});
  return rows.map(row => ({uri: row.transcoder?.value ?? "", title: row.title?.value || row.transcoder?.value || ""}));
}

/** The chat survey picker never needs the transcoding service: it is an RDF discovery SELECT. */
export async function clientListChatSurveys(signal?: AbortSignal) {
  const ctx = await personalContext();
  // Mirrors graph/manifest.json's otc-transcoders.rdf mapping.
  const rulesGraph = `${resolveGraph(GRAPH.OTC_TRANSCODERS, ctx.base)}`;
  const rows = await selectPersonal(`PREFIX otc: <${OTC}> PREFIX mui: <${MUI}> PREFIX dcterms: <${DCT}>
    SELECT DISTINCT ?transcoder ?title ?description WHERE { GRAPH <${rulesGraph}> {
      ?transcoder a otc:Transcoder, mui:Provider ; otc:hasRule ?rule ; mui:accepts ?shape ; mui:widget ?widget .
      ?widget a mui:RdfTranscoderWidget .
      OPTIONAL { ?transcoder dcterms:title ?title }
      OPTIONAL { ?transcoder dcterms:description ?description }
    } } ORDER BY ?title LIMIT 50`, ctx, signal,"client-otc-discovery:clientListChatSurveys","view",{tab:"personal",ribbon:"session"});
  return { rulesGraph, surveys: rows.flatMap(row => {
    const uri = row.transcoder?.value;
    return uri ? [{ uri, title: row.title?.value || uri.split("#").pop() || uri,
      description: row.description?.value || "" }] : [];
  }) };
}

/** The OTC import verifier is a simple read of the selected personal graph. */
export async function clientVerifyOtcGraph(graph: string, signal?: AbortSignal): Promise<{exists: boolean}> {
  if (!safeIri(graph)) throw new Error("Invalid OTC graph IRI.");
  const ctx = await personalContext();
  return { exists: await personalExists(`GRAPH <${graph}> { ?s ?p ?o }`, ctx, signal,"client-otc-discovery:clientVerifyOtcGraph",{tab:"personal",ribbon:"session"}) };
}
