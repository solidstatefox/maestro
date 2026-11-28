"use client";
import { fctProjectPage, type Projection, type ProjectedRecord } from "./fct-client";
import { validGraphServerUrl } from "./graph-server-directory";
import type { EndpointOption } from "@/canvas/top/appbar";

const DCAT = "http://www.w3.org/ns/dcat#";
const DCT = "http://purl.org/dc/terms/";
const SCHEMA = "https://schema.org/";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const RDFS_LABEL = "http://www.w3.org/2000/01/rdf-schema#label";
export type GraphServerPageItem = {uri:string; title:string};
export type GraphServerRow = {uri:string; title:string; endpoint:string; description:string; services:string[]; standards:string[]; datasets:string[]; datasetLabels:string[]; endpointId:string; group:string; likelySparql:boolean};
export type EndpointCandidate = {endpoint:string; title:string; services:string[]; standards:string[]; likelySparql:boolean; description?:string};
const projections: Projection[] = [RDF_TYPE, SCHEMA+"url", SCHEMA+"description", RDFS_LABEL,
  DCAT+"endpointURL", DCAT+"accessURL", DCT+"title", DCT+"description", DCT+"conformsTo", DCAT+"servesDataset"].map(property => ({property,direction:"forward"}));
const distinct = (items:string[]) => [...new Set(items.filter(Boolean))];
const normalized = (value:string) => validGraphServerUrl(value);
const configuredFor = (url:string, registry:readonly EndpointOption[]) => registry.find(option => normalized(option.url) === url);
function nativeRegistration(row:GraphServerPageItem, registry:readonly EndpointOption[]) {
  const exact = registry.find(option => option.url === row.uri || option.id === row.uri || row.uri.endsWith(`#endpoint-${encodeURIComponent(option.url)}`));
  if (exact) return exact;
  const labels=registry.filter(option=>option.label.trim().toLowerCase()===row.title.trim().toLowerCase());
  return labels.length===1 ? labels[0] : undefined;
}
/** All rows come from the current FCT page. DCAT metadata is mapped to the
 * existing schema:EntryPoint card contract, never a second result population.
 * A catalog resource URI is provenance, not the URL of a SPARQL server. */
export function normalizeGraphServerPage(page:readonly GraphServerPageItem[], records:readonly ProjectedRecord[], registry:readonly EndpointOption[], dcat:boolean):GraphServerRow[] {
  const byUri=new Map(records.map(record=>[record.uri,record]));
  const rows:GraphServerRow[]=[];
  for(const item of page) {
    const record=byUri.get(item.uri);
    const terms=(property:string)=>record?.properties.get(property)??[];
    const values=(property:string)=>terms(property).map(term=>term.value);
    const preferred=(property:string)=>{const all=terms(property).filter(term=>term.value.trim());return (all.find(term=>term.lang==='en'||term.lang?.startsWith('en-'))??all.find(term=>!term.lang)??all[0])?.value.trim()??'';};
    const types=values(RDF_TYPE);
    const dcatUrls=distinct([...values(DCAT+'endpointURL'),...values(DCAT+'accessURL')].map(value=>normalized(value)??''));
    const native=!dcat || types.includes(SCHEMA+'EntryPoint');
    const registration=native?nativeRegistration(item,registry):undefined;
    const assertedNativeUrls=distinct(values(SCHEMA+'url').map(value=>normalized(value)??''));
    const nativeUrls=native?(assertedNativeUrls.length?assertedNativeUrls:distinct([normalized(registration?.url??item.uri)??''])):[];
    const urls=distinct([...dcatUrls,...nativeUrls]);
    const title=preferred(DCT+'title')||preferred(RDFS_LABEL)||item.title;
    const description=preferred(DCT+'description')||preferred(SCHEMA+'description');
    const standards=distinct(values(DCT+'conformsTo'));
    const datasets=distinct(values(DCAT+'servesDataset'));
    // A service resource is a result row, not an endpoint identity. Keep its
    // page position even if another service has the exact same endpoint URL.
    // A service with several URLs uses the first asserted valid endpoint for
    // its server actions; no extra result cards are manufactured.
    const endpoint=urls[0]??'';
    const option=endpoint?configuredFor(endpoint,registry):undefined;
    rows.push({uri:item.uri,title:dcat?title||option?.label||endpoint||item.uri:option?.label||title||endpoint||item.uri,endpoint,description,
      services:[item.uri],standards,datasets,datasetLabels:[],endpointId:option?.id??'',group:option?.group??'',
      likelySparql:Boolean(endpoint)&&(native||/sparql/i.test(endpoint)||standards.some(value=>/sparql/i.test(value)))});
  }
  return rows;
}
/** The active server is the sole deliberate presentation addition. If a page
 * already describes it, promote that row without removing any sibling rows. */
