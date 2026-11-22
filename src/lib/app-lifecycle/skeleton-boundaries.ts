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
  // Hydrated panes are *always* mounted. The actual Categories, Results and
  // Record widgets own their individual queued/running/empty/error states and
  // the existing ElapsedStatus clocks. A separate skeleton must never replace
  // those widgets, hide an error, or unmount their timers on a health change.
  // During hydration only, the static shell is shown because no restored FCT
  // query or selected endpoint exists yet.
  const facets: LoadingBoundary = shell === "loading" ? "loading" : "ready";
  const results: LoadingBoundary = shell === "loading" ? "loading" : "ready";
  const record: LoadingBoundary = shell === "loading" ? "loading" : "ready";
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
