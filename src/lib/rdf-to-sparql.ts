/**
 * Converts an RDF document (Turtle, N-Triples, N3, TriG, N-Quads, RDF/XML) into a single SPARQL
 * `INSERT DATA { GRAPH <g> { ... } }` update.
 *
 * Why this exists: Virtuoso's graph-store endpoint (/sparql-graph-crud-auth) loads files through
 * DB.DBA.TTLP_RL_NEW_GRAPH, which ordinary accounts (e.g. the OpenLink demo server's "acme") are not
 * allowed to execute (SR575). The SPARQL update endpoint (/sparql-auth) is permitted for those accounts,
 * so Maestro parses the document itself and loads it with INSERT DATA instead.
 *
 * Server-side only. The parser packages are imported lazily so they are never bundled for the browser.
 */

type RdfTerm = {
  termType: string;
  value: string;
  language?: string;
  datatype?: { value: string };
};
type RdfTriple = { subject: RdfTerm; predicate: RdfTerm; object: RdfTerm };

const XSD_STRING = "http://www.w3.org/2001/XMLSchema#string";
const RDF_LANG_STRING = "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString";

/** File extension -> parser used by Maestro. Extensions not listed here fall back to the graph-store endpoint. */
const N3_FORMATS: Record<string, string> = {
  ".ttl": "Turtle",
  ".nt": "N-Triples",
  ".n3": "N3",
  ".trig": "TriG",
  ".nq": "N-Quads",
  ".n4": "N-Quads",
};
const RDFXML_EXTENSIONS = new Set([".rdf", ".rdfs", ".owl", ".xml"]);

/** True when Maestro can parse this extension itself (so the document can be loaded with INSERT DATA). */
export function canParseRdfExtension(extension: string): boolean {
  const ext = extension.toLowerCase();
  return ext in N3_FORMATS || RDFXML_EXTENSIONS.has(ext);
}

async function parseRdfXml(content: string, baseIri: string): Promise<RdfTriple[]> {
  const { RdfXmlParser } = await import("rdfxml-streaming-parser");
  const parser = new RdfXmlParser({ baseIRI: baseIri });
  return new Promise<RdfTriple[]>((resolve, reject) => {
    const quads: RdfTriple[] = [];
    parser.on("data", (quad: RdfTriple) => quads.push(quad));
    parser.on("error", (error: Error) => reject(error));
    parser.on("end", () => resolve(quads));
    parser.write(content);
    parser.end();
  });
}

async function parseWithN3(content: string, format: string, baseIri: string): Promise<RdfTriple[]> {
  const { Parser } = await import("n3");
  const parser = new Parser({ format, baseIRI: baseIri });
  return parser.parse(content) as unknown as RdfTriple[];
}

/** Parse an RDF document. Blank-node/IRI resolution uses baseIri for any relative IRIs. */
export async function parseRdfDocument(content: string, extension: string, baseIri: string): Promise<RdfTriple[]> {
  const ext = extension.toLowerCase();
  if (RDFXML_EXTENSIONS.has(ext)) return parseRdfXml(content, baseIri);
  const format = N3_FORMATS[ext];
  if (!format) throw new Error(`No RDF parser is available for ${ext} files.`);
  return parseWithN3(content, format, baseIri);
}

const hex4 = (char: string) => `\\u${char.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`;

function serializeIri(value: string): string {
  // Characters that may not appear raw inside <...> in SPARQL.
  return `<${value.replace(/[\u0000-\u0020<>"{}|^`\\]/g, hex4)}>`;
}

function serializeLiteral(term: RdfTerm): string {
  const escaped = term.value.replace(/[\\"\n\r\t\u0000-\u001f\u007f]/g, (char) => {
    switch (char) {
      case "\\": return "\\\\";
      case '"': return '\\"';
      case "\n": return "\\n";
      case "\r": return "\\r";
      case "\t": return "\\t";
      default: return hex4(char);
    }
  });
  if (term.language) return `"${escaped}"@${term.language}`;
  const datatype = term.datatype?.value;
  if (datatype && datatype !== XSD_STRING && datatype !== RDF_LANG_STRING) return `"${escaped}"^^${serializeIri(datatype)}`;
  return `"${escaped}"`;
}

function serializeTerm(term: RdfTerm, bnodePrefix: string): string {
  switch (term.termType) {
    case "NamedNode": return serializeIri(term.value);
    case "BlankNode": return `_:${bnodePrefix}${term.value.replace(/[^A-Za-z0-9_]/g, "_")}`;
    case "Literal": return serializeLiteral(term);
    default: throw new Error(`Unsupported RDF term type "${term.termType}" (variables and quoted triples cannot be loaded).`);
  }
}

/** Reject anything that could break out of the <graph> IRI in the update text. */
function assertSafeGraphIri(graph: string): string {
  if (/[\u0000-\u0020<>"{}|^`\\]/.test(graph)) throw new Error(`Graph IRI contains characters that are not allowed: ${graph}`);
  return graph;
}

/** Largest update body Maestro will POST (OpenLink's gateway rejects very large request bodies). */
const MAX_UPDATE_BYTES = 900_000;

/**
 * Build one `INSERT DATA` update holding every triple. It is deliberately a single request: blank-node labels
 * are only shared inside one SPARQL Update request, so splitting would disconnect blank nodes from the
 * triples that reference them.
 */
export function buildInsertData(graph: string, triples: RdfTriple[]): string {
  const safeGraph = assertSafeGraphIri(graph);
  const lines = triples.map((triple) => {
    const bnodePrefix = "m";
    return `${serializeTerm(triple.subject, bnodePrefix)} ${serializeTerm(triple.predicate, bnodePrefix)} ${serializeTerm(triple.object, bnodePrefix)} .`;
  });
  const update = `INSERT DATA { GRAPH <${safeGraph}> {\n${lines.join("\n")}\n} }`;
  if (Buffer.byteLength(update, "utf8") > MAX_UPDATE_BYTES) {
    throw new Error(`The document is too large (${Buffer.byteLength(update, "utf8")} bytes) to load with a single SPARQL INSERT DATA request.`);
  }
  return update;
}
