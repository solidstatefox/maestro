"use client";
import { GRAPH, resolveGraph } from "@/lib/constants/graphs";
/** Query-context SHACL Core, evaluated IN THE BROWSER against the RDF tree
 * linked from the exact current History visit. /sparql is transport only.
 * The Record validator uses the same rdf-validate-shacl processor and report
 * data contract; the visible report component is shared without duplication. */
import rdf from "@zazuko/env";
import SHACLValidator from "rdf-validate-shacl";
import { Writer } from "n3";
import { createBlankNodeLabelAllocator } from "@/lib/bnode";
import { personalContext, selectPersonal, type PersonalContext } from "@/lib/client-personal-sparql";
import { VFCT } from "@/lib/history-query-rdf";
import type { ShaclValidationReport } from "@/lib/shacl-validation-report";

const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const SH = "http://www.w3.org/ns/shacl#";
const BOOKMARK = "http://www.w3.org/2002/01/bookmark#";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const MUI = "gttp://ggg.maestro.ecosys/ns/ui#";
const valid = (v: string) => v.length < 4096 && /^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(v);
const safe = (v: string) => { if (!valid(v)) throw new Error("Invalid SHACL context IRI"); return `<${v}>`; };
type Cell = { type?: string; value?: string; datatype?: string; "xml:lang"?: string };
type Row = Record<string, Cell>;
type Triple = { subject: string; predicate: string; object: string; type: string; datatype?: string; lang?: string };
export type ValidatedHistoryQuery = { historyId: string; queryRoot: string; report: ShaclValidationReport; queryProviders: string[] };

const toTerm = (value: Cell, bnode: (name: string) => string) => {
  if (!value?.value) throw new Error("Incomplete SPARQL RDF term");
  if (value.type === "uri") return rdf.namedNode(value.value);
  if (value.type === "bnode") return rdf.blankNode(bnode(value.value));
  return value["xml:lang"] ? rdf.literal(value.value, value["xml:lang"]) : rdf.literal(value.value, rdf.namedNode(value.datatype || `${XSD}string`));
};
async function shapeRows(ctx: PersonalContext, shape: string, signal: AbortSignal): Promise<Row[]> {
  const limit = 4001;
  const rows = await selectPersonal(`PREFIX sh: <${SH}> PREFIX rdf: <${RDF}>
SELECT DISTINCT ?s ?p ?o WHERE { GRAPH <${resolveGraph(GRAPH.SHACL_POLICIES, ctx.base)}> {
 ${safe(shape)} (sh:property|sh:in|sh:or|sh:and|sh:xone|sh:not|sh:node|sh:qualifiedValueShape|sh:path|sh:alternativePath|sh:inversePath|sh:zeroOrMorePath|sh:oneOrMorePath|sh:zeroOrOnePath|rdf:first|rdf:rest)* ?s .
 ?s ?p ?o .
} } LIMIT ${limit}`, ctx, signal);
  if (rows.length === limit) throw new Error("SHACL shape exceeds the safe size; validation incomplete.");
  if (!rows.length) throw new Error(`SHACL shape ${shape} is missing from the personal graph.`);
  return rows as Row[];
}
/** The same SHACL Core algorithm as Record: explicit focus, actual RDF graph,
 * unsupported SHACL-SPARQL fails closed, N-Triples validation report. */
