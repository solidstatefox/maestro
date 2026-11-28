"use client";
/** Import OTC rules and N-Triples directly from the browser into the user's
 * personal graph through SPARQL Update. No Maestro server RDF parser. */
import { parseClientRdf, clientRdfInsert, type ClientRdfTriple } from "@/lib/client-rdf-ingest";
import { updatePersonal } from "@/lib/client-personal-sparql";

const ALLOWED = new Set([".rdf", ".xml", ".nt"]);
const isIri = (value: string) => /^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(value) && value.length <= 2048;

export async function importOtcRdf(graph: string, extension: string, content: string, signal?: AbortSignal): Promise<number> {
  if (!isIri(graph)) throw new Error("Invalid OTC destination graph IRI.");
  if (!ALLOWED.has(extension.toLowerCase())) throw new Error("OTC import supports RDF/XML and N-Triples only.");
  if (!content || content.length > 600_000) throw new Error("OTC RDF import batch is empty or exceeds 600 KB.");
  const triples = await parseClientRdf(content, extension.toLowerCase(), graph);
  if (triples.length === 0 || triples.length > 8000) throw new Error("OTC RDF batch must contain between 1 and 8,000 triples.");
  // SPARQL blank labels are scoped to a single request. Skolemize once per
  // import so blank-node identity survives independent INSERT DATA batches.
  const blankLabels = new Map<string, string>();
  const skolemize = (term: ClientRdfTriple["subject"]): ClientRdfTriple["subject"] => {
    if (term.termType !== "BlankNode") return term;
    let uri = blankLabels.get(term.value);
    if (!uri) { uri = `urn:maestro:otc:blank:${crypto.randomUUID()}`; blankLabels.set(term.value, uri); }
    return {termType: "NamedNode", value: uri};
  };
  for (let offset = 0; offset < triples.length; offset += 200) {
    if (signal?.aborted) throw signal.reason;
    const part = triples.slice(offset, offset + 200).map(t => ({
      subject: skolemize(t.subject), predicate: t.predicate, object: skolemize(t.object),
    }));
    const update = clientRdfInsert(graph, part);
    if (update.length > 1_950_000) throw new Error("An OTC RDF batch cannot fit in a bounded SPARQL Update.");
    await updatePersonal(update, signal,undefined,"client-otc-import:importOtcRdf",undefined,"view",{tab:"personal",ribbon:"session"});
  }
  return triples.length;
}

/** Chat uploads are parsed locally and inserted in bounded batches. Stable
 * skolem IRIs preserve Turtle blank-node identity across SPARQL updates. */
export async function importOtcTurtle(graph: string, content: string, signal?: AbortSignal): Promise<number> {
  if (!isIri(graph)) throw new Error("Invalid OTC destination graph IRI.");
  if (!content || content.length > 700_000) throw new Error("The Turtle input must be between 1 byte and 700 KB.");
  const triples = await parseClientRdf(content, ".ttl", graph);
  if (!triples.length || triples.length > 30_000) throw new Error("OTC Turtle must contain between 1 and 30,000 triples.");
  const blanks = new Map<string, string>();
  const skolemize = (term: ClientRdfTriple["subject"]): ClientRdfTriple["subject"] => {
    if (term.termType !== "BlankNode") return term;
    let value = blanks.get(term.value);
    if (!value) { value = `urn:maestro:otc:blank:${crypto.randomUUID()}`; blanks.set(term.value,value); }
    return {termType:"NamedNode",value};
  };
  for (let offset=0; offset<triples.length; offset+=120) {
    if (signal?.aborted) throw signal.reason;
    const part=triples.slice(offset,offset+120).map(t=>({
      subject:skolemize(t.subject), predicate:t.predicate, object:skolemize(t.object),
    }));
    await updatePersonal(clientRdfInsert(graph,part), signal,undefined,"client-otc-import:importOtcTurtle",undefined,"view",{tab:"personal",ribbon:"session"});
  }
  return triples.length;
}
