"use client";
import { GRAPH, resolveGraph } from "@/lib/constants/graphs";
import { personalContext, selectPersonal, updatePersonal } from "@/lib/client-personal-sparql";
import { updateSessionSnapshot, readSessionHydration } from "@/lib/client-digest-session";
import { hydrateAuthBootstrap } from "@/lib/client-auth-bootstrap";

import { loadPersonalAuthSession, graphForPrefix } from "@/lib/personal-auth";
import { loadClientStatusMachines } from "@/lib/status-machine-client";
import { machineForTarget, transitionStatusTo, STATUS_MUI } from "@/lib/status-machine-runtime";
import { statusTransitionUpdate } from "@/lib/status-machine-sparql";

const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const validIri = (value: string) => /^[a-z][a-z\d+.-]*:[^\s<>"{}|^`\\]+$/i.test(value);
const iri=(value:string)=>{if(!validIri(value))throw new Error("Invalid resource URI.");return `<${value}>`;};

/** Providers, curators, and ClassPolicies can all be approved directly.
 * Curator-derived approval is an additional independent source of authority. */
export async function changeApprovals(uris: string[], status: "Approved" | "Pending" | null,
  graphPrefix: string, bookmarkedQueryXml: string, signal?: AbortSignal): Promise<void> {
  if (!validIri(graphPrefix) || !bookmarkedQueryXml || !uris.length) throw new Error("Login and bookmarked FCT query required.");
  const resources=[...new Set(uris)];
  if (resources.length>500 || resources.some(uri=>!validIri(uri)))throw new Error("Invalid approval resource URI.");
  const auth=await loadPersonalAuthSession();
  if(!auth || auth.graphPrefix.replace(/\/+$/,"")!==graphPrefix.replace(/\/+$/, ""))throw new Error("Personal login changed; authenticate again.");
  const base=graphForPrefix(auth.graphPrefix);
  const shapes=`${resolveGraph(GRAPH.SHACL_POLICIES, base)}`, otc=`${resolveGraph(GRAPH.OTC_TRANSCODERS, base)}`, graph=`${resolveGraph(GRAPH.STATUS, base)}`;
  const machines=await loadClientStatusMachines(signal);
  const values=resources.map(iri).join(" ");
  // Verify the target is a seeded Provider, curator or ClassPolicy.
  // Digest lookup is scoped to an actual member of this curator; an unbound
  // ?provider must not enumerate unrelated policies in either graph.
  const query=`PREFIX mui: <${STATUS_MUI}> PREFIX rdf: <${RDF}>
    SELECT DISTINCT ?subject ?kind ?current ?provider ?digest WHERE {
      VALUES ?subject { ${values} }
      {
        GRAPH <${shapes}> { ?subject a mui:CurationProvider }
        BIND("curator" AS ?kind)
        OPTIONAL {
          GRAPH <${shapes}> { ?subject mui:widget/rdf:rest*/rdf:first ?provider }
          OPTIONAL {
            { GRAPH <${shapes}> { ?provider mui:implementationDigest ?digest } }
            UNION { GRAPH <${otc}> { ?provider mui:implementationDigest ?digest } }
          }
        }
      }
      UNION {
        GRAPH <${shapes}> { ?subject a mui:ClassPolicy }
        BIND("class-policy" AS ?kind)
      }
      UNION {
        { GRAPH <${shapes}> { ?subject a mui:Provider } }
        UNION { GRAPH <${otc}> { ?subject a mui:Provider } }
        FILTER NOT EXISTS { GRAPH <${shapes}> { ?subject a mui:CurationProvider } }
        FILTER NOT EXISTS { GRAPH <${shapes}> { ?subject a mui:ClassPolicy } }
        BIND("provider" AS ?kind)
      }
      OPTIONAL { GRAPH <${graph}> { ?subject mui:status ?current } }
    } LIMIT 5000`;
  const ctx=await personalContext();
  if(ctx.session!==auth)throw new Error("Personal user session changed.");
  const rows=await selectPersonal(query,ctx,signal,"approval-update:changeApprovals","view",{tab:"personal",ribbon:"session"});
  const updates:string[]=[];
  const escapeLiteral=(s:string)=>JSON.stringify(s);
  for(const uri of resources){
    const matched=rows.filter(row=>row.subject?.value===uri);
    const kinds=new Set(matched.map(row=>row.kind?.value).filter(Boolean));
    if(kinds.size!==1)throw new Error(`${uri} is not a directly approvable Provider, curator or ClassPolicy.`);
    const isCurator=kinds.has("curator");
    const machine=machineForTarget(machines, `${STATUS_MUI}${isCurator?"CurationProvider":kinds.has("provider")?"Provider":"ClassPolicy"}`);
    const asserted=[...new Set(matched.map(row=>row.current?.value).filter((x):x is string=>!!x))];
    const desired=status=== "Approved"?`${STATUS_MUI}Approved`:`${STATUS_MUI}Pending`;
    const outcome=transitionStatusTo(machine,asserted,desired);
    // The transition's RDF mui:assertState determines which triple (if any)
    // is persisted. No hard-coded Approved/Pending INSERT branches.
    if (outcome) updates.push(statusTransitionUpdate({ machine, transition:outcome,
      assertions:asserted, graph, resource:uri, predicate:`${STATUS_MUI}status` }));
    const subject=iri(uri);
    if(isCurator){
      // A revoked curator loses all grants immediately, but another approved
      // curator may continue to authorize the same member independently.
      updates.push(`DELETE { GRAPH <${graph}> { ${subject} <${STATUS_MUI}approvedDigest> ?grant . ?grant ?p ?o } }
        WHERE { OPTIONAL { GRAPH <${graph}> { ${subject} <${STATUS_MUI}approvedDigest> ?grant . ?grant ?p ?o } } }`);
      if(status==="Approved"){
        const triples=matched.filter(row=>row.provider?.value && /^sha256:[0-9a-f]{64}$/.test(row.digest?.value??""))
          .map(row=>` ${subject} <${STATUS_MUI}approvedDigest> [ <${STATUS_MUI}forProvider> ${iri(row.provider!.value!)} ; <${STATUS_MUI}implementationDigest> ${escapeLiteral(row.digest!.value!)} ] .`);
        if(triples.length)updates.push(`INSERT DATA { GRAPH <${graph}> { ${[...new Set(triples)].join("\n")} } }`);
      }
    }
  }
  if(!updates.length)return;
  // Virtuoso's protected SPARQL service accepts individual Update operations
  // reliably. Do not concatenate DELETE/INSERT and INSERT DATA with semicolons:
  // a rejected multi-statement request otherwise prevents FSM approval entirely.
  for (const update of updates) {
    if((await personalContext()).session!==auth)throw new Error("Personal user session changed.");
    await updatePersonal(update,signal,bookmarkedQueryXml,"approval-update:changeApprovals",undefined,"view",{tab:"personal",ribbon:"session"});
  }
  const changed=await selectPersonal(`SELECT ?resource ?status WHERE { VALUES ?resource { ${values} } GRAPH <${graph}> { ?resource <${STATUS_MUI}status> ?status } }`,ctx,signal,"approval-update:changeApprovals","view",{tab:"personal",ribbon:"session"});
  const saved=await readSessionHydration(auth);
  if(saved.snapshot){
    await updateSessionSnapshot(auth,snapshot=>({bindings:[...snapshot.bindings.filter(row=>row.section?.value!=="status" || !resources.includes(row.resource?.value??"")),
      ...changed.map(row=>({...row,section:{type:"literal",value:"status"}}))]}));
    const latest=await readSessionHydration(auth);
    if(latest.snapshot)hydrateAuthBootstrap(auth,latest.snapshot.bindings,latest.snapshot.buttons);
  }
}
