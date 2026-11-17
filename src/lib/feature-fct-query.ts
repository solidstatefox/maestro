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
  } else if (feature === "perspectives") {
    // All PerspectiveWidget providers, including Map and personal collections.
    // Provider approval remains independent of contextual applicability.
    children = [node("feature-perspective-provider", "class", `${MUI}Provider`),
      node("feature-perspective-widget", "property", `${MUI}widget`, [node("feature-perspective-widget-type", "class", `${MUI}PerspectiveWidget`)]), view];
  } else if (feature === "analysis-providers") {
    // The provider is the result, not its widget. Spider and the bookmark
    // Analyze tools are ma:Analysis + mui:Provider in the policies graph.
    // Ordinary ma:Analysis resources without mui:Provider are not approvable.
    children = [node("feature-analysis-provider", "class", `${MUI}Provider`),
      node("feature-analysis-type", "class", "gttp://ggg.maestro.ecosys/ns/analyze#Analysis"), view];
  } else if (feature === "fsm-providers") {
    children = [node("feature-fsm-provider", "class", `${MUI}StateMachineProvider`), view];
  } else if (feature === "kinds") {
    children = [node("feature-kinds", "class", `${MUI}KindProvider`), view];
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
    // The transcoder itself is the provider shown in Results. The former
    // InputShape -> inverse mui:accepts -> Transcoder projection needlessly
    // required complex inverse-role FCT translation before any provider could
    // appear and could fail with HTTP 400. A regular type facet enumerates all
    // registered Transcoder resources from the designated OTC named graph;
    // acceptance/applicability remain separate from catalog membership.
    children = [node("feature-transcoder-type", "class", `${OTC}Transcoder`), view];
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
  if (feature === "perspectives") {
    const widget = relation(children, "property", `${MUI}widget`);
    return hasClass(children, `${MUI}Provider`) && Boolean(widget && hasClass(widget.children, `${MUI}PerspectiveWidget`));
  }
  if (feature === "analysis-providers") return hasClass(children, `${MUI}Provider`) &&
    hasClass(children, "gttp://ggg.maestro.ecosys/ns/analyze#Analysis");
  if (feature === "fsm-providers") return hasClass(children, `${MUI}StateMachineProvider`);
  if (feature === "curators") return hasClass(children, `${MUI}CurationProvider`);
  if (feature === "kinds") return hasClass(children, `${MUI}KindProvider`);
  if (feature === "facet-widgets") {
    const widget = relation(children, "property", `${MUI}widget`);
    return hasClass(children, `${MUI}Provider`) &&
      Boolean(widget && hasClass(widget.children, `${MUI}FacetWidget`));
  }
  return hasClass(children, `${OTC}Transcoder`);
}
