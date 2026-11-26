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
import { readShapeBatches, type ShapeRead } from "@/lib/shacl-shape-batch";
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
export type ValidatedHistoryQuery = { historyId: string; queryRoot: string; report: ShaclValidationReport; queryProviders: string[]; providerErrors?: string[] };

const toTerm = (value: Cell, bnode: (name: string) => string) => {
  if (value?.value === undefined) throw new Error("Incomplete SPARQL RDF term");
  if (value.type === "uri") return rdf.namedNode(value.value);
  if (value.type === "bnode") return rdf.blankNode(bnode(value.value));
  return value["xml:lang"] ? rdf.literal(value.value, value["xml:lang"]) : rdf.literal(value.value, rdf.namedNode(value.datatype || `${XSD}string`));
};
async function shapeRows(ctx:PersonalContext,shapes:readonly string[],signal:AbortSignal):Promise<Map<string,ShapeRead>> {
  return readShapeBatches(resolveGraph(GRAPH.SHACL_POLICIES,ctx.base),shapes,4001,
    (query,requestSignal)=>selectPersonal(query,ctx,requestSignal,"QueryContextValidation:Shapes"),signal);
}
function completeShape(rows:Map<string,ShapeRead>,shape:string):Row[]{
  const result=rows.get(shape);
  if(!result||!result.rows)throw result?.error??new Error(`SHACL shape ${shape} was not loaded.`);
  return result.rows;
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
} } LIMIT 2`,ctx,signal,"QueryContextValidation:History") as Row[];
  if(visits.length!==1 || !visits[0].root?.value || !visits[0].xml?.value)
    throw new Error("Current History visit is missing its structured query RDF; legacy XML-only visits are unsupported.");
  const root=visits[0].root.value;safe(root);
  // A stale visit from a previous live query must never validate the new one.
  if(visits[0].xml.value.trim()!==queryXml.trim()) throw new Error("History visit does not match the current live FCT query.");
  const dataRows=await selectPersonal(`PREFIX vfct: <${VFCT}> PREFIX bookmark: <${BOOKMARK}> SELECT ?s ?p ?o WHERE { GRAPH ${historyGraph} {
    ${safe(historyId)} bookmark:recalls ${safe(root)} .
    ${safe(root)} (vfct:child|vfct:attribute)* ?s . ?s ?p ?o .
  } } LIMIT 10001`, ctx,signal,"QueryContextValidation:Data") as Row[];
  if (!dataRows.length || dataRows.length >=10001) throw new Error("History query RDF is empty or incomplete.");
  const data:Triple[]=dataRows.filter(row=>row.s?.value && row.p?.value && row.o?.value!==undefined).map(row=>({
    subject:row.s.value!, predicate:row.p.value!, object:row.o.value!, type:row.o.type??"literal",datatype:row.o.datatype,lang:row.o["xml:lang"] }));
  // Find standard SHACL Core targets for the QUERY root (not just result URIs).
  // This is separate from provider input shapes, which are evaluated *after*.
  const targetQuery=`PREFIX sh: <${SH}> PREFIX mui: <${MUI}> PREFIX vfct: <${VFCT}>
SELECT DISTINCT ?shape WHERE { GRAPH <${resolveGraph(GRAPH.SHACL_POLICIES, ctx.base)}> {
 ?shape a sh:NodeShape .
 FILTER NOT EXISTS { ?provider mui:accepts ?shape }
 FILTER(
   EXISTS { ?shape sh:targetNode ${safe(root)} } ||
   EXISTS { ?shape sh:targetClass vfct:query } ||
   EXISTS { ?shape sh:targetSubjectsOf ?p . GRAPH ${historyGraph} { ${safe(root)} ?p ?o } } ||
   EXISTS { ?shape sh:targetObjectsOf ?p . GRAPH ${historyGraph} { ?s ?p ${safe(root)} } }
 )
} } ORDER BY ?shape LIMIT 101`;
  const targets=await selectPersonal(targetQuery,ctx,signal,"QueryContextValidation:Targets");
  if(targets.length>=101) throw new Error("Too many query-context SHACL shapes; discovery incomplete.");
  if(!targets.length) throw new Error("No SHACL shape targets the current History query RDF. Seed the query-context shape.");
  const targetShapes=[...new Set(targets.map(target=>target.shape?.value??""))];
  if(targetShapes.some(shape=>!valid(shape)))throw new Error("Invalid query-context SHACL target.");
  const loadedShapes=await shapeRows(ctx,targetShapes,signal);
  const reports:ShaclValidationReport[]=[];
  for(const shape of targetShapes){signal.throwIfAborted();
    reports.push(await evaluate(shape,root,completeShape(loadedShapes,shape),data));}
  if(!reports.length) throw new Error("No usable query-context SHACL shapes were returned.");
  const report=mergeReports(reports);
  if(!report.conforms) return {historyId,queryRoot:root,report,queryProviders:[]};
  // Candidate providers may target the query structure. The ordinary result
  // population's sh:class/targetClass matching runs separately and is UNIONED
  // with this validated candidate set by discoverViews/discoverAnalyses.
  const providerRows=await selectPersonal(`PREFIX sh: <${SH}> PREFIX mui: <${MUI}> PREFIX vfct: <${VFCT}>
