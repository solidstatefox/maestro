"use client";
/** Personal RDF reads and updates are constructed in the SPA.  The existing
 * /proxy/api/sparql HTTP middleware forwards SPARQL to Virtuoso. */
import { graphForPrefix, personalWriteEndpoint, loadPersonalAuthSession, type PersonalAuthSession } from "@/lib/personal-auth";
import { describeUpstreamError, sanitizeUpstreamDiagnostic } from "@/lib/upstream-error";
import { personalRequestHeaders } from "@/lib/client-personal-request";
import { maestroQueryFetch } from "@/lib/client-query-cache";
/** Personal-store transport observations update the existing graph-server dropdown.
 * No credentials, query text, or response body is broadcast. */
export const PERSONAL_SPARQL_HEALTH_EVENT = "maestro:personal-sparql-health";
export function signalPersonalHealth(addr:string, status:number):void {
  if(typeof window === "undefined")return;
  const separator=addr.lastIndexOf("@");
  const endpointUrl=separator>=0 ? addr.slice(separator+1) : "";
  if(!/^https?:\/\//i.test(endpointUrl))return;
  window.dispatchEvent(new CustomEvent(PERSONAL_SPARQL_HEALTH_EVENT,{detail:{endpointUrl,status}}));
}
export type PersonalRows = Array<Record<string, {type?:string;value?:string;datatype?:string}>>;
export type PersonalContext = {session:PersonalAuthSession;base:string;addr:string};
export async function personalContext():Promise<PersonalContext> {
  const session = await loadPersonalAuthSession();
  if(!session?.graphStore||!session.graphPrefix||!session.authHeader)
    throw new Error("Log in to use the personal graph server.");
  const base=graphForPrefix(session.graphPrefix);
  const endpoint=personalWriteEndpoint(session);
  return {session,base,addr:`${base}@${endpoint}`};
}
async function perform(input:{query?:string;update?:string;addr?:string;bookmarkQueryXml?:string;personalRead?:boolean},signal?:AbortSignal, requestSource?:string):Promise<Record<string,unknown>> {
  const ctx=await personalContext();
  const address=input.addr??ctx.addr;
  const response=await maestroQueryFetch("/proxy/api/sparql",{
    method:"POST",cache:"no-store",credentials:"same-origin",signal,
    headers:{"Content-Type":"application/json","Accept":"application/json", ...personalRequestHeaders(ctx.session),
      ...(requestSource ? {"x-maestro-debug-source":requestSource.startsWith("urn:") ? requestSource : `urn:maestro:component:${requestSource}`,"x-maestro-debug-component":requestSource} : {})},
    body:JSON.stringify({...input,addr:input.addr??ctx.addr}),
  });
  // A successful personal SELECT/UPDATE is fresh evidence of availability;
  // a gateway 5xx contradicts a previously green probe. Ordinary query
  // errors (4xx) do not imply the endpoint itself is unavailable.
  if(response.ok || response.status>=500)signalPersonalHealth(address,response.status);
  const raw=await response.text();let data:Record<string,unknown>={};
  if(raw){try{data=JSON.parse(raw) as Record<string,unknown>;}catch(error){
    // Preserve ODS account-authentication behavior (401 is a separate issue).
    if(response.status===401)throw new Error(`Personal SPARQL returned HTTP ${response.status}: ${raw.slice(0,500)}`);
    const upstream = sanitizeUpstreamDiagnostic(raw);
    if(!response.ok)throw new Error(`Personal SPARQL returned HTTP ${response.status} ${response.statusText}: ${upstream} (JSON parse: ${describeUpstreamError(error)})`, {cause:error});
    throw new Error(`Personal SPARQL returned invalid JSON: ${describeUpstreamError(error)}; upstream body: ${upstream}`, {cause:error});
  }}
  if(!response.ok) {
    if(response.status===401)throw new Error(typeof data.error==="string"?data.error:`Personal SPARQL HTTP ${response.status}`);
    const upstream = typeof data.error==="string" ? data.error : typeof data.message==="string" ? data.message : raw;
    throw new Error(`Personal SPARQL returned HTTP ${response.status} ${response.statusText}: ${sanitizeUpstreamDiagnostic(upstream)}`);
  }
  if(data.incomplete===true)throw new Error("Personal SPARQL query returned an incomplete result.");
  return data;
}
export async function selectPersonal(query:string,ctx:PersonalContext,signal?:AbortSignal, requestSource?:string):Promise<PersonalRows>{
  if(!query||query.length>100_000)throw new Error("Invalid personal SPARQL SELECT length.");
  // Explicitly select the authenticated personal READ transport. Generic
  // graph-server queries do not carry a login's Authorization header.
  const data=await perform({addr:ctx.addr,query,personalRead:true},signal,requestSource);
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
