"use client";
import { inheritActorQueryAuthority } from "./app-lifecycle/actor-query-authority";
import { requireSparqlAttribution } from "./sparql-request-attribution";
import { graphForPrefix, loadPersonalAuthSession, type PersonalAuthSession } from "./personal-auth";
import { personalWriteEndpoint } from "./personal-endpoints";
import { reserveDigestRequest, withDigestSessionLock, commitRefreshedDigest, digestSessionSignal, rememberDigestHttpOutcome } from "./client-digest-session";
import { observePersonalAuthResponse } from "./personal-session-hint";
import { signalPersonalHealth } from "./personal-sparql-health";
import { observedUpstreamStatus, observeProxyFetch, proxyQuerySignal } from "./proxy-transport-observation";
import { DIGEST_SESSION_HEADER, DIGEST_SESSION_SCHEME, type DigestSessionRecord } from "./digest-session-record";
/** The HA1 carrier is sent only to Maestro's same-origin proxy, never to Virtuoso. */
export async function personalRequestHeaders(session:PersonalAuthSession):Promise<Record<string,string>> {
  if(typeof location==="undefined" || (location.protocol!=="https:" && !["localhost","127.0.0.1","[::1]"].includes(location.hostname)))
    throw new Error("Personal Digest sessions require a secure Maestro origin.");
  const record=await reserveDigestRequest(session);
  return {[DIGEST_SESSION_HEADER]:DIGEST_SESSION_SCHEME+encodeURIComponent(JSON.stringify(record))};
}
export async function withPersonalProxyCredentials(url:string,init?:RequestInit,record?:DigestSessionRecord):Promise<{init:RequestInit;authenticated:boolean;session?:PersonalAuthSession}> {
  // Explicit personal SELECT/ASK or UPDATE addressed to the saved namespace.
  if(url!=="/proxy/api/sparql" || typeof init?.body!=="string")return {init:init??{},authenticated:false};
  let body:{query?:unknown;update?:unknown;addr?:unknown;personalRead?:unknown;personalWrite?:unknown};
  try{body=JSON.parse(init.body);}catch{return {init,authenticated:false};}
  if(!body || typeof body.addr!=="string" || !(
    (body.personalRead===true && typeof body.query==="string" && body.update===undefined) ||
    (body.personalWrite===true && typeof body.update==="string" && body.query===undefined)))return {init,authenticated:false};
  const session=await loadPersonalAuthSession();
  if(!session)return {init,authenticated:false};
  const at=body.addr.lastIndexOf("@");
  const graph=body.addr.slice(0,at),endpoint=body.addr.slice(at+1);
  const base=graphForPrefix(session.graphPrefix), protectedEndpoint=personalWriteEndpoint(session);
  if(at<0 || (endpoint!==session.graphStore && endpoint!==protectedEndpoint) ||
      !(graph===base || graph.startsWith(`${base}/`) || graph.startsWith(`${base}#`)))return {init,authenticated:false};
  const headers=new Headers(init.headers);
  if(record)headers.set(DIGEST_SESSION_HEADER,DIGEST_SESSION_SCHEME+encodeURIComponent(JSON.stringify(record)));
  else if(!headers.get(DIGEST_SESSION_HEADER)?.startsWith(DIGEST_SESSION_SCHEME))for(const [key,value] of Object.entries(await personalRequestHeaders(session)))headers.set(key,value);
  return {init:{...init,headers,cache:"no-store",body:JSON.stringify({...body,addr:`${graph}@${protectedEndpoint}`})},authenticated:true,session};
}
export function personalAuthenticatedAddr(session:PersonalAuthSession):string{return `${graphForPrefix(session.graphPrefix)}@${personalWriteEndpoint(session)}`;}
export async function personalAuthenticatedFetch(session:PersonalAuthSession,input:RequestInfo|URL,init:RequestInit, transport:(input:RequestInfo|URL,init?:RequestInit)=>Promise<Response>=observeProxyFetch):Promise<Response>{
  requireSparqlAttribution(input, init);
  if(input!=="/proxy/api/sparql")throw new Error("Invalid personal request destination.");
  const signal=digestSessionSignal(session,proxyQuerySignal(init.signal));
  inheritActorQueryAuthority(init.signal, signal);
  return withDigestSessionLock(signal,async()=>{
    const record=await reserveDigestRequest(session);
    const scoped=await withPersonalProxyCredentials(input,{...init,signal},record);
    if(!scoped.authenticated || scoped.session!==session)throw new Error("No restored personal user session.");
    {
      const response=await transport(input,scoped.init);
      signal.throwIfAborted();
      await commitRefreshedDigest(session,record,response);
      const upstreamStatus=observedUpstreamStatus(response);
      if(upstreamStatus!==null) {
        await rememberDigestHttpOutcome(session,upstreamStatus,Date.now());
        if(!signal.aborted) {
          observePersonalAuthResponse(response,session);
          const source = new Headers(init.headers).get("x-maestro-debug-source") ?? "";
          // Reading/writing the health ledger itself is not an independent
          // health probe and must not cause a status-history feedback loop.
          if (!source.includes("graph-server-status-history")) signalPersonalHealth(session.graphStore, upstreamStatus);
        }
      }
      return response;
    }
  });
}