export function prependSelectedGraphServer(rows:readonly GraphServerRow[],selected:EndpointOption|undefined):GraphServerRow[] {
  const endpoint=selected&&normalized(selected.url);
  if(!selected||!endpoint)return [...rows];
  const index=rows.findIndex(row=>row.endpoint===endpoint);
  if(index>=0)return [{...rows[index],endpointId:selected.id,group:selected.group},...rows.slice(0,index),...rows.slice(index+1)];
  return [{uri:`urn:maestro:current-graph-server:${encodeURIComponent(endpoint)}`,title:selected.label||endpoint,endpoint,
    description:'',services:[],standards:[],datasets:[],datasetLabels:[],endpointId:selected.id,group:selected.group,likelySparql:true},...rows];
}
const datasetLabelProjections:Projection[]=[DCT+'title',RDFS_LABEL].map(property=>({property,direction:'forward'}));
const visibleDatasetLimit=3;
function datasetFallback(uri:string):string {
  if(uri.length<=64)return uri;
  try {const url=new URL(uri);return `${url.hostname}/…/${uri.slice(-32)}`;}catch{return `${uri.slice(0,30)}…${uri.slice(-24)}`;}
}
export function compactDatasetLabels(row:GraphServerRow):string {
  const labels=(row.datasetLabels.length?row.datasetLabels:row.datasets.slice(0,visibleDatasetLimit).map(datasetFallback)).map(label=>label.length>150?`${label.slice(0,149)}…`:label);
  const more=row.datasets.length-labels.length;
  return labels.join(' · ')+(more>0?` · +${more} more`: '');
}

/** Only DCAT-capable populations require additional FCT projection. Ordinary
 * EntryPoint cards keep their existing registry lookup and zero extra reads. */
export async function projectGraphServerPage(liveXml:string,page:readonly GraphServerPageItem[],registry:readonly EndpointOption[],dcat:boolean,signal:AbortSignal):Promise<GraphServerRow[]> {
  const records=dcat?await fctProjectPage(liveXml,page.map(row=>row.uri),projections,signal,false,false,{tab:"view",ribbon:"perspectives:gttp://ggg.maestro.ecosys/shacl/provider/entrypoint"}):[];
  signal.throwIfAborted();
  const rows=normalizeGraphServerPage(page,records,registry,dcat);
  // Only label dataset IRIs reached from this page, with an exact URI join.
  // Do not use a global catalog query or associate multivalued titles by order.
  const datasets=distinct(rows.flatMap(row=>row.datasets.slice(0,visibleDatasetLimit)));
  if(datasets.length){
    let labels:ProjectedRecord[]=[];
    try {labels=await fctProjectPage(liveXml,datasets,datasetLabelProjections,signal,false,false,{tab:"view",ribbon:"perspectives:gttp://ggg.maestro.ecosys/shacl/provider/entrypoint"});}
    catch {signal.throwIfAborted(); /* Optional label enrichment: keep the page. */}
    const byUri=new Map(labels.map(record=>[record.uri,record]));
    for(const row of rows)row.datasetLabels=row.datasets.slice(0,visibleDatasetLimit).map(uri=>{
      const record=byUri.get(uri);
      for(const property of [DCT+'title',RDFS_LABEL]){
        const terms=(record?.properties.get(property)??[]).filter(term=>term.value.trim()&&term.type!=='uri');
        const title=(terms.find(term=>term.lang==='en'||term.lang?.startsWith('en-'))??terms.find(term=>!term.lang)??terms[0])?.value.trim();
        if(title)return title;
      }
      return datasetFallback(uri);
    });
  }
  signal.throwIfAborted();
  return rows;
}
