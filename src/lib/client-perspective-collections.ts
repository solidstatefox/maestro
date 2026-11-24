"use client";
import { GRAPH, resolveGraph } from "@/lib/constants/graphs";

import { personalContext, selectPersonal } from "@/lib/client-personal-sparql";
import { readClientPolicyApprovals } from "@/lib/client-policy-approvals";
import { PERSONAL_PERSPECTIVE_URI } from "@/lib/personal-perspective-ids";

const MUI = "gttp://ggg.maestro.ecosys/ns/ui#";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const DCT = "http://purl.org/dc/terms/";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const VFCT = "https://vos.openlinksw.com/owiki/wiki/VOS/VirtFacetBrowserAPIs#";
const BOOKMARK = "http://www.w3.org/2002/01/bookmark#";
const iri = (value:string) => /^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(value) && value.length <= 2048;
export type PerspectiveCollection = {provider:{uri:string;kind:"bookmarks"|"history";label:string;template:string;stylesheet:string;target:string};rows:Array<{uri:string;label:string;created:string;description:string;url:string;queryXml:string;tags:string[];tagPredicates:string[];lastResultCount:number|null;lastNewCount:number|null}>};

/** Reads metadata and collection RDF via the authenticated SPARQL transport.
 * This only controls client presentation: actual provider execution remains
 * subject to the server's independent approval gates. */
