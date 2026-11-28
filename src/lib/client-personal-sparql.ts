"use client";
/** Personal RDF reads and updates are constructed in the SPA.  The existing
 * /proxy/api/sparql HTTP middleware forwards SPARQL to Virtuoso. */
import { graphForPrefix, personalWriteEndpoint, loadPersonalAuthSession, type PersonalAuthSession } from "@/lib/personal-auth";
import { observeProxyFetch, observedUpstreamStatus } from "./proxy-transport-observation";
import { describeUpstreamError, sanitizeUpstreamDiagnostic } from "@/lib/upstream-error";
import { personalAuthenticatedFetch } from "@/lib/client-personal-request";
import { GRAPH, resolveGraph } from "@/lib/constants/graphs";
import { inspectPersonalUpdateGraphs } from "@/lib/personal-update-graph-guard";
import type { MaestroQueryScope } from "./app-lifecycle/query-view-ownership";
import { maestroQueryFetch } from "@/lib/client-query-cache";
/** Personal-store transport observations update the existing graph-server dropdown.
 * No credentials, query text, or response body is broadcast. */
export { PERSONAL_SPARQL_HEALTH_EVENT, signalPersonalHealth } from "./personal-sparql-health";
export type PersonalRows = Array<Record<string, {type?:string;value?:string;datatype?:string}>>;
export type PersonalContext = {session:PersonalAuthSession;base:string;addr:string};
/** Explicit caller authority. Initialization is owned by the session XState
 * actor, not a foreground Browse/View/Analyze query. It must carry that
 * actor's cancellation signal and may not borrow a view token. */
