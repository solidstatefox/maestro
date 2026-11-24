"use client";
/** One authenticated SELECT hydrates appbar and the existing RDF->XState adapter.
 * Graphs remain independent; the browser owns all XState readiness guards. */
import { GRAPH, resolveGraph } from "@/lib/constants/graphs";
import { graphForPrefix, type PersonalAuthSession } from "@/lib/personal-auth";
import { personalWriteEndpoint } from "@/lib/personal-endpoints";
import { updateSessionSnapshot } from "@/lib/client-digest-session";
import { personalAuthenticatedFetch } from "@/lib/client-personal-request";
import { compileStatusMachines, statusMachineRows, machineForTarget } from "@/lib/status-machine-runtime";
import { invalidateClientStatusMachines, primeClientStatusMachines } from "@/lib/status-machine-client";

const MUI = "gttp://ggg.maestro.ecosys/ns/ui#";
const SCHEMA = "https://schema.org/url";
type Term = { type?:string; value?:string };
export type BootstrapBinding = Record<string, Term>;
export type BootstrapButton = {uri:string;action:string;icon:string;tooltip:string;url:string};
export type BootstrapStatus = {resource:string;status:string};
let latest: {identity:string;buttons:BootstrapButton[];statuses:BootstrapStatus[];machineCount:number} | null = null;
let revision = 0;
const identityOf = (session: PersonalAuthSession) => `${session.graphStore}\u0000${session.graphPrefix}\u0000${session.authType}\u0000${session.userName ?? session.username ?? ""}`;
export function clearAuthBootstrap():void { revision++; latest = null; invalidateClientStatusMachines();
  if (typeof window!=="undefined") window.dispatchEvent(new Event("maestro:auth-bootstrap-updated")); }
if (typeof window!=="undefined") window.addEventListener("maestro:personal-session-cleared",clearAuthBootstrap);
export function bootstrapHasMachines(): boolean { return Boolean(latest?.machineCount); }
const EMPTY_BUTTONS: BootstrapButton[] = [];
export function currentBootstrapButtons(): BootstrapButton[] { return latest?.buttons ?? EMPTY_BUTTONS; }
export function emptyBootstrapButtons(): BootstrapButton[] { return EMPTY_BUTTONS; }
export function subscribeBootstrapButtons(listener:()=>void):()=>void {
  window.addEventListener("maestro:auth-bootstrap-updated",listener);
  return ()=>window.removeEventListener("maestro:auth-bootstrap-updated",listener);
}
export async function replaceBootstrapButtons(session:PersonalAuthSession,buttons:BootstrapButton[]):Promise<void> {
  if(!latest || latest.identity!==identityOf(session))return;
  await updateSessionSnapshot(session,{buttons});
  if(!latest || latest.identity!==identityOf(session))return;
  latest={...latest,buttons};
  window.dispatchEvent(new Event("maestro:auth-bootstrap-updated"));
}
export function currentBootstrapStatuses(): BootstrapStatus[] { return latest?.statuses ?? []; }

/** A base row guarantees that a genuine authenticated SELECT succeeds even
 * before the user's first /graph seed or provider bookmarks are created. */
export function authBootstrapSelect(session: Pick<PersonalAuthSession,"graphPrefix">): string {
  const base = graphForPrefix(session.graphPrefix);
  const machine = resolveGraph(GRAPH.STATE_MACHINES,base), status = resolveGraph(GRAPH.STATUS,base);
  const appbar = resolveGraph(GRAPH.APPBAR,base), bookmarks = resolveGraph(GRAPH.BOOKMARKS,base);
  const policies = resolveGraph(GRAPH.SHACL_POLICIES,base);
  return `PREFIX mui: <${MUI}> PREFIX sh: <http://www.w3.org/ns/shacl#>
SELECT ?section ?machine ?target ?dimension ?initial ?from ?trigger ?to ?digest ?assertState
       ?button ?action ?icon ?tooltip ?url ?directUrl ?resource ?status WHERE {
  { BIND("probe" AS ?section) }
  UNION { GRAPH <${machine}> {
    ?machine a mui:StateMachineProvider ; sh:targetClass ?target ; mui:statusTrack ?track .
    ?track mui:trackDimension ?dimension ; mui:initialState ?initial ; mui:transition ?transition .
    ?transition mui:fromState ?from ; mui:trigger ?trigger ; mui:toState ?to .
    OPTIONAL { ?machine mui:implementationDigest ?digest }
    OPTIONAL { ?transition mui:assertState ?assertState }
    BIND("machine" AS ?section)
  } }
  UNION { GRAPH <${appbar}> {
    ?button a mui:AppbarButtonProvider ; mui:action ?action ; mui:icon ?icon ; mui:tooltip ?tooltip .
    OPTIONAL { ?button <${SCHEMA}> ?directUrl }
    BIND("appbar" AS ?section)
  } OPTIONAL { GRAPH <${bookmarks}> { ?action <${SCHEMA}> ?url } } }
  UNION { GRAPH <${status}> { ?resource mui:status ?status }
    GRAPH <${policies}> { ?resource a ?providerType .
      FILTER(?providerType IN (mui:Provider, mui:CurationProvider, mui:ClassPolicy)) }
    BIND("status" AS ?section)
  }
} LIMIT 3000`;
}
/** Parse and prime only after the entire authenticated response is valid.
 * XState's existing policy gate still verifies the required machine targets. */
