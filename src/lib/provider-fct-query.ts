/** Native FCT scopes for the five View > Providers registries.
 * These are real <query> trees dispatched by the normal FCT engine. The
 * catalog SPARQL endpoint may enrich their RDF subjects with descriptions,
 * but it never chooses which subjects appear in the Providers result list.
 * The <view> carrier is deliberately positioned so Trail and left facets
 * describe precisely the resources shown by the Providers view. */
import type { FctQueryNode, FctQueryTree } from "@/lib/fct-query-api";
import type { ProviderKind } from "@/lib/provider-catalog-xslt";

const MUI = "gttp://ggg.maestro.ecosys/ns/ui#";
const OTC = "gttp://ggg.openlink.sw/nlp/transcoder#";
const VIEW: FctQueryNode = { id: "query-view", name: "view", attributes: { type: "list", limit: "30", offset: "0" }, children: [] };
const node = (id: string, name: string, iri: string, children: FctQueryNode[] = []): FctQueryNode => ({ id, name, attributes: { iri }, children });

export function providerFctQuery(tree: FctQueryTree, providerKind: ProviderKind, graph: string, endpoint: string, limit: number): FctQueryTree {
  const view = { ...VIEW, attributes: { ...VIEW.attributes, limit: String(Math.min(500, Math.max(1, Math.trunc(limit) || 30))) } };
  let children: FctQueryNode[];
  if (providerKind === "policies") {
    // The policy registry must list policies regardless of personal mui:status.
    // Status is a separate optional facet, never a membership condition.
    children = [
      // ClassPolicy and Provider resources both qualify as policy definitions.
      // The FCT class filter is the registry membership condition.
      node("provider-policy-class", "class", `${MUI}ClassPolicy`),
      view,
    ];
  } else if (providerKind === "formats") {
    // Record formatters only: a provider must supply a RecordViewerWidget.
    children = [node("provider-provider", "class", `${MUI}Provider`),
      node("provider-record-widget", "property", `${MUI}widget`, [node("provider-record-type", "class", `${MUI}RecordViewerWidget`)]), view];
  } else if (providerKind === "perspectives") {
    // All PerspectiveWidget providers, including Map and personal collections.
    // Provider approval remains independent of contextual applicability.
    children = [node("provider-perspective-provider", "class", `${MUI}Provider`),
      node("provider-perspective-widget", "property", `${MUI}widget`, [node("provider-perspective-widget-type", "class", `${MUI}PerspectiveWidget`)]), view];
  } else if (providerKind === "analysis-providers") {
    // The provider is the result, not its widget. Spider and the bookmark
    // Analyze tools are ma:Analysis + mui:Provider in the policies graph.
    // Ordinary ma:Analysis resources without mui:Provider are not approvable.
    children = [node("provider-analysis-provider", "class", `${MUI}Provider`),
      node("provider-analysis-type", "class", "gttp://ggg.maestro.ecosys/ns/analyze#Analysis"), view];
  } else if (providerKind === "fsm-providers") {
    children = [node("provider-fsm-provider", "class", `${MUI}StateMachineProvider`), view];
  } else if (providerKind === "kinds") {
    children = [node("provider-kinds", "class", `${MUI}KindProvider`), view];
  } else if (providerKind === "curators") {
    children = [node("provider-curator", "class", `${MUI}CurationProvider`), view];
  } else if (providerKind === "facet-widgets") {
    // The catalog lists the facet PROVIDERS themselves. A nested constraint on
    // mui:widget's class previously excluded valid providers in FCT. RDF
    // declares facet-provider membership explicitly; applicability is SHACL.
    children = [node("provider-facet-provider", "class", `${MUI}FacetProvider`), view];
  } else {
    // The transcoder itself is the provider shown in Results. The former
    // InputShape -> inverse mui:accepts -> Transcoder projection needlessly
    // required complex inverse-role FCT translation before any provider could
    // appear and could fail with HTTP 400. A regular type facet enumerates all
    // registered Transcoder resources from the designated OTC named graph;
    // acceptance/applicability remain separate from catalog membership.
    children = [node("provider-transcoder-type", "class", `${OTC}Transcoder`), view];
  }

  return {
    name: "query",
    attributes: {
      xmlns: "http://openlinksw.com/services/facets/1.0",
      addr: `${graph}@${endpoint}`,
      graph,
      src: `urn:maestro:providers:${providerKind}`,
      // Do not inherit source-query root attributes: the automatic History
      // bookmarks use this exact canonical Providers query for every entry.
      // Per-widget timeouts are dispatched separately by the proxy.
    },
    children,
  };
}

/** Whether the live query already imposes this providerKind's identifying FCT
 * constraints. Keep user-added filters, offsets, breadcrumbs and history intact
 * rather than rebuilding an equivalent query every time a ribbon is visited.
 * Only constraints in the same scope count: a class on a different branch
 * must not masquerade as a providerKind query. */
export function hasProviderFctFilters(tree: FctQueryTree, providerKind: ProviderKind, graph?: string, endpoint?: string): boolean {
  if (graph !== undefined && endpoint !== undefined && tree.attributes.addr !== `${graph}@${endpoint}`) return false;
  const hasClass = (nodes: FctQueryNode[], iri: string) =>
    nodes.some(item => item.name === "class" && item.attributes.iri === iri);
  const relation = (nodes: FctQueryNode[], kind: "property" | "property-of", iri: string) =>
    nodes.find(item => item.name === kind && item.attributes.iri === iri);
  const children = tree.children;
  if (providerKind === "policies") {
    return hasClass(children, `${MUI}ClassPolicy`);
  }
  if (providerKind === "formats") {
    const widget = relation(children, "property", `${MUI}widget`);
    return hasClass(children, `${MUI}Provider`) && Boolean(widget && hasClass(widget.children, `${MUI}RecordViewerWidget`));
  }
  if (providerKind === "perspectives") {
    const widget = relation(children, "property", `${MUI}widget`);
    return hasClass(children, `${MUI}Provider`) && Boolean(widget && hasClass(widget.children, `${MUI}PerspectiveWidget`));
  }
  if (providerKind === "analysis-providers") return hasClass(children, `${MUI}Provider`) &&
    hasClass(children, "gttp://ggg.maestro.ecosys/ns/analyze#Analysis");
  if (providerKind === "fsm-providers") return hasClass(children, `${MUI}StateMachineProvider`);
  if (providerKind === "curators") return hasClass(children, `${MUI}CurationProvider`);
  if (providerKind === "kinds") return hasClass(children, `${MUI}KindProvider`);
  if (providerKind === "facet-widgets") return hasClass(children, `${MUI}FacetProvider`);
  return hasClass(children, `${OTC}Transcoder`);
}