SELECT DISTINCT ?provider ?shape ?envelope WHERE { GRAPH <${resolveGraph(GRAPH.SHACL_POLICIES, ctx.base)}> {
 ?provider a mui:Provider ; mui:accepts ?shape .
 BIND(EXISTS { ?shape a mui:InputShape ; sh:property/sh:path ?contextPath . FILTER(?contextPath IN (mui:query, mui:focus)) } AS ?envelope)
 FILTER(?envelope ||
   EXISTS { ?shape sh:targetClass vfct:query } ||
   EXISTS { ?shape sh:class vfct:query } ||
   EXISTS { ?shape sh:targetNode ${safe(root)} } ||
   EXISTS { ?shape sh:targetSubjectsOf ?p . GRAPH ${historyGraph} { ${safe(root)} ?p ?o } } ||
   EXISTS { ?shape sh:targetObjectsOf ?p . GRAPH ${historyGraph} { ?s ?p ${safe(root)} } }
 )
} } LIMIT 101`,ctx,signal,"QueryContextValidation:Providers");
  if(providerRows.length>=101) throw new Error("More than 100 query-target providers; discovery incomplete.");
  const matches:string[]=[];
  const providerErrors:string[]=[];
  // The History RDF identifies the one actual view carrier. An input shape
  // declaring mui:query / mui:focus is evaluated against an ephemeral envelope,
  // not guessed from a provider URI. Nothing is written to the personal graph.
  const viewNodes = new Set(data.filter(t => t.predicate === `${RDF}type` && t.object === `${VFCT}view`).map(t => t.subject));
  const carriers = [...new Set(data.filter(t => t.predicate === `${VFCT}child` && viewNodes.has(t.object)).map(t => t.subject))];
  const envelope = `${root}/provider-input`;
  const contextData: Triple[] = [...data, {subject:envelope,predicate:`${MUI}query`,object:root,type:"uri"},
    ...carriers.map(object => ({subject:envelope,predicate:`${MUI}focus`,object,type:"uri"}))];
  const providerShapes=[...new Set(providerRows.map(row=>row.shape?.value??""))].filter(valid);
  const missing=providerShapes.filter(shape=>!loadedShapes.has(shape));
  for(const [shape,result] of await shapeRows(ctx,missing,signal))loadedShapes.set(shape,result);
  const outcomes = new Map<string,boolean>();
  // A provider with several applicable declared shapes must not pass because
  // only one of those shapes happened to conform. Fail closed on its errors.
  for(const row of providerRows){
    signal.throwIfAborted();
    const provider=row.provider?.value??"",shape=row.shape?.value??"";
    if(!valid(provider))continue;
    if(!valid(shape)){outcomes.set(provider,false);providerErrors.push(`${provider}: invalid SHACL shape identity.`);continue;}
    try {
      const shapeData=completeShape(loadedShapes,shape);
      const isEnvelope = ["true","1"].includes(row.envelope?.value ?? "");
      const check=await evaluate(shape,isEnvelope?envelope:root,shapeData,isEnvelope?contextData:data);
      outcomes.set(provider,(outcomes.get(provider)??true) && check.complete && check.conforms);
    } catch(error) {
      signal.throwIfAborted(); outcomes.set(provider,false);
      providerErrors.push(`${provider}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  for (const [provider,conforms] of outcomes) if (conforms) matches.push(provider);
  signal.throwIfAborted();
  if((await personalContext()).session!==ctx.session)throw new Error("Personal user session changed.");
  return {historyId,queryRoot:root,report,queryProviders:matches,providerErrors};
}
