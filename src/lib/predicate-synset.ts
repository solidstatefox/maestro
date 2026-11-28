import type { SparqlBindingTerm, SparqlJsonResults } from "./fct-sparql-translator";
import { virtuosoAnalyticsCapabilities } from "./overview-node-metrics";

export const SYNSET_VERSION_QUERY = `PREFIX bif: <bif:>\nSELECT (bif:sys_stat('st_dbms_name') AS ?product) (bif:sys_stat('st_dbms_ver') AS ?version) WHERE {} LIMIT 1`;
/** Small, data-independent witness for the nested grouped joins, UNION,
 * distinct projections, arithmetic and canonical body keys used by RuleAlign. */
export const SYNSET_BI_PROBE = `SELECT (COUNT(*) AS ?n) WHERE {
  { SELECT ?key (COUNT(*) AS ?support) WHERE {
      { SELECT DISTINCT ?key ?x WHERE {
          { VALUES ?x { 1 2 } BIND(CONCAT("f:", ENCODE_FOR_URI("urn:p")) AS ?key) }
          UNION { VALUES ?x { 2 } BIND(CONCAT("f:", ENCODE_FOR_URI("urn:p")) AS ?key) }
      } }
    } GROUP BY ?key }
  { SELECT ?key (COUNT(*) AS ?body) WHERE { VALUES ?x { 1 2 } BIND(CONCAT("f:", ENCODE_FOR_URI("urn:p")) AS ?key) } GROUP BY ?key }
  FILTER(<http://www.w3.org/2001/XMLSchema#double>(?support) / ?body = 1)
}`;
export type SynsetCapability = { product: string; version: string; rulealign: boolean; reason: string };
export type SynsetRead = (query: string) => Promise<SparqlJsonResults>;
export type SynsetProbeCache = { get: (key: string) => boolean | undefined; set: (key: string, value: boolean) => void };
export async function probeRuleAlignCapability(read: SynsetRead, signal: AbortSignal, cache?: SynsetProbeCache, propagateReadError = false): Promise<SynsetCapability> {
  let product = "", version = "";
  let readFailed = false;
  const readProbe = async (query: string) => {
    try { return await read(query); }
    catch (error) { readFailed = true; throw error; }
  };
  try {
    const rows = (await readProbe(SYNSET_VERSION_QUERY)).results?.bindings;
    signal.throwIfAborted();
    if (rows?.length !== 1) throw new Error("Invalid graph server version response.");
    product = rows[0].product?.value ?? ""; version = rows[0].version?.value ?? "";
    const capability = virtuosoAnalyticsCapabilities(product, version);
    if (!capability.bi) return {product,version,rulealign:false,reason:capability.reason};
    const key = JSON.stringify([product,version]);
    if (cache?.get(key) === true) return {product,version,rulealign:true,reason:"Verified SPARQL-BI."};
    const witness = (await readProbe(SYNSET_BI_PROBE)).results?.bindings;
    signal.throwIfAborted();
    if (witness?.length !== 1 || synsetCount(witness[0].n,"BI witness") !== 1) throw new Error("SPARQL-BI probe did not return its expected result.");
    cache?.set(key, true);
    return {product,version,rulealign:true,reason:"Verified SPARQL-BI."};
  } catch (error) {
    signal.throwIfAborted();
    if (propagateReadError && readFailed) throw error;
    return {product,version,rulealign:false,reason:error instanceof Error ? error.message : String(error)};
  }
}

export function synsetCount(term: SparqlBindingTerm | undefined, name: string): number {
  if (!term || term.type !== "literal" && term.type !== "typed-literal" || !/^\d+$/.test(term.value)) throw new Error(`Invalid synset ${name}.`);
  const n = Number(term.value);
  if (!Number.isSafeInteger(n)) throw new Error(`Unsafe synset ${name}.`);
  return n;
}

/** Zhang et al., DOI 10.3233/SW-150193, equations 9–12. Only aggregate
 * counts enter this function, never RDF instances. The logistic parameter
 * is explicit in the FCT plan. No threshold or clustering is inferred. */
export function relationAgreement(counts: { reference: number; candidate: number; common: number; subjectsUnion: number; agreeingSubjects: number }, n = 15): number {
  const {reference,candidate,common,subjectsUnion,agreeingSubjects}=counts;
  if (![reference,candidate,common,subjectsUnion,agreeingSubjects].every(x=>Number.isSafeInteger(x)&&x>=0) ||
    common > Math.min(reference,candidate) || agreeingSubjects > Math.min(common,subjectsUnion) ||
    subjectsUnion > reference+candidate || !Number.isFinite(n) || n<=0 ||
    common>0 && (!agreeingSubjects || !subjectsUnion)) throw new Error("Inconsistent relation agreement statistics.");
  if (!common) return 0;
  const kc=(t:number)=>1/(1+Math.exp(n/2-t));
  const ta=Math.max(common/reference*kc(reference),common/candidate*kc(candidate));
  const sa=agreeingSubjects/subjectsUnion*kc(common);
  return (ta+sa)/2;
}

export function readSynsetRows(rows: Record<string,SparqlBindingTerm>[], carrier:string, algorithm:"relation-agreement"|"rulealign", maxCandidates:number, confidenceN:number) {
  if (rows.length>maxCandidates) throw new Error(`Property synset exceeds the configured ${maxCandidates} candidate ceiling.`);
  const seen=new Set<string>();
  return rows.map(row=>{
    const p=row.c1;
    if (!p || p.type!=="uri" || !p.value || p.value===carrier || seen.has(p.value)) throw new Error("Invalid or duplicate synset predicate.");
    seen.add(p.value);
    const score=algorithm==="relation-agreement" ? relationAgreement({reference:synsetCount(row.reference,"reference count"),candidate:synsetCount(row.candidate,"candidate count"),common:synsetCount(row.common,"common count"),subjectsUnion:synsetCount(row.subjectsUnion,"subject union"),agreeingSubjects:synsetCount(row.agreeingSubjects,"agreeing subjects")},confidenceN) :
      row.similarity && (row.similarity.type==="literal" || row.similarity.type==="typed-literal") && row.similarity.value.trim() ? Number(row.similarity.value) : NaN;
    if (!Number.isFinite(score) || score<=0 || score>1) throw new Error("Invalid synset similarity score.");
    return {c1:p,similarity:{type:"literal",value:String(score),datatype:"http://www.w3.org/2001/XMLSchema#double"} satisfies SparqlBindingTerm};
  }).sort((a,b)=>Number(b.similarity.value)-Number(a.similarity.value)||(a.c1.value<b.c1.value?-1:a.c1.value>b.c1.value?1:0));
}
