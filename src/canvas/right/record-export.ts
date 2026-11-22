"use client";

import { DataFactory, Writer } from "n3";
// The factory's public return type is BaseQuad (its terms are unrestricted).
// Writer.addQuads requires RDF/JS Quad with a resource subject and predicate.
// Use the writer contract so the exported array is typed for its consumer.
type Quad = Parameters<Writer["addQuads"]>[0][number];

const FCT = "http://openlinksw.com/services/facets/1.0/";
export type RecordExportFormat = "ntriples" | "turtle" | "n3" | "rdfxml";
export const RECORD_EXPORT_FORMATS: Record<RecordExportFormat, { name: string; mime: string; extension: string }> = {
  ntriples: { name: "N-Triples", mime: "application/n-triples", extension: "nt" },
  turtle: { name: "Turtle", mime: "text/turtle", extension: "ttl" },
  n3: { name: "Notation3 (N3)", mime: "text/n3", extension: "n3" },
  rdfxml: { name: "RDF/XML", mime: "application/rdf+xml", extension: "rdf" },
};

const absoluteIri = (value: string) => /^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(value);
const safeXml = (v: string) => v.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");

/** The immutable, term-typed Record DESCRIBE snapshot is the ONLY input.
 * Reject parser errors and incomplete results; never export partial RDF. */
export function snapshotRecordQuads(snapshot: { uri: string; xml: string; incomplete: boolean }): Quad[] {
  if (snapshot.incomplete) throw new Error("Record DESCRIBE is incomplete; increase the Record limit or timeout and retry before downloading RDF.");
  const doc = new DOMParser().parseFromString(snapshot.xml, "application/xml");
  const parseError = doc.querySelector("parsererror");
  if (parseError) throw new Error(`Cannot export malformed Record DESCRIBE XML: ${parseError.textContent ?? "Unknown XML error"}`);
  if (doc.documentElement?.namespaceURI !== FCT || doc.documentElement.localName !== "facets")
    throw new Error("Record DESCRIBE does not have an FCT facets XML root.");
  const quads: Quad[] = [];
  const asResource = (value: string, kind: string) => {
    if (kind === "bnode") return DataFactory.blankNode(value.replace(/^_:/, ""));
    if (!absoluteIri(value)) throw new Error(`Invalid RDF resource in Record DESCRIBE: ${value}`);
    return DataFactory.namedNode(value);
  };
  for (const row of Array.from(doc.getElementsByTagNameNS(FCT, "row"))) {
    const cells = Array.from(row.getElementsByTagNameNS(FCT, "column"));
    if (cells.length !== 3) throw new Error("Incomplete Record DESCRIBE row: expected subject, predicate and object.");
    const [subject, predicate, object] = cells;
    const s = subject.textContent ?? "", p = predicate.textContent ?? "", o = object.textContent ?? "";
    const subjectTerm = asResource(s, subject.getAttribute("termType") || "uri");
    if (!absoluteIri(p)) throw new Error(`Invalid Record predicate: ${p}`);
    const objectKind = object.getAttribute("termType") || (absoluteIri(o) ? "uri" : "literal");
    const objectTerm = objectKind === "uri" || objectKind === "bnode" ? asResource(o, objectKind)
      : object.getAttribute("xml:lang") ? DataFactory.literal(o, object.getAttribute("xml:lang")!)
      : object.getAttribute("datatype") ? DataFactory.literal(o, DataFactory.namedNode(object.getAttribute("datatype")!))
      : DataFactory.literal(o);
    // asResource() restricts subjects to NamedNode/BlankNode; predicates are
    // always NamedNode, so this factory-built BaseQuad satisfies Writer's Quad.
    quads.push(DataFactory.quad(subjectTerm, DataFactory.namedNode(p), objectTerm) as Quad);
  }
  if (!quads.length) throw new Error("Record DESCRIBE has no triples to download.");
  return quads;
}

/** RDF/XML requires predicate names representable as XML QNames. */
function rdfXml(quads: readonly Quad[]): string {
  const namespaces = new Map<string, string>();
  const predicates = quads.map(quad => {
    const iri = quad.predicate.value;
    const match = /^(.*[#/])([A-Za-z_][A-Za-z0-9_.-]*)$/.exec(iri);
    if (!match) throw new Error(`Cannot encode RDF/XML predicate as an XML QName: ${iri}`);
    if (!namespaces.has(match[1])) namespaces.set(match[1], `ns${namespaces.size + 1}`);
    return `${namespaces.get(match[1])}:${match[2]}`;
  });
  const nsAttrs = [...namespaces].map(([uri, prefix]) => ` xmlns:${prefix}="${safeXml(uri)}"`).join("");
  const body = quads.map((quad, i) => {
    const subjectAttr = quad.subject.termType === "BlankNode" ? `rdf:nodeID="${safeXml(quad.subject.value)}"` : `rdf:about="${safeXml(quad.subject.value)}"`;
    const object = quad.object;
    const element = object.termType === "NamedNode" ? `<${predicates[i]} rdf:resource="${safeXml(object.value)}"/>`
      : object.termType === "BlankNode" ? `<${predicates[i]} rdf:nodeID="${safeXml(object.value)}"/>`
      : object.termType === "Literal" ? `<${predicates[i]}${object.language ? ` xml:lang="${safeXml(object.language)}"` : object.datatype?.value && object.datatype.value !== "http://www.w3.org/2001/XMLSchema#string" ? ` rdf:datatype="${safeXml(object.datatype.value)}"` : ""}>${safeXml(object.value)}</${predicates[i]}>`
      : (() => { throw new Error(`RDF/XML export does not support object term type ${object.termType}`); })();
    return `  <rdf:Description ${subjectAttr}>${element}</rdf:Description>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"${nsAttrs}>\n${body}\n</rdf:RDF>\n`;
}

export async function serializeRecordQuads(quads: Quad[], format: RecordExportFormat): Promise<string> {
  if (format === "rdfxml") return rdfXml(quads);
  const option = format === "ntriples" ? "N-Triples" : format === "n3" ? "N3" : "Turtle";
  return new Promise<string>((resolve, reject) => {
    const writer = new Writer({ format: option });
    writer.addQuads(quads);
    writer.end((error: Error | null, text: string) => error ? reject(error) : resolve(text));
  });
}
