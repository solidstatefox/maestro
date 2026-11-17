"use client";
/** Execute the provider's declared Spider numeric SHACL Core shape against
 * every current result/axis cell. No numeric policy is hard-coded in TS: the
 * authoritative sh:property, sh:minCount/maxCount, nodeKind and pattern are
 * retrieved from the user's approved personal SHACL graph. */
import rdf from "@zazuko/env";
import SHACLValidator from "rdf-validate-shacl";
import { Writer } from "n3";
import { createBlankNodeLabelAllocator } from "@/lib/bnode";
import { personalContext, selectPersonal } from "@/lib/client-personal-sparql";
import { SPIDER_ANALYSIS_URI, spiderAxisKey, type SpiderAxis, type SpiderRow } from "@/lib/spider-numeric-policy";
import type { ShaclValidationReport } from "@/lib/shacl-validation-report";

const SH = "http://www.w3.org/ns/shacl#";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const MUI = "gttp://ggg.maestro.ecosys/ns/ui#";
const shapeUri = `${SPIDER_ANALYSIS_URI}/numeric-query-validator`;
type Cell = { type?: string; value?: string; datatype?: string; "xml:lang"?: string };
type Row = Record<string, Cell>;

function term(cell: Cell, blank: (value: string) => string) {
  const value = cell.value ?? "";
  if (cell.type === "uri") return rdf.namedNode(value);
  if (cell.type === "bnode") return rdf.blankNode(blank(value));
  return cell["xml:lang"] ? rdf.literal(value, cell["xml:lang"]) : rdf.literal(value, rdf.namedNode(cell.datatype || `${XSD}string`));
}
function toNTriples(quads: Iterable<ReturnType<typeof rdf.quad>>): Promise<string> {
  return new Promise((resolve, reject) => {
    const writer = new Writer({ format: "N-Triples" });
    // @zazuko/env returns RDF/JS BaseQuad objects. N3 accepts the same
    // concrete RDF/JS quad values, though its TS declaration narrows Quad.
    writer.addQuads([...quads] as unknown as Parameters<Writer["addQuads"]>[0]);
    writer.end((error, output) => error ? reject(error) : resolve(output ?? ""));
  });
}

export async function validateSpiderCore(axes: readonly SpiderAxis[], rows: readonly SpiderRow[], signal: AbortSignal): Promise<ShaclValidationReport> {
  if (axes.length < 3 || !rows.length) {
    return { complete: true, conforms: false, message: axes.length < 3
      ? "Spider needs at least three Properties or Roles in the current FCT view." : "This page has no results to plot.",
      violations: [], unsupportedConstraints: [], standard: "SHACL Core" };
  }
  const ctx = await personalContext();
  if (signal.aborted) throw signal.reason;
  // Read the declared provider policy itself, including its blank-node
  // property shape, rather than maintaining an alternative TS policy.
  const bindings = await selectPersonal(`PREFIX sh: <${SH}>
SELECT ?s ?p ?o WHERE { GRAPH <${ctx.base}/shacl/policies> {
  { BIND(<${shapeUri}> AS ?s) ?s ?p ?o }
  UNION { <${shapeUri}> sh:property ?s . ?s ?p ?o }
} } LIMIT 129`, ctx, signal) as Row[];
  if (!bindings.length || bindings.length >= 129 || !bindings.some(row => row.p?.value === `${SH}property`)) {
    throw new Error("Spider's approved numeric-query SHACL shape is missing or incomplete in the personal policy graph.");
  }
  const blanks = createBlankNodeLabelAllocator("spider_shape");
  const shapes = rdf.dataset();
  for (const row of bindings) {
    if (!row.s || !row.p || !row.o) throw new Error("Incomplete Spider SHACL shape triples.");
    const s = term(row.s, blanks), p = term(row.p, blanks);
    if (s.termType === "Literal" || p.termType !== "NamedNode") throw new Error("Malformed Spider SHACL shape RDF.");
    shapes.add(rdf.quad(s, p, term(row.o, blanks)));
  }
  const shape = rdf.namedNode(shapeUri);
  shapes.add(rdf.quad(shape, rdf.namedNode(`${RDF}type`), rdf.namedNode(`${SH}NodeShape`)));
  // Every resource/axis pair is a separate focus node. This makes min/maxCount
  // *per axis*, not across all relationships of a result resource.
  const data = rdf.dataset();
  const dataBlanks = createBlankNodeLabelAllocator("spider_data");
  const focusDescriptions = new Map<string, string>();
  let count = 0;
  for (const [rowIndex, row] of rows.entries()) for (const [axisIndex, axis] of axes.entries()) {
    if (signal.aborted) throw signal.reason;
    if (++count > 5000) throw new Error("Spider SHACL evaluation exceeds the bounded 5000-cell limit.");
    const focus = rdf.namedNode(`urn:maestro:spider:cell:${rowIndex}:${axisIndex}`);
    focusDescriptions.set(focus.value, `${axis.label}: ${row.label || row.uri}`);
    shapes.add(rdf.quad(shape, rdf.namedNode(`${SH}targetNode`), focus));
    const values = (row.values[spiderAxisKey(axis)] ?? []).filter(value => value.value !== "-");
    for (const value of values) {
      const v = value.type === "uri" ? rdf.namedNode(value.value)
        : value.type === "bnode" ? rdf.blankNode(dataBlanks(value.value))
        : rdf.literal(value.value, rdf.namedNode(value.datatype || `${XSD}string`));
      data.add(rdf.quad(focus, rdf.namedNode(`${MUI}axisValue`), v));
    }
  }
  const result = await new SHACLValidator(shapes, { factory: rdf }).validate(data);
  if (signal.aborted) throw signal.reason;
  const violations = result.results.map(entry => ({
    path: entry.path?.value ?? `${MUI}axisValue`,
    message: `${focusDescriptions.get(entry.focusNode?.value ?? "") ?? "Spider numeric axis"}: ${
      Array.isArray(entry.message) ? entry.message.map(message => typeof message === "string" ? message : message.value).join("; ") : String(entry.message ?? "SHACL Core constraint violation")}`,
    ...(entry.value ? { value: entry.value.value } : {}),
  }));
  return { complete: true, conforms: result.conforms, standard: "SHACL Core",
    message: result.conforms ? `${count} Spider numeric axis cells passed the provider's SHACL Core shape.`
      : `${violations.length} Spider numeric SHACL Core violation(s).`,
    violations, optionalMissing: [], unsupportedConstraints: [], reportNTriples: await toNTriples(result.dataset) };
}
