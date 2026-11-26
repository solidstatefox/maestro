"use client";
import type { EndpointCandidate } from "./client-endpoint-discovery";
import { validGraphServerUrl } from "./graph-server-directory";
import { attributedSparqlFetch } from "./sparql-request-attribution";
import { isBoundedReadOnlySparql } from "./sparql-read-guard";
import { sanitizeUpstreamDiagnostic } from "./upstream-error";
type Term={type?:string;value:string};
export type DiscoveryBinding=Record<string,Term|undefined>;
/** Registration candidates are endpoint identities, not Perspective card identities. */
export function endpointCandidates(rows:readonly DiscoveryBinding[]):EndpointCandidate[]{
 const found=new Map<string,EndpointCandidate>();
 for(const row of rows){
  if(row.endpoint?.type!=="uri"&&row.endpoint?.type!=="literal")continue;
  const endpoint=validGraphServerUrl(row.endpoint.value);if(!endpoint)continue;
  const current=found.get(endpoint)??{endpoint,title:endpoint,services:[],standards:[],likelySparql:/sparql/i.test(endpoint)};
  if(row.title?.value.trim()&&current.title===endpoint)current.title=row.title.value.trim();
  if(row.service?.type==="uri"&&!current.services.includes(row.service.value))current.services.push(row.service.value);
  if(row.standard?.value&&!current.standards.includes(row.standard.value))current.standards.push(row.standard.value);
  current.likelySparql ||= current.standards.some(value=>/sparql/i.test(value));
  found.set(endpoint,current);
 }
 return [...found.values()].sort((a,b)=>a.title.localeCompare(b.title));
}
/** Explicit catalog discovery, separate from the live page's FCT enrichment.
 * Approved provider SELECT recipes are read only on the current source endpoint.
 * Never contact discovered endpoints or register them automatically. */
export async function discoverProviderEndpoints(source:string,recipes:readonly string[],signal:AbortSignal):Promise<EndpointCandidate[]>{
 const endpoint=validGraphServerUrl(source);if(!endpoint)throw new Error("Invalid catalog graph server.");
 const queries=[...new Set(recipes)];if(!queries.length||queries.length>8)throw new Error("Invalid endpoint discovery recipe count.");
 const rows:DiscoveryBinding[]=[];
 const active=signal;
 for(const query of queries){
  active.throwIfAborted();
  if(!isBoundedReadOnlySparql(query,16000)||!/\bSELECT\b/i.test(query)||!/\bLIMIT\s+(?:[1-9][0-9]?|[1-4][0-9]{2}|500)\s*$/i.test(query.trim()))throw new Error("Endpoint discovery requires a bounded read-only SELECT (maximum 500 rows).");
  const response=await attributedSparqlFetch('/proxy/api/sparql',{method:'POST',cache:'no-store',signal:active,headers:{'Content-Type':'application/json','x-maestro-debug-source':'urn:maestro:component:provider-endpoint-discovery','x-maestro-debug-component':'ProviderEndpointDiscovery','X-Maestro-Component-Retry':'1'},body:JSON.stringify({addr:`@${endpoint}`,query})});
  const result=await response.json();active.throwIfAborted();
  if(!response.ok||result.incomplete||response.headers.get('X-Maestro-Incomplete')==='true'||!Array.isArray(result.results?.bindings))throw new Error(sanitizeUpstreamDiagnostic(String(result.error||`Endpoint discovery failed or was incomplete (HTTP ${response.status}).`),Infinity));
  if(result.results.bindings.length>500)throw new Error('Endpoint discovery returned too many rows.');
  rows.push(...result.results.bindings);
 }
 return endpointCandidates(rows);
}
