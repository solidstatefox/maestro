import { getPersonalStatusGraph } from "@/lib/personal-status-graph";
import { getShapesGraph, graphForFile, updatePersonalSparql } from "@/lib/personal-sparql";
import { promoteApprovedCurators } from "@/lib/curator-approvals";

const MUI = "gttp://ggg.maestro.ecosys/ns/ui#";
const safe = (value: string) => /^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(value) && value.length <= 4096;

/** FCT discovery commit, not a separate browser request or unbounded catalog scan.
 * Operates only on IRIs already returned by this FCT result page and exactly
 * one graph from /graph/manifest.json. No GRAPH ?providerGraph anywhere.
 */
export async function recordFeatureDiscovery(request: Request, feature: string, resources: string[]): Promise<void> {
  if (!(["formats", "facet-widgets", "transcoders", "curators"] as string[]).includes(feature)) return;
  const items = [...new Set(resources)].filter(safe).slice(0, 500);
  if (!items.length) return;
  const source = feature === "transcoders" ? graphForFile("otc-transcoders.rdf", request) : getShapesGraph(request);
  const status = getPersonalStatusGraph(request);
  const membership = feature === "curators" ? "CurationProvider" : "Provider";
  const query = `INSERT { GRAPH <${status}> { ?resource <${MUI}status> <${MUI}Pending> } }
    WHERE { VALUES ?resource { ${items.map(item => `<${item}>`).join(" ")} }
      GRAPH <${source}> { ?resource a <${MUI}${membership}> }
      FILTER NOT EXISTS { GRAPH <${status}> { ?resource <${MUI}status> ?approval .
        FILTER(?approval IN (<${MUI}Pending>, <${MUI}Approved>)) } }
    }`;
  await updatePersonalSparql(query, 20000, request);
  if (feature !== "curators") await promoteApprovedCurators(request);
}
