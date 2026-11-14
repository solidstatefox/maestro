/** Native FCT scopes for the five View > Features registries.
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
    // The policy registry must list policies regardless of personal mui:status.
    // Status is a separate optional facet, never a membership condition.
    children = [
      // ClassPolicy and Provider resources both qualify as policy definitions.
      // The FCT class filter is the registry membership condition.
      node("feature-policy-class", "class", `${MUI}ClassPolicy`),
      view,
    ];
  } else if (feature === "formats") {
    // Record formatters only: a provider must supply a RecordViewerWidget.
    children = [node("feature-provider", "class", `${MUI}Provider`),
      node("feature-record-widget", "property", `${MUI}widget`, [node("feature-record-type", "class", `${MUI}RecordViewerWidget`)]), view];
  } else if (feature === "fsm-providers") {
    children = [node("feature-fsm-provider", "class", `${MUI}StateMachineProvider`), view];
  } else if (feature === "curators") {
    children = [node("feature-curator", "class", `${MUI}CurationProvider`), view];
  } else if (feature === "facet-widgets") {
    // Keep the view on the provider; mui:widget is an additional filter.
    children = [
      node("feature-facet-provider", "class", `${MUI}Provider`),
      node("feature-facet-widget", "property", `${MUI}widget`, [
        node("feature-facet-widget-type", "class", `${MUI}FacetWidget`),
      ]),
      view,
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
      src: `urn:maestro:features:${feature}`,
      // Do not inherit source-query root attributes: the automatic History
      // bookmarks use this exact canonical Features query for every entry.
      // Per-widget timeouts are dispatched separately by the proxy.
    },
    children,
  };
}

/** Whether the live query already imposes this feature's identifying FCT
 * constraints. Keep user-added filters, offsets, breadcrumbs and history intact
 * rather than rebuilding an equivalent query every time a ribbon is visited.
 * Only constraints in the same scope count: a class on a different branch
 * must not masquerade as a feature query. */
export function hasFeatureFctFilters(tree: FctQueryTree, feature: FeatureKind, graph?: string, endpoint?: string): boolean {
  if (graph !== undefined && endpoint !== undefined && tree.attributes.addr !== `${graph}@${endpoint}`) return false;
  const hasClass = (nodes: FctQueryNode[], iri: string) =>
    nodes.some(item => item.name === "class" && item.attributes.iri === iri);
  const relation = (nodes: FctQueryNode[], kind: "property" | "property-of", iri: string) =>
    nodes.find(item => item.name === kind && item.attributes.iri === iri);
  const children = tree.children;
  if (feature === "policies") {
    return hasClass(children, `${MUI}ClassPolicy`);
  }
  if (feature === "formats") {
    const widget = relation(children, "property", `${MUI}widget`);
    return hasClass(children, `${MUI}Provider`) && Boolean(widget && hasClass(widget.children, `${MUI}RecordViewerWidget`));
  }
  if (feature === "fsm-providers") return hasClass(children, `${MUI}StateMachineProvider`);
  if (feature === "curators") return hasClass(children, `${MUI}CurationProvider`);
  if (feature === "facet-widgets") {
    const widget = relation(children, "property", `${MUI}widget`);
    return hasClass(children, `${MUI}Provider`) &&
      Boolean(widget && hasClass(widget.children, `${MUI}FacetWidget`));
  }
  const accepts = relation(children, "property-of", `${MUI}accepts`);
  if (!hasClass(children, `${MUI}InputShape`) || !accepts) return false;
  const widget = relation(accepts.children, "property", `${MUI}widget`);
  return hasClass(accepts.children, `${OTC}Transcoder`) &&
    hasClass(accepts.children, `${MUI}Provider`) &&
    Boolean(widget && hasClass(widget.children, `${MUI}RdfTranscoderWidget`));
}
