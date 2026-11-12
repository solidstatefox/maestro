/** Native FCT scopes for the three View > Features registries.
 * These are real <query> trees dispatched by the normal FCT engine. The
 * catalog SPARQL endpoint may enrich their RDF subjects with descriptions,
 * but it never chooses which subjects appear in the Features result list.
 * The <view> carrier is deliberately positioned so Trail and left facets
 * describe precisely the resources shown by the Features view. */
import type { FctQueryNode, FctQueryTree } from "@/lib/fct-query-api";
import type { FeatureKind } from "@/lib/feature-view-xslt";

const MUI = "gttp://ggg.maestro.ecosys/ns/ui#";
const OTC = "gttp://ggg.openlink.sw/nlp/transcoder#";
const VIEW: FctQueryNode = { id: "query-view", name: "view", attributes: { type: "list", limit: "30", offset: "0" }, children: [] };
const node = (id: string, name: string, iri: string, children: FctQueryNode[] = []): FctQueryNode => ({ id, name, attributes: { iri }, children });

export function featureFctQuery(tree: FctQueryTree, feature: FeatureKind, graph: string, endpoint: string, limit: number): FctQueryTree {
  const view = { ...VIEW, attributes: { ...VIEW.attributes, limit: String(Math.min(500, Math.max(1, Math.trunc(limit) || 30))) } };
  let children: FctQueryNode[];
  if (feature === "policies") {
    // Only genuinely discovered resources: the approval graph carries their
    // status AND their successful component match. Root regex admits Pending
    // and Approved while keeping the XML query and breadcrumb path explicit.
    children = [
      { id: "feature-policy-status-values", name: "value", attributes: { datatype: "string", op: "regex" }, text: `^${MUI.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:Pending|Approved)$`, children: [] },
      node("feature-policy-status-role", "property-of", `${MUI}status`, [
        node("feature-policy-matched-component", "property", `${MUI}lastRequestComponent`),
        view,
      ]),
    ];
  } else if (feature === "formats") {
    // The format is the widget, not the provider subject. This exactly
    // mirrors provider -> mui:widget -> RecordViewerWidget in the shape graph.
    children = [
      node("feature-format-provider", "class", `${MUI}Provider`),
      node("feature-format-widget", "property", `${MUI}widget`, [
        node("feature-record-viewer", "class", `${MUI}RecordViewerWidget`),
        view,
      ]),
    ];
  } else {
    // The input shape is the root, while the view displays the transcoder
    // reachable through mui:accepts. Both accepted shape and widget types
    // are regular FCT relationship/class constraints.
    children = [
      node("feature-input-shape", "class", `${MUI}InputShape`),
      node("feature-transcoder-accepts", "property-of", `${MUI}accepts`, [
        node("feature-transcoder-type", "class", `${OTC}Transcoder`),
        node("feature-transcoder-provider", "class", `${MUI}Provider`),
        node("feature-transcoder-widget", "property", `${MUI}widget`, [node("feature-rdf-widget", "class", `${MUI}RdfTranscoderWidget`)]),
        view,
      ]),
    ];
  }
  return {
    name: "query",
    attributes: {
      xmlns: "http://openlinksw.com/services/facets/1.0",
      addr: `${graph}@${endpoint}`,
      graph,
      ...(tree.attributes.timeout ? { timeout: tree.attributes.timeout } : {}),
      ...(tree.attributes.order ? { order: tree.attributes.order } : {}),
    },
    children,
  };
}
