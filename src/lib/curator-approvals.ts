import { getPersonalStatusGraph } from "@/lib/personal-status-graph";
import { getShapesGraph, graphForFile, updatePersonalSparql } from "@/lib/personal-sparql";

const MUI = "gttp://ggg.maestro.ecosys/ns/ui#";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";

/** Persist provider approvals conferred by explicitly Approved RDF curators.
 * The curator and provider must be declared in the user's loaded policy graph.
 * Pending is promoted; incidental Seen/Unseen does not prevent approval.
 * Only call this after verifying the current live FCT query is bookmarked.
 */
export async function promoteApprovedCurators(request: Request): Promise<void> {
  const status = `<${getPersonalStatusGraph(request)}>`;
  const shapes = `<${getShapesGraph(request)}>`;
  const otc = `<${graphForFile("otc-transcoders.rdf", request)}>`;
  await updatePersonalSparql(`DELETE { GRAPH ${status} { ?provider <${MUI}status> <${MUI}Pending> } }
    INSERT { GRAPH ${status} { ?provider <${MUI}status> <${MUI}Approved> } }
    WHERE {
      GRAPH ${shapes} {
        ?curator a <${MUI}CurationProvider> ; <${MUI}widget> ?members .
        ?members <${RDF}rest>*/<${RDF}first> ?provider .
      }
      { GRAPH ${shapes} { ?provider a <${MUI}Provider> } }
      UNION { GRAPH ${otc} { ?provider a <${MUI}Provider> } }
      GRAPH ${status} { ?curator <${MUI}status> <${MUI}Approved> }
      FILTER NOT EXISTS { GRAPH ${status} { ?provider <${MUI}status> <${MUI}Approved> } }
    }`, 20000, request);
}
