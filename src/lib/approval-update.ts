"use client";

import { loadPersonalAuthSession, graphForPrefix } from "@/lib/personal-auth";
import { loadClientStatusMachines } from "@/lib/status-machine-client";
import { machineForTarget, effectiveStatus, transitionStatus, STATUS_MUI } from "@/lib/status-machine-runtime";

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
  const shapes=`${base}/shacl/policies`, otc=`${base}/otc/transcoders`, graph=`${base}/status`;
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
  const select=await fetch("/proxy/api/sparql",{method:"POST",cache:"no-store",signal,
    headers:{"Content-Type":"application/json"},body:JSON.stringify({addr:`${shapes}@${auth.graphStore}`,query})});
  const data=await select.json() as {error?:string;results?:{bindings?:Array<Record<string,{value:string}>>}};
  if(!select.ok || data.error) throw new Error(data.error||`Approval verification failed (HTTP ${select.status}).`);
  const rows=data.results?.bindings??[];
  const updates:string[]=[];
  const escapeLiteral=(s:string)=>JSON.stringify(s);
  for(const uri of resources){
    const matched=rows.filter(row=>row.subject?.value===uri);
    const kinds=new Set(matched.map(row=>row.kind?.value).filter(Boolean));
    if(kinds.size!==1)throw new Error(`${uri} is not a directly approvable Provider, curator or ClassPolicy.`);
    const isCurator=kinds.has("curator");
    const machine=machineForTarget(machines, `${STATUS_MUI}${isCurator?"CurationProvider":kinds.has("provider")?"Provider":"ClassPolicy"}`);
    const asserted=[...new Set(matched.map(row=>row.current?.value).filter((x):x is string=>!!x))];
    const approvalDimension=`${STATUS_MUI}ApprovalStatus`;
    const current=effectiveStatus(machine,asserted)[approvalDimension];
    const desired=status=== "Approved"?`${STATUS_MUI}Approved`:`${STATUS_MUI}Pending`;
    if (current!==desired) {
      const outcome=transitionStatus(machine,asserted,
        `${STATUS_MUI}${status==="Approved"?"Approve":"RevokeApproval"}`);
      if(outcome.to!==desired)throw new Error("RDF approval transition returned an unexpected state.");
    }
    const track=machine.tracks.get(approvalDimension);
    if(!track)throw new Error("RDF approval machine has no approval track.");
    const members=[...track.states].map(iri).join(", ");
    const subject=iri(uri);
    // Revocation/Forget restores virtual Pending: no Pending assertion is
    // created. The machine is still responsible for validating the transition.
    const insert=status==="Approved"
      ? `GRAPH <${graph}> { ${subject} <${STATUS_MUI}status> <${STATUS_MUI}Approved> }` : "";
    updates.push(`DELETE { GRAPH <${graph}> { ${subject} <${STATUS_MUI}status> ?old } }
      INSERT { ${insert} }
      WHERE { OPTIONAL { GRAPH <${graph}> { ${subject} <${STATUS_MUI}status> ?old . FILTER(?old IN (${members})) } } }`);
    if(isCurator){
      // A revoked curator loses all grants immediately, but another approved
      // curator may continue to authorize the same member independently.
      updates.push(`DELETE { GRAPH <${graph}> { ${subject} <${STATUS_MUI}approvedDigest> ?grant . ?grant ?p ?o } }
        WHERE { OPTIONAL { GRAPH <${graph}> { ${subject} <${STATUS_MUI}approvedDigest> ?grant . ?grant ?p ?o } } }`);
      if(status==="Approved"){
        const triples=matched.filter(row=>row.provider?.value && /^sha256:[0-9a-f]{64}$/.test(row.digest?.value??""))
          .map(row=>` ${subject} <${STATUS_MUI}approvedDigest> [ <${STATUS_MUI}forProvider> ${iri(row.provider!.value)} ; <${STATUS_MUI}implementationDigest> ${escapeLiteral(row.digest!.value)} ] .`);
        if(triples.length)updates.push(`INSERT DATA { GRAPH <${graph}> { ${[...new Set(triples)].join("\n")} } }`);
      }
    }
  }
  if(!updates.length)return;
  // Virtuoso's protected SPARQL service accepts individual Update operations
  // reliably. Do not concatenate DELETE/INSERT and INSERT DATA with semicolons:
  // a rejected multi-statement request otherwise prevents FSM approval entirely.
  for (const update of updates) {
    const response=await fetch("/proxy/api/sparql",{method:"POST",cache:"no-store",signal,
      headers:{"Content-Type":"application/json","Accept":"application/json"},
      body:JSON.stringify({update,bookmarkQueryXml:bookmarkedQueryXml})});
    if(!response.ok){
      const body=await response.json().catch(()=>(null)) as {error?:string}|null;
      throw new Error(body?.error||`Approval update failed (HTTP ${response.status})`);
    }
  }
}
