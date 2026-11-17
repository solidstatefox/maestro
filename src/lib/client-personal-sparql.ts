"use client";
/** Personal RDF reads and updates are constructed in the SPA.  The existing
 * /proxy/api/sparql HTTP middleware forwards SPARQL to Virtuoso. */
import { graphForPrefix, loadPersonalAuthSession, type PersonalAuthSession } from "@/lib/personal-auth";
export type PersonalRows = Array<Record<string, {type?:string;value?:string;datatype?:string}>>;
export type PersonalContext = {session:PersonalAuthSession;base:string;addr:string};
export async function personalContext():Promise<PersonalContext> {
  const session = await loadPersonalAuthSession();
  if(!session?.graphStore||!session.graphPrefix||!session.authHeader)
    throw new Error("Log in to use the personal graph server.");
  const base=graphForPrefix(session.graphPrefix);
  const endpoint=session.graphStore.replace(/\/sparql-auth\/?$/i,"/sparql");
  return {session,base,addr:`${base}@${endpoint}`};
}
async function perform(input:{query?:string;update?:string;addr?:string;bookmarkQueryXml?:string},signal?:AbortSignal):Promise<Record<string,unknown>> {
  const ctx=await personalContext();
  const response=await fetch("/proxy/api/sparql",{
    method:"POST",cache:"no-store",credentials:"same-origin",signal,
    headers:{"Content-Type":"application/json","Accept":"application/json"},
    body:JSON.stringify({...input,addr:input.addr??ctx.addr}),
  });
  const raw=await response.text();let data:Record<string,unknown>={};
  if(raw){try{data=JSON.parse(raw) as Record<string,unknown>;}catch{
    if(!response.ok)throw new Error(`Personal SPARQL returned HTTP ${response.status}: ${raw.slice(0,500)}`);
    throw new Error("Personal SPARQL returned invalid JSON.");
  }}
  if(!response.ok)throw new Error(typeof data.error==="string"?data.error:`Personal SPARQL HTTP ${response.status}`);
  if(data.incomplete===true)throw new Error("Personal SPARQL query returned an incomplete result.");
  return data;
}
export async function selectPersonal(query:string,ctx:PersonalContext,signal?:AbortSignal):Promise<PersonalRows>{
  if(!query||query.length>100_000)throw new Error("Invalid personal SPARQL SELECT length.");
  const data=await perform({addr:ctx.addr,query},signal);
  if(!Array.isArray((data.results as {bindings?:unknown}|undefined)?.bindings))
    throw new Error("Personal SPARQL did not return SELECT bindings.");
  return (data.results as {bindings:PersonalRows}).bindings;
}
export async function updatePersonal(update:string,signal?:AbortSignal,bookmarkQueryXml?:string):Promise<void>{
  const max=/^INSERT\s+DATA\s*\{/i.test(update.trim())?2_000_000:100_000;
  if(!update||update.length>max)throw new Error("Invalid personal SPARQL update length.");
  await perform({update,...(bookmarkQueryXml?{bookmarkQueryXml}:{})},signal);
}
export async function personalExists(pattern:string,ctx:PersonalContext,signal?:AbortSignal):Promise<boolean>{
  const rows=await selectPersonal(`SELECT ?match WHERE { ${pattern} BIND(true AS ?match) } LIMIT 1`,ctx,signal);
  return rows.length>0;
}
