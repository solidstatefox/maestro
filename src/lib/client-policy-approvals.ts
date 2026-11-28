"use client";
import { GRAPH, resolveGraph } from "@/lib/constants/graphs";

import { personalContext, selectPersonal } from "@/lib/client-personal-sparql";
import type { MaestroQueryScope } from "./app-lifecycle/query-view-ownership";
import type { ProviderKind } from "@/lib/provider-catalog-xslt";

const MUI = "gttp://ggg.maestro.ecosys/ns/ui#";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const validIri = (value: string) => value.length > 0 && value.length <= 4096 && /^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(value);
export type ClientApproval = {uri:string;status:"Approved"|"Pending"|null;category:"Policy"|"Provider"|null;providerKind?:ProviderKind|null};

/** Effective approvals are read from the authoritative RDF status graph.
 * A provider is Approved by a direct status assertion OR a version-matched
 * grant from any currently Approved curator. No inferred triples are written.
 * This lookup is browser-side; graph-server ACLs enforce protected writes. */
export async function readClientPolicyApprovals(uris: string[], signal?: AbortSignal, requestSource = "ProviderApprovalLookup", scope?: MaestroQueryScope): Promise<ClientApproval[]> {
  const distinct = [...new Set(uris)];
  if (distinct.some(uri => !validIri(uri)) || distinct.length > 500) throw new Error("Invalid policy identifiers.");
  if (!distinct.length) return [];
  const ctx = await personalContext();
  const shapes = `${resolveGraph(GRAPH.SHACL_POLICIES, ctx.base)}`, otc = `${resolveGraph(GRAPH.OTC_TRANSCODERS, ctx.base)}`, status = `${resolveGraph(GRAPH.STATUS, ctx.base)}`;
  const output = new Map<string,ClientApproval>();
  for (let offset = 0; offset < distinct.length; offset += 20) {
    const batch = distinct.slice(offset,offset+20);
    const rows = await selectPersonal(`SELECT ?policy ?assertion ?curated ?isProvider ?isOtcProvider ?isCurator ?isClassPolicy ?isKinds ?isFsm ?isFacet ?isPerspective ?isFormat ?isTranscoder ?isAnalysis WHERE {
      VALUES ?policy { ${batch.map(uri=>`<${uri}>`).join(" ")} }
      OPTIONAL { GRAPH <${status}> { ?policy <${MUI}status> ?assertion } }
      OPTIONAL { GRAPH <${shapes}> { ?policy a <${MUI}Provider> } BIND(true AS ?isProvider) }
      OPTIONAL { GRAPH <${otc}> { ?policy a <${MUI}Provider> } BIND(true AS ?isOtcProvider) }
      OPTIONAL { GRAPH <${shapes}> { ?policy a <${MUI}CurationProvider> } BIND(true AS ?isCurator) }
      OPTIONAL { GRAPH <${shapes}> { ?policy a <${MUI}ClassPolicy> } BIND(true AS ?isClassPolicy) }
      OPTIONAL { GRAPH <${shapes}> { ?policy a <${MUI}KindProvider> } BIND(true AS ?isKinds) }
      OPTIONAL { GRAPH <${shapes}> { ?policy a <${MUI}StateMachineProvider> } BIND(true AS ?isFsm) }
      OPTIONAL { GRAPH <${shapes}> { ?policy <${MUI}widget> ?facetWidget . ?facetWidget a <${MUI}FacetWidget> } BIND(true AS ?isFacet) }
      OPTIONAL { GRAPH <${shapes}> { ?policy <${MUI}widget> ?perspectiveWidget . ?perspectiveWidget a <${MUI}PerspectiveWidget> } BIND(true AS ?isPerspective) }
      OPTIONAL { GRAPH <${shapes}> { ?policy <${MUI}widget> ?formatWidget . ?formatWidget a <${MUI}RecordViewerWidget> } BIND(true AS ?isFormat) }
      OPTIONAL { GRAPH <${otc}> { ?policy <${MUI}widget> ?otcWidget . ?otcWidget a <${MUI}RdfTranscoderWidget> } BIND(true AS ?isTranscoder) }
      OPTIONAL { GRAPH <${shapes}> { ?policy a <gttp://ggg.maestro.ecosys/ns/analyze#Analysis> } BIND(true AS ?isAnalysis) }
      OPTIONAL {
        GRAPH <${shapes}> {
          ?curator a <${MUI}CurationProvider> ; <${MUI}widget>/<${RDF}rest>*/<${RDF}first> ?policy .
        }
        { GRAPH <${shapes}> { ?policy <${MUI}implementationDigest> ?currentDigest } }
        UNION { GRAPH <${otc}> { ?policy <${MUI}implementationDigest> ?currentDigest } }
        GRAPH <${status}> {
          ?curator <${MUI}status> <${MUI}Approved> ; <${MUI}approvedDigest> ?grant .
          ?grant <${MUI}forProvider> ?policy ; <${MUI}implementationDigest> ?currentDigest .
        }
        BIND(true AS ?curated)
      }
    }`,ctx,signal,requestSource,"view",scope ?? {tab:"personal",ribbon:"session"});
    for (const uri of batch) {
      const matches = rows.filter(row => row.policy?.value===uri);
      const present = (key:string) => matches.some(row => ["true","1"].includes(row[key]?.value ?? ""));
      const provider = present("isProvider") || present("isOtcProvider");
      const providerKind:ProviderKind|null = present("isClassPolicy")?"policies"
        :present("isCurator")?"curators":present("isKinds")?"kinds"
        :present("isFsm")?"fsm-providers":present("isFacet")?"facet-widgets"
        :present("isPerspective")?"perspectives":present("isFormat")?"formats"
        :present("isTranscoder")?"transcoders":present("isAnalysis")?"analysis-providers":null;
      const known = provider || present("isCurator") || present("isClassPolicy");
      const explicit = matches.some(row=>row.assertion?.value === `${MUI}Approved`);
      const inherited = provider && !present("isCurator") && present("curated");
      output.set(uri,{uri,status: !known?null:explicit||inherited?"Approved":"Pending",
        category: !known?null:present("isClassPolicy")?"Policy":"Provider",providerKind});
    }
  }
  return distinct.map(uri=>output.get(uri) ?? {uri,status:null,category:null});
}