export async function loadPerspectiveCollection(kind:"bookmarks"|"history", providerUri:string, signal?:AbortSignal):Promise<PerspectiveCollection> {
  const ctx = await personalContext();
  const graph = `${resolveGraph(GRAPH.SHACL_POLICIES, ctx.base)}`;
  if (providerUri !== PERSONAL_PERSPECTIVE_URI[kind] || !iri(providerUri)) throw new Error("Perspective provider does not match the requested collection.");
  const definitions = await selectPersonal(`PREFIX mui: <${MUI}> PREFIX rdf: <${RDF}> PREFIX rdfs: <${RDFS}>
    SELECT DISTINCT ?provider ?kind ?label ?template ?stylesheet ?target WHERE {
      GRAPH <${graph}> {
        ?provider a mui:Provider ; mui:perspectiveKind ?kind ; mui:widget ?template .
        ?template a mui:PerspectiveWidget ; (mui:templateContent|rdf:value) ?stylesheet .
        OPTIONAL { ?provider rdfs:label ?label }
        FILTER(?provider = <${providerUri}>)
        FILTER(STR(?kind) = ${JSON.stringify(kind)})
      }
    } ORDER BY ?label LIMIT 20`,ctx,signal,"client-perspective-collections:loadPerspectiveCollection");
  const providers = definitions.flatMap(row=>{
    const uri=row.provider?.value??"", template=row.template?.value??"", stylesheet=row.stylesheet?.value??"";
    return uri===providerUri&&row.kind?.value===kind&&iri(template)&&stylesheet.length>0&&stylesheet.length<=250000 ? [{uri,kind,label:row.label?.value||kind,template,stylesheet,target:row.target?.value||""}] : [];
  });
  const statuses = await readClientPolicyApprovals(providers.map(p=>p.uri),signal);
  const approved = new Set(statuses.filter(s=>s.status==="Approved").map(s=>s.uri));
  const provider=providers.find(p=>approved.has(p.uri));
  if (!provider) throw new Error("No Approved provider registered for this perspective.");
  const bookmarkGraph = `${resolveGraph(GRAPH.BOOKMARKS, ctx.base)}`, historyGraph = `${resolveGraph(GRAPH.HISTORY, ctx.base)}`;
  const q = kind === "bookmarks" ? `PREFIX b: <${BOOKMARK}> PREFIX dcterms: <${DCT}> PREFIX rdfs: <${RDFS}> PREFIX schema: <https://schema.org/> PREFIX vfct: <${VFCT}>
SELECT ?entry ?label ?created ?description ?url ?queryXML ?tag ?tagPredicate ?lastResultCount ?lastNewCount WHERE { GRAPH <${bookmarkGraph}> {
 ?entry a b:Bookmark . OPTIONAL { ?entry dcterms:title ?title } OPTIONAL { ?entry rdfs:label ?rlabel }
 BIND(COALESCE(?title,?rlabel,STR(?entry)) AS ?label)
 OPTIONAL { ?entry dcterms:created ?created } OPTIONAL { ?entry dcterms:description ?description }
 OPTIONAL { ?entry schema:url ?url } OPTIONAL { ?entry vfct:historyQueryXML ?queryXML }
 OPTIONAL { ?entry ?tagPredicate ?tag . VALUES ?tagPredicate { <http://www.w3.org/2004/02/skos/core#prefLabel> <${DCT}subject> <http://rdfs.org/scot/ns#has_tag> } }
 OPTIONAL { ?entry <${MUI}lastResultCount> ?lastResultCount }
 OPTIONAL { ?entry <${MUI}lastNewCount> ?lastNewCount }
} } ORDER BY DESC(?created) ?entry ?tagPredicate ?tag __PAGINATION__` : `PREFIX vfct: <${VFCT}> PREFIX dcterms: <${DCT}> PREFIX rdfs: <${RDFS}>
SELECT ?entry ?label ?created ?url ?queryXML ?lastResultCount ?lastNewCount WHERE { GRAPH <${historyGraph}> {
 ?entry a vfct:QueryHistoryVisit ; vfct:historyCreated ?created .
 OPTIONAL { ?entry dcterms:title ?title } OPTIONAL { ?entry rdfs:label ?rlabel }
 BIND(COALESCE(?title,?rlabel,STR(?entry)) AS ?label)
 OPTIONAL { ?entry vfct:historyStateUrl ?url } OPTIONAL { ?entry vfct:historyQueryXML ?queryXML }
 OPTIONAL { ?entry <${MUI}lastResultCount> ?lastResultCount }
 OPTIONAL { ?entry <${MUI}lastNewCount> ?lastNewCount }
} } ORDER BY DESC(?created) ?entry __PAGINATION__`;
  const byUri=new Map<string,PerspectiveCollection["rows"][number]>();
  const numeric=(value:string):number|null=>/^\d+$/.test(value)&&Number.isSafeInteger(Number(value))?Number(value):null;
  // History and Bookmarks are both paged at the ODS transport. Do not stop at
  // the old 500-row cutoff: search/FCT scope and UI pagination must operate on
  // complete collections, not an arbitrarily truncated first page. Stable
  // ordering keeps joined bookmark tags contiguous across page boundaries.
  const batchSize = 500, maxResultRows = 25_000;
  let complete = false;
  for (let offset = 0; offset < maxResultRows; offset += batchSize) {
    const result = await selectPersonal(q.replace("__PAGINATION__", `LIMIT ${batchSize} OFFSET ${offset}`),ctx,signal,"client-perspective-collections:loadPerspectiveCollection");
    for(const row of result){
      const uri=row.entry?.value??"";if(!iri(uri))continue;
      let item=byUri.get(uri);
      if(!item){item={uri,label:row.label?.value??"",created:row.created?.value??"",description:row.description?.value??"",url:row.url?.value??"",queryXml:row.queryXML?.value??"",tags:[],tagPredicates:[],lastResultCount:numeric(row.lastResultCount?.value??""),lastNewCount:numeric(row.lastNewCount?.value??"")};byUri.set(uri,item);}
      const tag=row.tag?.value??"", predicate=row.tagPredicate?.value??"";
      if(tag&&!item.tags.includes(tag))item.tags.push(tag);
      if(predicate&&!item.tagPredicates.includes(predicate))item.tagPredicates.push(predicate);
    }
    if (result.length < batchSize) { complete = true; break; }
  }
  if (!complete) throw new Error(`Personal ${kind} collection exceeded the 25,000-result-row safety cap. Narrow the saved collection before displaying it; partial results are not shown.`);
  return {provider,rows:[...byUri.values()]};
}
