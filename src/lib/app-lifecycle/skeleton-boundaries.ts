import type { GraphPhase, QueryPhase, NavigationTab } from "./operations";

/** Display projections only: FCT results, endpoint health and Record data remain authoritative.
 * These selectors never launch work, mutate a query, or create a competing XState actor. */
export type LoadingBoundary = "loading" | "ready" | "error" | "degraded";
export type WorkspaceSkeletonBoundaries = Readonly<{
  shell: LoadingBoundary;
  graphSelector: LoadingBoundary;
  facets: LoadingBoundary;
  results: LoadingBoundary;
  record: LoadingBoundary;
}>;
export type WorkspaceSkeletonFacts = Readonly<{
  hydrated: boolean;
  tab: NavigationTab;
  graphPhase: GraphPhase;
  queryPhase: QueryPhase;
  registryReady: boolean;
  endpointReady: boolean;
  endpointFailed: boolean;
  discoveryPending?: boolean;
  discoveryFailed?: boolean;
  facetsLoading: boolean;
  facetContentPresent: boolean;
  facetFailed: boolean;
  initialQueryStarted: boolean;
  recordSelected: boolean;
  recordLoading: boolean;
  recordReady: boolean;
  recordFailed: boolean;
}>;

export function selectWorkspaceSkeletonBoundaries(facts: WorkspaceSkeletonFacts): WorkspaceSkeletonBoundaries {
  const shell: LoadingBoundary = facts.hydrated ? "ready" : "loading";
  // The selector can show a spinner, but hydrated content panes do not depend
  // on that spinner: health checks and retries keep their empty furniture.
  const graphSelector: LoadingBoundary = !facts.registryReady
    ? facts.endpointFailed ? "error" : "loading"
    : facts.endpointReady ? "ready" : facts.endpointFailed || facts.graphPhase === "unavailable" ? "error" : "loading";
  // Once hydration is complete, both checking and unavailable graph servers
  // project the stable zero-data panes. A retry does not reintroduce a skeleton.
  const graphNotReady = shell === "ready" && graphSelector !== "ready";
  // Named-graph discovery is a query-scope prerequisite, NOT a failed server
  // health check. A green selector remains ready even when auto-fill times out.
  const discoveryBlocked = facts.discoveryPending === true;
  // Discovery errors are advisory. A successful health check, not optional
  // graph enumeration, determines whether browsing is permitted.
  const facets: LoadingBoundary = shell === "loading" ? "loading"
    : graphNotReady ? "degraded"
    : discoveryBlocked || (facts.facetsLoading && !facts.facetContentPresent && !facts.facetFailed) ? "loading" : "ready";
  // Browse relies on the selected server and the live-query subscriber. View and
  // Analyze retain their own content/empty/error handling and are not suppressed
  // by unrelated personal-store discovery or an endpoint health probe.
  const results: LoadingBoundary = shell === "loading" ? "loading"
    : facts.tab !== "browse" ? "ready"
    : graphNotReady ? "degraded"
    : discoveryBlocked || facts.queryPhase === "readyToExecute" ||
      (!facts.initialQueryStarted && (facts.queryPhase === "restoring" ||
       facts.queryPhase === "waitingForServer")) ? "loading" : "ready";
  // No selected Record means an empty Record pane, not a loading skeleton.
  const record: LoadingBoundary = shell === "loading" ? "loading"
    : facts.tab === "browse" && graphNotReady ? "degraded"
    : !facts.recordSelected || facts.tab !== "browse" ? "ready"
    : facts.recordReady ? "ready"
    : facts.recordFailed ? "error"
    : facts.recordLoading ? "loading" : "ready";
  return { shell, graphSelector, facets, results, record };
}


/** The left pane is two different surfaces. The skeleton uses the same persisted
 * `defaultLeftTab` projection as the live pane; it never mixes Configure
 * Properties/Roles with the Filters' Status/Categories/Graphs/Personal widgets.
 * Widget names are already resolved from the authoritative live FCT scope. */
export type LeftSkeletonPane = "facets" | "personal" | "community";
export type LeftSkeletonWidget = Readonly<{ key: string; title: string; rows: number }>;
export type LeftPaneSkeletonFacts = Readonly<{
  pane: LeftSkeletonPane;
  focusListOrder: "Properties" | "Roles";
  showStatus: boolean;
  showPropertyUsage: boolean;
  focusWidgetsSuppressed: boolean;
  transported: readonly Readonly<{ key: string; title: string }>[];
  personalRoles: readonly Readonly<{ key: string; title: string }>[];
  personalProperties: readonly Readonly<{ key: string; title: string }>[];
}>;

export function selectLeftPaneSkeletonWidgets(facts: LeftPaneSkeletonFacts): readonly LeftSkeletonWidget[] {
  if (facts.pane === "community") return [];
  if (facts.pane === "facets") {
    const configure = [
      { key: "configure:Properties", title: "Properties", rows: 4 },
      { key: "configure:Roles", title: "Roles", rows: 3 },
    ];
    return facts.focusListOrder === "Roles" ? configure.reverse() : configure;
  }
  const widgets: LeftSkeletonWidget[] = [];
  if (facts.showStatus) widgets.push({ key: "filters:status", title: "Status", rows: 3 });
  for (const transported of facts.transported) {
    widgets.push({ key: `filters:transported:${transported.key}`, title: transported.title, rows: 3 });
  }
  if (facts.showPropertyUsage) {
    widgets.push({ key: "filters:property-usage:subject", title: "Subjects", rows: 3 });
    widgets.push({ key: "filters:property-usage:object", title: "Objects", rows: 3 });
  }
  widgets.push({ key: "filters:categories", title: "Categories", rows: 5 });
  if (!facts.focusWidgetsSuppressed) {
    for (const role of facts.personalRoles) {
      widgets.push({ key: `filters:role:${role.key}`, title: role.title, rows: 3 });
    }
    const propertyKeys = new Set<string>();
    for (const property of facts.personalProperties) {
      if (propertyKeys.has(property.key)) continue;
      propertyKeys.add(property.key);
      widgets.push({ key: `filters:property:${property.key}`, title: property.title, rows: 4 });
    }
  }
  widgets.push({ key: "filters:graphs", title: "Graphs", rows: 4 });
  return widgets;
}