export type PersonalTransportAuthority = "view" | "personal-initialization";
export async function personalContext():Promise<PersonalContext> {
  const session = await loadPersonalAuthSession();
  if(!session?.graphStore||!session.graphPrefix)
    throw new Error("Log in to use the personal graph server.");
  const base=graphForPrefix(session.graphPrefix);
  const endpoint=personalWriteEndpoint(session);
  return {session,base,addr:`${base}@${endpoint}`};
}
async function perform(input:{query?:string;update?:string;addr?:string;bookmarkQueryXml?:string;personalRead?:boolean;personalWrite?:boolean},signal:AbortSignal|undefined, requestSource:string, expectedSession?:PersonalAuthSession, authority:PersonalTransportAuthority="view", scope?: MaestroQueryScope):Promise<Record<string,unknown>> {
  if (authority === "personal-initialization") {
    if (!signal) throw new Error("Personal initialization requires its XState cancellation signal.");
    signal.throwIfAborted();
  }
  const ctx=await personalContext();
  if(expectedSession && ctx.session!==expectedSession)throw new Error("Personal user session changed.");
  const address=input.addr??ctx.addr;
  const response=await personalAuthenticatedFetch(ctx.session,"/proxy/api/sparql",{
    method:"POST",cache:"no-store",credentials:"same-origin",signal,
    headers:{"Content-Type":"application/json","Accept":"application/json",
      ...(scope ? {"x-maestro-view-tab":scope.tab,"x-maestro-view-ribbon":scope.ribbon} : {}),
      ...{"x-maestro-debug-source":requestSource.startsWith("urn:") ? requestSource : `urn:maestro:component:${requestSource}`,"x-maestro-debug-component":requestSource}},
    body:JSON.stringify({...input,addr:input.addr??ctx.addr}),
  },authority === "personal-initialization" || requestSource.includes("graph-server-status-history") ? observeProxyFetch : maestroQueryFetch);
  // A successful personal SELECT/UPDATE is fresh evidence of availability;
  // a gateway 5xx contradicts a previously green probe. Ordinary query
  // errors (4xx) do not imply the endpoint itself is unavailable.
  const upstreamStatus=observedUpstreamStatus(response);
  // The shared authenticated transport emits canonical health evidence.
  const upstreamTransport=response.headers.get("X-Maestro-Failure-Origin")==="upstream-transport";
  const origin=upstreamTransport ? "Personal SPARQL transport" : upstreamStatus===null ? "Maestro proxy" : "Personal SPARQL";
  const raw=await response.text();let data:Record<string,unknown>={};
  if(raw){try{data=JSON.parse(raw) as Record<string,unknown>;}catch(error){
    // Preserve ODS account-authentication behavior (401 is a separate issue).
    if(response.status===401)throw new Error(`${origin} returned HTTP ${response.status}: ${sanitizeUpstreamDiagnostic(raw, Infinity)}`);
    const upstream = sanitizeUpstreamDiagnostic(raw, Infinity);
    if(!response.ok)throw new Error(`${origin} returned HTTP ${response.status} ${response.statusText}: ${upstream} (JSON parse: ${describeUpstreamError(error)})`, {cause:error});
    throw new Error(`${origin} returned invalid JSON: ${describeUpstreamError(error)}; upstream body: ${upstream}`, {cause:error});
  }}
  if(!response.ok) {
    if(response.status===401)throw new Error(typeof data.error==="string"?data.error:`${origin} HTTP ${response.status}`);
    const upstream = [typeof data.error==="string" ? data.error : typeof data.message==="string" ? data.message : raw, typeof data.details==="string" ? data.details : ""].filter(Boolean).join("\n\n");
    throw new Error(`${origin} returned HTTP ${response.status} ${response.statusText}: ${sanitizeUpstreamDiagnostic(upstream, Infinity)}`);
  }
  if(data.incomplete===true||response.headers.get("X-Maestro-Incomplete")==="true")throw new Error("Personal SPARQL query returned an incomplete result.");
  return data;
}
export async function selectPersonal(query:string,ctx:PersonalContext,signal:AbortSignal|undefined, requestSource:string,authority:PersonalTransportAuthority="view", scope?: MaestroQueryScope):Promise<PersonalRows>{
  if(!query||query.length>100_000)throw new Error("Invalid personal SPARQL SELECT length.");
  // Explicitly select the authenticated personal READ transport. Generic
  // graph-server queries do not carry a login's Authorization header.
  const data=await perform({addr:ctx.addr,query,personalRead:true},signal,requestSource,ctx.session,authority,scope);
  if(!Array.isArray((data.results as {bindings?:unknown}|undefined)?.bindings))
    throw new Error("Personal SPARQL did not return SELECT bindings.");
  return (data.results as {bindings:PersonalRows}).bindings;
}
export async function updatePersonal(update:string,signal:AbortSignal|undefined,bookmarkQueryXml:string|undefined,requestSource:string,expectedSession?:PersonalAuthSession,authority:PersonalTransportAuthority="view",scope?:MaestroQueryScope):Promise<void>{
  const max=/^INSERT\s+DATA\s*\{/i.test(update.trim())?2_000_000:100_000;
  if(!update||update.length>max)throw new Error("Invalid personal SPARQL update length.");
  const ctx=await personalContext();
  if(expectedSession && ctx.session!==expectedSession)throw new Error("Personal user session changed.");
  const graphs=inspectPersonalUpdateGraphs(update).graphs;
  if(graphs.includes(resolveGraph(GRAPH.STATUS,ctx.base))){
    const {isClientQueryBookmarked}=await import("@/lib/client-provider-provenance");
    if(!bookmarkQueryXml || !await isClientQueryBookmarked(bookmarkQueryXml,signal))throw new Error("Bookmark the live FCT query before modifying Status.");
  }
  signal?.throwIfAborted();
  if((await personalContext()).session!==ctx.session)throw new Error("Personal user session changed.");
  await perform({addr:ctx.addr,update,personalWrite:true,...(bookmarkQueryXml?{bookmarkQueryXml}:{})},signal,requestSource,ctx.session,authority,scope);
}
export async function personalExists(pattern:string,ctx:PersonalContext,signal:AbortSignal|undefined,requestSource:string,scope?:MaestroQueryScope):Promise<boolean>{
  const rows=await selectPersonal(`SELECT ?match WHERE { ${pattern} BIND(true AS ?match) } LIMIT 1`,ctx,signal,requestSource,"view",scope);
  return rows.length>0;
}