async function evaluate(shape: string, focus: string, shapeTriples: Row[], triples: Triple[]): Promise<ShaclValidationReport> {
  const shapeNodes = createBlankNodeLabelAllocator("query_shape");
  const shapes = rdf.dataset();
  for (const row of shapeTriples) {
    if (!row.s || !row.p || !row.o) continue;
    const subject = toTerm(row.s, shapeNodes), predicate = toTerm(row.p, shapeNodes);
    if (subject.termType === "Literal" || predicate.termType !== "NamedNode") throw new Error("Invalid SHACL graph RDF term");
    shapes.add(rdf.quad(subject, predicate, toTerm(row.o, shapeNodes)));
  }
  const shapeNode = rdf.namedNode(shape);
  shapes.add(rdf.quad(shapeNode,rdf.namedNode(`${RDF}type`),rdf.namedNode(`${SH}NodeShape`)));
  shapes.add(rdf.quad(shapeNode,rdf.namedNode(`${SH}targetNode`),rdf.namedNode(focus)));
  if ([...shapes].some(q=>q.predicate.value === `${SH}sparql`))
    throw new Error("SHACL-SPARQL constraints require a supported evaluator; cannot report conformance from SHACL Core alone.");
  const data = rdf.dataset();
  const dataBlanks = createBlankNodeLabelAllocator("query_data");
  for (const triple of triples) {
    const subject = triple.subject.startsWith("_:") ? rdf.blankNode(dataBlanks(triple.subject)) : rdf.namedNode(triple.subject);
    const object = triple.type === "uri" ? rdf.namedNode(triple.object)
      : triple.type === "bnode" ? rdf.blankNode(dataBlanks(triple.object))
      : triple.lang ? rdf.literal(triple.object, triple.lang)
      : rdf.literal(triple.object, rdf.namedNode(triple.datatype || `${XSD}string`));
    data.add(rdf.quad(subject,rdf.namedNode(triple.predicate),object));
  }
  const result = await new SHACLValidator(shapes,{factory:rdf}).validate(data);
  const violations = result.results.map(v=>({ path:v.path?.value ?? "",
    message: Array.isArray(v.message) ? v.message.map(m=>typeof m === "string"?m:m.value).join("; ") : String(v.message ?? "SHACL constraint violation"),
    ...(v.value ? {value:v.value.value} : {}) }));
  const reportNTriples = await new Promise<string>((resolve,reject)=>{
    const writer = new Writer({format:"N-Triples"});
    writer.addQuads([...result.dataset]);
    writer.end((error,text)=>error?reject(error):resolve(text??""));
  });
  return { complete:true, conforms:result.conforms, message: result.conforms ? "SHACL Core validation passed." : `${violations.length} SHACL Core violation(s).`,
    violations, unsupportedConstraints:[], optionalMissing:[], reportNTriples, standard:"SHACL Core" };
}
function mergeReports(reports: ShaclValidationReport[]): ShaclValidationReport {
  return { complete:reports.every(r=>r.complete), conforms:reports.every(r=>r.complete && r.conforms),
    message:reports.every(r=>r.complete && r.conforms)
      ? `Current History query conforms to ${reports.length} contextual SHACL shape(s).`
      : `Current History query fails ${reports.filter(r=>!r.complete || !r.conforms).length} contextual SHACL shape(s).`,
    violations:reports.flatMap(r=>r.violations), optionalMissing:reports.flatMap(r=>r.optionalMissing ?? []),
    unsupportedConstraints:reports.flatMap(r=>r.unsupportedConstraints), reportNTriples:reports.map(r=>r.reportNTriples??"").join("\n"), standard:"SHACL Core" };
}
export async function validateCurrentHistoryQuery(historyId: string, queryXml: string, signal: AbortSignal): Promise<ValidatedHistoryQuery> {
  safe(historyId);
  const ctx=await personalContext();
  const historyGraph=safe(`${resolveGraph(GRAPH.HISTORY, ctx.base)}`);
  // No legacy History conversion or fallback. Every new visit has an explicit
  // bookmark:recalls link and a structured query tree from the initial INSERT DATA.
  const visits=await selectPersonal(`PREFIX vfct: <${VFCT}> PREFIX bookmark: <${BOOKMARK}>
SELECT ?root ?xml WHERE { GRAPH ${historyGraph} {
  ${safe(historyId)} a vfct:QueryHistoryVisit ; vfct:historyQueryXML ?xml ; bookmark:recalls ?root .
} } LIMIT 2`,ctx,signal) as Row[];
  if(visits.length!==1 || !visits[0].root?.value || !visits[0].xml?.value)
    throw new Error("Current History visit is missing its structured query RDF; legacy XML-only visits are unsupported.");
  const root=visits[0].root.value;safe(root);
  // A stale visit from a previous live query must never validate the new one.
  if(visits[0].xml.value.trim()!==queryXml.trim()) throw new Error("History visit does not match the current live FCT query.");
  const dataRows=await selectPersonal(`PREFIX vfct: <${VFCT}> PREFIX bookmark: <${BOOKMARK}> SELECT ?s ?p ?o WHERE { GRAPH ${historyGraph} {
    ${safe(historyId)} bookmark:recalls ${safe(root)} .
    ${safe(root)} (vfct:child|vfct:attribute)* ?s . ?s ?p ?o .
  } } LIMIT 10001`, ctx,signal) as Row[];
  if (!dataRows.length || dataRows.length >=10001) throw new Error("History query RDF is empty or incomplete.");
  const data:Triple[]=dataRows.filter(row=>row.s?.value && row.p?.value && row.o?.value!==undefined).map(row=>({
    subject:row.s.value!, predicate:row.p.value!, object:row.o.value!, type:row.o.type??"literal",datatype:row.o.datatype,lang:row.o["xml:lang"] }));
  // Find standard SHACL Core targets for the QUERY root (not just result URIs).
  // This is separate from provider input shapes, which are evaluated *after*.
  const targetQuery=`PREFIX sh: <${SH}> PREFIX mui: <${MUI}> PREFIX vfct: <${VFCT}>
SELECT DISTINCT ?shape WHERE { GRAPH <${resolveGraph(GRAPH.SHACL_POLICIES, ctx.base)}> {
 ?shape a sh:NodeShape .
 FILTER NOT EXISTS { ?provider mui:accepts ?shape }
 { ?shape sh:targetNode ${safe(root)} }
 UNION { ?shape sh:targetClass vfct:query }
 UNION { ?shape sh:targetSubjectsOf ?p . FILTER EXISTS { GRAPH ${historyGraph} { ${safe(root)} ?p ?o } } }
 UNION { ?shape sh:targetObjectsOf ?p . FILTER EXISTS { GRAPH ${historyGraph} { ?s ?p ${safe(root)} } } }
} } ORDER BY ?shape LIMIT 101`;
  const targets=await selectPersonal(targetQuery,ctx,signal);
  if(targets.length>=101) throw new Error("Too many query-context SHACL shapes; discovery incomplete.");
  if(!targets.length) throw new Error("No SHACL shape targets the current History query RDF. Seed the query-context shape.");
  const reports:ShaclValidationReport[]=[];
  for(const target of targets){if(signal.aborted)throw signal.reason;const shape=target.shape?.value??"";if(!valid(shape))continue;
    reports.push(await evaluate(shape,root,await shapeRows(ctx,shape,signal),data));}
  if(!reports.length) throw new Error("No usable query-context SHACL shapes were returned.");
  const report=mergeReports(reports);
  if(!report.conforms) return {historyId,queryRoot:root,report,queryProviders:[]};
  // Candidate providers may target the query structure. The ordinary result
  // population's sh:class/targetClass matching runs separately and is UNIONED
  // with this validated candidate set by discoverViews/discoverAnalyses.
  const providerRows=await selectPersonal(`PREFIX sh: <${SH}> PREFIX mui: <${MUI}> PREFIX vfct: <${VFCT}>
SELECT DISTINCT ?provider ?shape WHERE { GRAPH <${resolveGraph(GRAPH.SHACL_POLICIES, ctx.base)}> {
 ?provider a mui:Provider ; mui:accepts ?shape .
 { ?shape sh:targetClass vfct:query }
 UNION { ?shape sh:class vfct:query }
 UNION { ?shape sh:targetNode ${safe(root)} }
 UNION { ?shape sh:targetSubjectsOf ?p . FILTER EXISTS { GRAPH ${historyGraph} { ${safe(root)} ?p ?o } } }
 UNION { ?shape sh:targetObjectsOf ?p . FILTER EXISTS { GRAPH ${historyGraph} { ?s ?p ${safe(root)} } } }
} } LIMIT 101`,ctx,signal);
  if(providerRows.length>=101) throw new Error("More than 100 query-target providers; discovery incomplete.");
  const matches:string[]=[];
  for(const row of providerRows){if(signal.aborted)throw signal.reason;const provider=row.provider?.value??"",shape=row.shape?.value??"";
    if(!valid(provider)||!valid(shape))continue;
    const check=await evaluate(shape,root,await shapeRows(ctx,shape,signal),data);
    if(check.conforms)matches.push(provider);
  }
  return {historyId,queryRoot:root,report,queryProviders:[...new Set(matches)]};
}
