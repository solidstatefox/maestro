"use client";
import { fctProjectPage, type Projection } from "@/lib/fct-client";
import { PERSONAL_PERSPECTIVE_URI } from "@/lib/personal-perspective-ids";
import type { DiscoveredViewProvider } from "@/lib/personal-sparql-reads";

const MUI = "gttp://ggg.maestro.ecosys/ns/ui#";
const DCT = "http://purl.org/dc/terms/";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const VFCT = "https://vos.openlinksw.com/owiki/wiki/VOS/VirtFacetBrowserAPIs#";
const TAGS = ["http://www.w3.org/2004/02/skos/core#prefLabel", DCT+"subject", "http://rdfs.org/scot/ns#has_tag"];
export type PerspectiveCollection = {provider:{uri:string;kind:"bookmarks"|"history";label:string;template:string;stylesheet:string;target:string};rows:Array<{uri:string;label:string;created:string;description:string;url:string;queryXml:string;tags:string[];tagPredicates:string[];lastResultCount:number|null;lastNewCount:number|null}>};


/** Provider is already approved and population-matched by Perspective discovery.
 * Membership and order come from the committed Results page, with pinned Bookmark identities prepended. */
export async function loadPerspectiveCollection(kind:"bookmarks"|"history", provider:DiscoveredViewProvider, queryXml:string,
  page:readonly {uri:string;title:string}[], signal?:AbortSignal, pinned:readonly {uri:string;title:string}[] = []):Promise<PerspectiveCollection> {
  if (provider.uri !== PERSONAL_PERSPECTIVE_URI[kind] || !provider.stylesheet) throw new Error("Perspective provider does not match the requested collection.");
  const created = kind === "bookmarks" ? DCT+"created" : VFCT+"historyCreated";
  const url = kind === "bookmarks" ? "https://schema.org/url" : VFCT+"historyStateUrl";
  const columns:Projection[] = [DCT+"title",RDFS+"label",created,DCT+"description",url,VFCT+"historyQueryXML",MUI+"lastResultCount",MUI+"lastNewCount",...TAGS].map(property=>({property,direction:"forward"}));
  const candidates = kind === "bookmarks" ? pinned : [];
  const all = [...new Map([...candidates,...page].map(row=>[row.uri,row])).values()];
  const typeProperty = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
  const records = await fctProjectPage(queryXml,all.map(row=>row.uri),[...columns,{property:typeProperty,direction:"forward"}],signal,false,kind === "bookmarks");
  signal?.throwIfAborted();
  const byUri = new Map(records.map(record=>[record.uri,record]));
  const numeric=(value:string):number|null=>/^\d+$/.test(value)&&Number.isSafeInteger(Number(value))?Number(value):null;
  const pageIds = new Set(page.map(row=>row.uri));
  const rows=all.filter(row=>pageIds.has(row.uri) || byUri.get(row.uri)?.properties.get(typeProperty)?.some(term=>term.value==="http://www.w3.org/2002/01/bookmark#Bookmark")).map(row=>{
    const record=byUri.get(row.uri);
    const first=(property:string)=>record?.properties.get(property)?.[0]?.value ?? "";
    const tags=TAGS.flatMap(property=>record?.properties.get(property)?.map(term=>term.value)??[]);
    return {uri:row.uri,label:first(DCT+"title")||first(RDFS+"label")||row.title,created:first(created),description:first(DCT+"description"),url:first(url),queryXml:first(VFCT+"historyQueryXML"),tags:[...new Set(tags)],tagPredicates:TAGS.filter(property=>record?.properties.get(property)?.length),lastResultCount:numeric(first(MUI+"lastResultCount")),lastNewCount:numeric(first(MUI+"lastNewCount"))};
  });
  return {provider:{uri:provider.uri,kind,label:provider.label,template:provider.template,stylesheet:provider.stylesheet,target:provider.matchedClass},rows};
}
