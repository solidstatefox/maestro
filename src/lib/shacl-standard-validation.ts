/**
 * Standards-based SHACL Core validation for a specifically identified focus node.
 *
 * This intentionally uses a SHACL processor, rather than treating an ad-hoc
 * SPARQL ASK or a hand-written set of tests as SHACL conformance.
 *
 * Install: npm install rdf-validate-shacl@0.6.5 @zazuko/env-node
 * The host project's existing `n3` package is already used by the RDF loader.
 * SHACL-SPARQL extensions are not supported by rdf-validate-shacl; shapes using
 * those constraints fail explicitly instead of silently reporting conformance.
 */
import rdf from "@zazuko/env-node";
import SHACLValidator from "rdf-validate-shacl";
import { Writer } from "n3";
import { getShapesGraph, queryPersonalSparql } from "@/lib/personal-sparql";
import { createBlankNodeLabelAllocator } from "@/lib/bnode";

const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const SH = "http://www.w3.org/ns/shacl#";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const iriRe = /^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i;

/** A compact RDF triple from a Record DESCRIBE. */
export type ShaclDataTriple = {
  subject: string;
  predicate: string;
  object: string;
  objectType?: string;
  datatype?: string;
  lang?: string;
};
export type StandardShaclViolation = {
  path: string;
  message: string;
  value?: string;
  focusNode: string;
  sourceShape: string;
  sourceConstraintComponent: string;
  severity: string;
};
export type StandardShaclResult = {
  conforms: boolean;
  complete: true;
  message: string;
  violations: StandardShaclViolation[];
  optionalMissing: [];
  unsupportedConstraints: [];
  /** The actual standard RDF report graph, serialized as N-Triples. */
  reportNTriples: string;
  /** XML rendering of the SHACL report for use as an XSLT input document. */
  reportXml: string;
  standard: "SHACL Core";
};

type Binding = { type?: string; value?: string; datatype?: string; "xml:lang"?: string };
type BindingRow = Record<string, Binding>;
const goodIri = (s: string): boolean => s.length <= 4096 && iriRe.test(s);
const xmlEscape = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

function term(binding: Binding | undefined, bnodeId: (label: string) => string) {
  if (!binding || typeof binding.value !== "string") throw new Error("Incomplete RDF binding in shapes graph.");
  if (binding.type === "uri") {
    if (!goodIri(binding.value)) throw new Error("Invalid shape IRI in RDF binding.");
    return rdf.namedNode(binding.value);
  }
  if (binding.type === "bnode") {
    return rdf.blankNode(bnodeId(binding.value));
  }
  if (binding["xml:lang"]) return rdf.literal(binding.value, binding["xml:lang"]);
  return rdf.literal(binding.value, rdf.namedNode(binding.datatype || `${XSD}string`));
}

function dataTerm(iriOrBlank: string, bnodeId: (label: string) => string) {
  if (iriOrBlank.startsWith("_:")) {
    return rdf.blankNode(bnodeId(iriOrBlank));
  }
  if (!goodIri(iriOrBlank)) throw new Error("Invalid RDF subject or object IRI.");
  return rdf.namedNode(iriOrBlank);
}

/** Retrieve the selected shape and its reachable SHACL subshapes, lists, and paths.
 * Importantly, this does not query or download all policies in the personal graph.
 * A bounded result which reaches the limit is an error, never an apparent pass.
 */
export async function readShaclShapeTriples(shapeUri: string, request: Request): Promise<BindingRow[]> {
  if (!goodIri(shapeUri)) throw new Error("Invalid SHACL shape IRI.");
  const shapesGraph = getShapesGraph(request);
  if (!goodIri(shapesGraph)) throw new Error("Invalid personal SHACL graph IRI.");
  const max = 5000;
  const sparql = `PREFIX sh: <${SH}> PREFIX rdf: <${RDF}>
SELECT DISTINCT ?s ?p ?o WHERE {
  GRAPH <${shapesGraph}> {
    <${shapeUri}> (sh:property|sh:in|sh:or|sh:and|sh:xone|sh:not|sh:node|sh:qualifiedValueShape|sh:path|sh:alternativePath|sh:inversePath|sh:zeroOrMorePath|sh:oneOrMorePath|sh:zeroOrOnePath|rdf:first|rdf:rest)* ?s .
    ?s ?p ?o .
  }
} LIMIT ${max + 1}`;
  const rows = (await queryPersonalSparql(sparql, 20000, request)).results?.bindings as BindingRow[] | undefined ?? [];
  if (!rows.length) throw new Error(`SHACL shape ${shapeUri} is missing or inaccessible in ${shapesGraph}.`);
  if (rows.length > max) throw new Error("SHACL shape exceeds the 5000-triple validation limit.");
  return rows;
}

/** Validate a single focus node. This explicit target is ephemeral: no data or
 * shape triples are written to the user's personal named graphs.
 */
export async function validateStandardShaclRecord(
  shapeUri: string, focusUri: string, triples: ShaclDataTriple[], request: Request,
): Promise<StandardShaclResult> {
  if (!goodIri(shapeUri) || !goodIri(focusUri)) throw new Error("A valid shape and focus-node IRI are required.");
  if (!Array.isArray(triples) || triples.length > 10000) throw new Error("A bounded DESCRIBE triple list is required.");
  const rows = await readShaclShapeTriples(shapeUri, request);
  return validateStandardShaclRows(shapeUri, focusUri, rows, triples);
}

