"use client";

import { personalContext, selectPersonal } from "@/lib/client-personal-sparql";
import { readClientPolicyApprovals } from "@/lib/client-policy-approvals";
import type { PersonalPerspectiveKind } from "@/lib/personal-perspective-ids";
import { isClientQueryBookmarked, writeClientProviderDiscovery } from "@/lib/client-provider-provenance";
import { UI_COMPONENT } from "@/lib/maestro-ui-component-ids";

const MUI = "gttp://ggg.maestro.ecosys/ns/ui#";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const SH = "http://www.w3.org/ns/shacl#";
const safe = (v: string) => v.length < 4096 && /^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(v);
export type ClientPerspective = { uri: string; kind: PersonalPerspectiveKind; label: string };

/** Browser-owned, read-only catalog projection. The /sparql route is the
 * authenticated transport. Only approved providers are shown; approval and
 * matched-record discovery attestations remain server-authorized. */
export async function discoverClientPerspectives(classes: string[], signal?: AbortSignal, queryProviders: string[] = []): Promise<ClientPerspective[]> {
  const requested = [...new Set(classes.filter(safe))].slice(0, 100);
  const additional = [...new Set(queryProviders.filter(safe))].slice(0, 100);
  if (!requested.length && !additional.length) return [];
  const ctx = await personalContext();
  const shapes = `${ctx.base}/shacl/policies`, ontology = `${ctx.base}/ontology-cache`;
  const rows = await selectPersonal(`PREFIX mui: <${MUI}> PREFIX rdf: <${RDF}> PREFIX rdfs: <${RDFS}>
    SELECT DISTINCT ?provider ?kind ?label ?stylesheet WHERE {
      GRAPH <${shapes}> {
        ?provider a mui:Provider ; mui:perspectiveKind ?kind ; mui:widget ?template ; mui:accepts ?input .
        ?template a mui:PerspectiveWidget ; (mui:templateContent|rdf:value) ?stylesheet .
        OPTIONAL { ?input <${SH}class> ?target }
        OPTIONAL { ?provider rdfs:label ?label }
      }
      ${requested.length ? `OPTIONAL { VALUES ?queryClass { ${requested.map(iri=>`<${iri}>`).join(" ")} } }` : ""}
      FILTER((BOUND(?target) && BOUND(?queryClass) && (?queryClass = ?target || EXISTS { GRAPH <${ontology}> { ?queryClass rdfs:subClassOf+ ?target } }))
        ${additional.length ? ` || ?provider IN (${additional.map(uri=>`<${uri}>`).join(",")})` : ""})
    } ORDER BY ?label LIMIT 20`, ctx, signal);
  const possible = [...new Map(rows.map(row => ({
    uri: row.provider?.value ?? "", kind: row.kind?.value ?? "",
    label: row.label?.value || row.kind?.value || "",
    stylesheet: row.stylesheet?.value ?? "",
  })).filter(row => safe(row.uri) && (row.kind === "bookmarks" || row.kind === "history") &&
    row.stylesheet.length > 0 && row.stylesheet.length <= 250_000)
    .map(row => [row.uri, row] as const)).values()];
  const approvals = await readClientPolicyApprovals(possible.map(item => item.uri), signal);
  const approved = new Set(approvals.filter(item => item.status === "Approved").map(item => item.uri));
  return possible.filter(item => approved.has(item.uri)).map(({ uri, kind, label }) => ({
    uri, kind: kind as PersonalPerspectiveKind, label,
  }));
}

/** The view ribbon's record-matched discovery is a browser-SPARQL operation.
 * Query classes alone do not establish a matched Record; prove the specific
 * Record's rdf:type against the live graph before writing provenance. */
export async function discoverMatchedClientPerspectives(
  classes: string[], queryXml: string, record: string, history?: string, signal?: AbortSignal,
): Promise<ClientPerspective[]> {
  const requested = [...new Set(classes.filter(safe))].slice(0,100);
  if(!requested.length)return [];
  const ctx = await personalContext();
  const shapes = `${ctx.base}/shacl/policies`, ontology = `${ctx.base}/ontology-cache`;
  const candidates = await selectPersonal(`PREFIX mui: <${MUI}> PREFIX rdf: <${RDF}> PREFIX rdfs: <${RDFS}>
    SELECT DISTINCT ?provider ?kind ?target ?stylesheet WHERE { GRAPH <${shapes}> {
      ?provider a mui:Provider ; mui:perspectiveKind ?kind ; mui:widget ?template ; mui:accepts ?input .
      ?input <${SH}class> ?target .
      ?template a mui:PerspectiveWidget ; (mui:templateContent|rdf:value) ?stylesheet .
    }
    VALUES ?queryClass { ${requested.map(uri=>`<${uri}>`).join(" ")} }
    FILTER(?queryClass = ?target || EXISTS { GRAPH <${ontology}> { ?queryClass rdfs:subClassOf+ ?target } })
    } LIMIT 100`,ctx,signal);
  const providers = candidates.map(row=>({
    uri:row.provider?.value??"",kind:row.kind?.value??"",target:row.target?.value??"",stylesheet:row.stylesheet?.value??"",
  })).filter(item=>safe(item.uri)&&safe(item.target)&&(item.kind==="bookmarks"||item.kind==="history")&&
    item.stylesheet.length>0&&item.stylesheet.length<=250_000);
  if(providers.length && safe(record) && await isClientQueryBookmarked(queryXml,signal)) {
    const xml = new DOMParser().parseFromString(queryXml,"application/xml");
    const root = xml.documentElement;
    const address = root?.localName==="query" ? root.getAttribute("addr")??"" : "";
    const delimiter = address.indexOf("@");
    if(delimiter>0){
      const graph = address.slice(0,delimiter);
      if(graph && graph!=="$ALL$" && !safe(graph))throw new Error("Invalid FCT named graph URI.");
      const target=address.slice(delimiter+1);
      try{
        const endpoint = new URL(target);
        if(["https:","http:"].includes(endpoint.protocol)){
          const validGraph = graph && graph!=="$ALL$" && safe(graph);
          const pairValues = [...new Set(providers.map(item=>`(<${item.uri}> <${item.target}>)`))].join(" ");
          const pattern = `<${record}> a ?recordClass .`;
          const query = `PREFIX rdfs: <${RDFS}> SELECT DISTINCT ?provider WHERE {
            VALUES (?provider ?target) { ${pairValues} }
            ${validGraph ? `GRAPH <${graph}> { ${pattern} }` : pattern}
            FILTER(?recordClass = ?target || EXISTS { ?recordClass rdfs:subClassOf+ ?target }) }`;
          const response=await fetch("/proxy/api/sparql",{method:"POST",credentials:"same-origin",cache:"no-store",signal,
            headers:{"Content-Type":"application/json"},body:JSON.stringify({addr:address,query})});
          if(response.ok){
            const data = await response.json() as {results?:{bindings?:Array<{provider?:{value?:string}}>}};
            const matched = new Set((data.results?.bindings??[]).map(row=>row.provider?.value??"").filter(Boolean));
            if(matched.size)await writeClientProviderDiscovery([...matched],{
              component:UI_COMPONENT.perspectiveRibbon,queryXml,record,
              ...(history&&safe(history)?{history}:{}),
            },signal);
          }
        }
      }catch(error){if(signal?.aborted)throw error;}
    }
  }
  return discoverClientPerspectives(requested,signal);
}