export function hydrateAuthBootstrap(session:PersonalAuthSession, bindings:BootstrapBinding[], savedButtons?:BootstrapButton[]):void {
  const id=identityOf(session);
  const machineRows = bindings.filter(row=>row.section?.value==="machine");
  const machines = compileStatusMachines(statusMachineRows(machineRows));
  for(const target of ["http://www.w3.org/2000/01/rdf-schema#Resource",`${MUI}Provider`,`${MUI}ClassPolicy`,`${MUI}CurationProvider`]) machineForTarget(machines,target);
  const buttons = new Map<string,BootstrapButton>();
  const statuses:BootstrapStatus[]=[];
  for (const row of bindings) {
    if (row.section?.value==="appbar") {
      const uri=row.button?.value??"";
      if (uri && !buttons.has(uri)) buttons.set(uri,{uri,action:row.action?.value??"",icon:row.icon?.value??"",
        tooltip:row.tooltip?.value??"",url:row.directUrl?.value??row.url?.value??""});
    }
    if (row.section?.value==="status" && row.resource?.value && row.status?.value)
      statuses.push({resource:row.resource.value,status:row.status.value});
  }
  primeClientStatusMachines(`${graphForPrefix(session.graphPrefix)}@${personalWriteEndpoint(session)}`,
    graphForPrefix(session.graphPrefix),machines);
  latest={identity:id,buttons:savedButtons??[...buttons.values()],statuses,machineCount:machines.length};
  revision++;
  if (typeof window!=="undefined") window.dispatchEvent(new CustomEvent("maestro:auth-bootstrap-updated",{detail:{identity:id,revision}}));
}

export async function refreshAuthBootstrap(session:PersonalAuthSession, signal?:AbortSignal):Promise<BootstrapBinding[]> {
  const expected=revision;
  // Bootstrap can be expensive on first login and must never consume the
  // 15-second Digest authentication deadline. Failure preserves credentials.
  const deadline=AbortSignal.timeout(60_000);
  const requestSignal=signal?AbortSignal.any([signal,deadline]):deadline;
  const response=await personalAuthenticatedFetch(session,"/proxy/api/sparql",{
    method:"POST",cache:"no-store",signal:requestSignal,headers:{"x-maestro-debug-source":"urn:maestro:component:AuthBootstrap","x-maestro-debug-component":"AuthBootstrap","Content-Type":"application/json"},
    body:JSON.stringify({personalRead:true,
      addr:`${graphForPrefix(session.graphPrefix)}@${personalWriteEndpoint(session)}`,
      query:authBootstrapSelect(session)}),
  });
  if (!response.ok) throw new Error(`Personal authentication bootstrap failed (HTTP ${response.status}).`);
  const parsed=await response.json() as {results?:{bindings?:BootstrapBinding[]}};
  if (!Array.isArray(parsed.results?.bindings) || parsed.results.bindings.length >= 3000 || !parsed.results.bindings.some(row=>row.section?.value==="probe")) throw new Error("Authentication bootstrap returned invalid SPARQL Results JSON.");
  requestSignal.throwIfAborted();
  if (revision!==expected) throw new Error("Personal bootstrap was superseded.");
  hydrateAuthBootstrap(session,parsed.results.bindings);
  return parsed.results.bindings;
}