/** Pure validation step; also used by tests without a personal SPARQL server. */
export async function validateStandardShaclRows(
  shapeUri: string, focusUri: string, rows: BindingRow[], triples: ShaclDataTriple[],
): Promise<StandardShaclResult> {
  if (!goodIri(shapeUri) || !goodIri(focusUri)) throw new Error("A valid shape and focus-node IRI are required.");
  if (!Array.isArray(triples) || triples.length > 10000) throw new Error("A bounded DESCRIBE triple list is required.");
  const shapes = rdf.dataset();
  const shapeBlankNodes = createBlankNodeLabelAllocator("sh");
  for (const row of rows) {
    if (!row.s || !row.p || !row.o) continue;
    const subject = term(row.s, shapeBlankNodes);
    const predicate = term(row.p, shapeBlankNodes);
    if (predicate.termType !== "NamedNode" || subject.termType === "Literal") throw new Error("Malformed RDF in SHACL shape.");
    shapes.add(rdf.quad(subject, predicate, term(row.o, shapeBlankNodes)));
  }
  const shapeNode = rdf.namedNode(shapeUri);
  // Use SHACL's standard sh:targetNode mechanism to validate the supplied
  // Record rather than accidentally passing with no targeted focus nodes.
  shapes.add(rdf.quad(shapeNode, rdf.namedNode(`${RDF}type`), rdf.namedNode(`${SH}NodeShape`)));
  shapes.add(rdf.quad(shapeNode, rdf.namedNode(`${SH}targetNode`), rdf.namedNode(focusUri)));
  // SHACL-SPARQL isn't supported by the chosen Core processor. Fail closed.
  if ([...shapes].some(q => q.predicate.value === `${SH}sparql`)) {
    throw new Error(`Shape ${shapeUri} uses sh:sparql; the SHACL Core validator cannot evaluate SHACL-SPARQL constraints.`);
  }
  const data = rdf.dataset();
  const dataBlankNodes = createBlankNodeLabelAllocator("data");
  for (const triple of triples) {
    if (!triple || !goodIri(triple.predicate) || !triple.subject || typeof triple.object !== "string" || triple.object.length > 100000) {
      throw new Error("Invalid DESCRIBE triple for SHACL validation.");
    }
    const subject = dataTerm(triple.subject, dataBlankNodes);
    const predicate = rdf.namedNode(triple.predicate);
    const object = triple.objectType === "uri"
      ? dataTerm(triple.object, dataBlankNodes)
      : triple.objectType === "bnode"
        ? dataTerm(triple.object.startsWith("_:") ? triple.object : `_:${triple.object}`, dataBlankNodes)
        : triple.lang
        ? rdf.literal(triple.object, triple.lang)
        : rdf.literal(triple.object, rdf.namedNode(triple.datatype || `${XSD}string`));
    data.add(rdf.quad(subject, predicate, object));
  }
  const report = await new SHACLValidator(shapes, { factory: rdf }).validate(data);
  const violations: StandardShaclViolation[] = report.results.map(result => ({
    path: result.path?.value ?? "",
    message: Array.isArray(result.message) ? result.message.map(msg => typeof msg === "string" ? msg : msg.value).join("; ") : String(result.message ?? "SHACL constraint violation"),
    ...(result.value ? { value: result.value.value } : {}),
    focusNode: result.focusNode?.value ?? focusUri,
    sourceShape: result.sourceShape?.value ?? shapeUri,
    sourceConstraintComponent: result.sourceConstraintComponent?.value ?? "",
    severity: result.severity?.value ?? `${SH}Violation`,
  }));
  const reportGraph = [...report.dataset];
  const reportNTriples = await new Promise<string>((resolve, reject) => {
    const writer = new Writer({ format: "N-Triples" });
    writer.addQuads(reportGraph);
    writer.end((error, text) => error ? reject(error) : resolve(text ?? ""));
  });
  const reportXml = `<sh:ValidationReport xmlns:sh="${SH}" conforms="${report.conforms ? "true" : "false"}" focusNode="${xmlEscape(focusUri)}" shape="${xmlEscape(shapeUri)}">${violations.map(v =>
    `<sh:result><sh:ValidationResult focusNode="${xmlEscape(v.focusNode)}" sourceShape="${xmlEscape(v.sourceShape)}" resultPath="${xmlEscape(v.path)}" severity="${xmlEscape(v.severity)}" sourceConstraintComponent="${xmlEscape(v.sourceConstraintComponent)}"${v.value === undefined ? "" : ` value="${xmlEscape(v.value)}"`}><sh:resultMessage>${xmlEscape(v.message)}</sh:resultMessage></sh:ValidationResult></sh:result>`).join("")}</sh:ValidationReport>`;
  return {
    conforms: report.conforms, complete: true,
    message: report.conforms ? "SHACL Core validation passed." : `${violations.length} SHACL Core violation(s).`,
    violations, optionalMissing: [], unsupportedConstraints: [], reportNTriples, reportXml, standard: "SHACL Core",
  };
}
