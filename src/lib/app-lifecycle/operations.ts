import { assign, createActor, setup } from "xstate";

/** Phase C: the UI control plane, not a second query engine.
 * Graph health, FCT XML, aborts, and the proxy scheduler remain authoritative. */
export type GraphPhase = "unknown" | "checking" | "ready" | "unavailable";
export type QueryPhase = "restoring" | "restoreFailed" | "waitingForServer" | "readyToExecute" | "executing" | "ready" | "failed" | "cancelled";
export type RequestPhase = "idle" | "queued" | "active";
export type NavigationTab = "browse" | "view" | "analyze";
export type NavigationViewPanel = "trail" | "perspectives" | "providers";
export type GraphEvent = {
  type: "GRAPH_OBSERVED"; key: string; registryReady: boolean;
  selected: boolean; ready: boolean; failed: boolean;
};
export type QueryEvent =
  | { type: "QUERY_OBSERVED"; key: string; hydrated: boolean; graphReady: boolean }
  | { type: "QUERY_RESTORE_FAILED"; key: string; error: string }
  | { type: "RESULTS_STARTED" | "RESULTS_SUCCEEDED" | "RESULTS_FAILED" | "RESULTS_CANCELLED"; key: string };
export type RequestEvent = { type: "REQUEST_ACTIVITY"; queued: number; active: number };
export type NavigationEvent =
  | { type: "NAVIGATION_OBSERVED"; key: string; url: string; hydrated: boolean;
      tab: NavigationTab; viewPanel: NavigationViewPanel; isProviderQuery: boolean; restoringHistory: boolean }
  | { type: "PROVIDERS_ENTRY_REQUESTED"; fromUrl: string }
  | { type: "RIBBON_ENTRY_FROM_BROWSE"; sourceKey: string; fromUrl: string }
  | { type: "FEATURES_ENTERED"; fromUrl: string }
  | { type: "PERSONAL_PERSPECTIVE_ENTERED"; fromUrl: string }
  | { type: "PROVIDERS_ENTRY_CANCELLED" }
  | { type: "BROWSE_QUERY_DISPLACED"; sourceKey: string }
  | { type: "CONTEXT_RETURNED" }
  | { type: "HISTORY_NAVIGATION_PENDING"; direction: "backward" | "forward" | null };
export type MaestroOperationsEvent = GraphEvent | QueryEvent | RequestEvent | NavigationEvent;

type GraphContext = { key: string };
type QueryContext = { key: string; hydrated: boolean; graphReady: boolean; restoreError: string };
type RequestContext = { queued: number; active: number };
type NavigationContext = {
  key: string; lastUrl: string; returnUrl: string; pendingEntryUrl: string;
  browseQueryKey: string; browseUrl: string;
  hydrated: boolean; isProviderQuery: boolean; tab: NavigationTab; viewPanel: NavigationViewPanel;
  returnVisible: boolean; historyPending: "backward" | "forward" | null;
};
const emptyGraph: GraphContext = { key: "" };
const emptyQuery: QueryContext = { key: "", hydrated: false, graphReady: false, restoreError: "" };
const emptyRequests: RequestContext = { queued: 0, active: 0 };
const emptyNavigation: NavigationContext = {
  key: "", lastUrl: "", returnUrl: "", pendingEntryUrl: "",
  browseQueryKey: "", browseUrl: "",
  hydrated: false, isProviderQuery: false, tab: "browse", viewPanel: "trail",
  returnVisible: false, historyPending: null,
};

const graphMachine = setup({
  types: { context: {} as GraphContext, events: {} as GraphEvent },
}).createMachine({
  id: "maestro-graph-readiness", initial: "unknown", context: emptyGraph,
  on: { GRAPH_OBSERVED: [
    { guard: ({ event }) => !event.selected || !event.registryReady, target: ".checking",
      actions: assign(({ event }) => ({ key: event.key })) },
    { guard: ({ event }) => event.ready, target: ".ready",
      actions: assign(({ event }) => ({ key: event.key })) },
    { guard: ({ event }) => event.failed, target: ".unavailable",
      actions: assign(({ event }) => ({ key: event.key })) },
    { target: ".checking", actions: assign(({ event }) => ({ key: event.key })) },
  ] },
  states: { unknown: {}, checking: {}, ready: {}, unavailable: {} },
});

const queryMachine = setup({
  types: { context: {} as QueryContext, events: {} as QueryEvent },
}).createMachine({
  id: "maestro-query-lifecycle", initial: "restoring", context: emptyQuery,
  on: {
    QUERY_OBSERVED: [
      // A failed URL restore must not be turned back into an infinite spinner
      // just because graph observations or another React render arrive.
      { guard: ({ context, event }) => !event.hydrated && context.key === event.key && Boolean(context.restoreError),
        target: ".restoreFailed",
        actions: assign(({ event }) => ({ key: event.key, hydrated: false, graphReady: event.graphReady })) },
      { guard: ({ event }) => !event.hydrated, target: ".restoring",
        actions: assign(({ event }) => ({ key: event.key, hydrated: false, graphReady: event.graphReady, restoreError: "" })) },
      { guard: ({ event }) => !event.graphReady, target: ".waitingForServer",
        actions: assign(({ event }) => ({ key: event.key, hydrated: true, graphReady: false, restoreError: "" })) },
      { guard: ({ context, event }) => context.key !== event.key || !context.hydrated || !context.graphReady,
        target: ".readyToExecute",
        actions: assign(({ event }) => ({ key: event.key, hydrated: true, graphReady: true, restoreError: "" })) },
      { actions: assign(({ event }) => ({ key: event.key, hydrated: event.hydrated, graphReady: event.graphReady, restoreError: "" })) },
    ],
    QUERY_RESTORE_FAILED: {
      guard: ({ context, event }) => !context.hydrated && Boolean(event.error),
      target: ".restoreFailed",
      actions: assign(({ event }) => ({ key: event.key, restoreError: event.error, hydrated: false })),
    },
    RESULTS_STARTED: {
      guard: ({ context, event }) => context.key === event.key && context.hydrated && context.graphReady,
      target: ".executing",
    },
  },
  states: {
    restoring: {}, restoreFailed: {}, waitingForServer: {}, readyToExecute: {},
    executing: { on: {
      RESULTS_SUCCEEDED: { guard: ({ context, event }) => context.key === event.key, target: "ready" },
      RESULTS_FAILED: { guard: ({ context, event }) => context.key === event.key, target: "failed" },
      RESULTS_CANCELLED: { guard: ({ context, event }) => context.key === event.key, target: "cancelled" },
    } },
    ready: {}, failed: {}, cancelled: {},
  },
});

const requestsMachine = setup({
  types: { context: {} as RequestContext, events: {} as RequestEvent },
}).createMachine({
  id: "maestro-request-observer", initial: "idle", context: emptyRequests,
  on: { REQUEST_ACTIVITY: [
    { guard: ({ event }) => event.active > 0, target: ".active",
      actions: assign(({ event }) => ({ queued: Math.max(0, event.queued), active: Math.max(0, event.active) })) },
    { guard: ({ event }) => event.queued > 0, target: ".queued",
      actions: assign(({ event }) => ({ queued: Math.max(0, event.queued), active: Math.max(0, event.active) })) },
    { target: ".idle", actions: assign({ queued: 0, active: 0 }) },
  ] },
  states: { idle: {}, queued: {}, active: {} },
});

function observeNavigation(
  context: NavigationContext,
  event: Extract<NavigationEvent, { type: "NAVIGATION_OBSERVED" }>,
): Partial<NavigationContext> {
  if (!event.hydrated) return { hydrated: false, returnUrl: "", pendingEntryUrl: "", returnVisible: false, browseQueryKey: "", browseUrl: "" };
  // Record a real Browse query, even after the user opens the View ribbon
  // without changing the live query. A ribbon query is NEVER a return target.
  const newBrowse = event.tab === "browse" && !event.isProviderQuery && !event.restoringHistory;
  const providerCommitted = event.isProviderQuery && !event.restoringHistory &&
    Boolean(context.pendingEntryUrl) && event.key !== context.key;
  // Before Features opens, an unrelated Browse navigation invalidates the
  // earlier candidate. Once Features activates Return, only an explicit
  // Return click (or a new URL/hydration) may clear that session.
  const abandoned = newBrowse && !context.returnVisible && Boolean(context.returnUrl) &&
    event.key !== context.browseQueryKey;
  return {
    key: event.key, lastUrl: event.url, hydrated: true, tab: event.tab, viewPanel: event.viewPanel, isProviderQuery: event.isProviderQuery,
    browseQueryKey: newBrowse ? event.key : context.browseQueryKey,
    browseUrl: newBrowse ? event.url : context.browseUrl,
    returnUrl: abandoned ? "" : providerCommitted ? context.pendingEntryUrl : context.returnUrl,
    pendingEntryUrl: providerCommitted || abandoned ? "" : context.pendingEntryUrl,
    // A mere navigation observation must never start Return. Only the
    // explicit FEATURES_ENTERED event may open the persistent XState session.
    returnVisible: context.returnVisible,
  };
}
const navigationMachine = setup({
  types: { context: {} as NavigationContext, events: {} as NavigationEvent },
}).createMachine({
  id: "maestro-navigation", initial: "restoring", context: emptyNavigation,
  // Return is a persistent XState session. Entering View > Features starts
  // it; changing tabs, ribbons, or the live query does NOT end it. Only the
  // Return action (CONTEXT_RETURNED) or fresh URL hydration resets it.
  on: {
    NAVIGATION_OBSERVED: [
      { guard: ({ event }) => !event.hydrated, target: ".restoring",
        actions: assign(({ context, event }) => observeNavigation(context, event)) },
      { guard: ({ event }) => event.tab === "browse", target: ".browse",
        actions: assign(({ context, event }) => observeNavigation(context, event)) },
      { guard: ({ event }) => event.tab === "view", target: ".view",
        actions: assign(({ context, event }) => observeNavigation(context, event)) },
      { target: ".analyze", actions: assign(({ context, event }) => observeNavigation(context, event)) },
    ],
    FEATURES_ENTERED: {
      // An explicit View > Features selection starts Return immediately,
      // even before a provider query finishes loading (or if none matches).
      // Re-entering Features must never overwrite the original destination.
      guard: ({ context, event }) => context.hydrated && !context.returnVisible && Boolean(event.fromUrl),
      actions: assign(({ context, event }) => ({
        returnUrl: context.returnUrl || context.pendingEntryUrl || context.browseUrl || event.fromUrl,
        pendingEntryUrl: "",
        returnVisible: true,
      })),
    },
    PERSONAL_PERSPECTIVE_ENTERED: {
      // An explicit Bookmarks or History selection starts Return immediately,
      // even before a provider query finishes loading (or if none matches).
      // Re-entering a personal Perspective must never overwrite the original destination.
      guard: ({ context, event }) => context.hydrated && !context.returnVisible && Boolean(event.fromUrl),
      actions: assign(({ context, event }) => ({
        returnUrl: context.returnUrl || context.pendingEntryUrl || context.browseUrl || event.fromUrl,
        pendingEntryUrl: "",
        returnVisible: true,
      })),
    },
    RIBBON_ENTRY_FROM_BROWSE: {
      // Capture a candidate Browse destination for later Features entry.
      // This does NOT start or display Return in other ribbons.
      guard: ({ context, event }) => context.hydrated && context.tab === "browse" &&
        !context.isProviderQuery && !context.returnUrl && Boolean(event.fromUrl) &&
        context.key === event.sourceKey && context.browseQueryKey === event.sourceKey,
      actions: assign(({ event }) => ({ returnUrl: event.fromUrl, pendingEntryUrl: "" })),
    },
    PROVIDERS_ENTRY_REQUESTED: {
      // A provider may displace a Bookmarks Perspective or an explicitly
      // selected non-Browse query, not only a Browse query. Preserve an
      // already-established Browse Return owner; otherwise capture the exact
      // currently displayed share URL, including ribbon and endpoint state.
      // The candidate becomes Return only after the replacement succeeds.
      guard: ({ context, event }) => context.hydrated && !context.returnUrl &&
        !context.pendingEntryUrl && !context.isProviderQuery && Boolean(event.fromUrl),
      actions: assign(({ context, event }) => ({
        pendingEntryUrl: context.key === context.browseQueryKey && context.browseUrl
          ? context.browseUrl : event.fromUrl,
      })),
    },
    PROVIDERS_ENTRY_CANCELLED: { actions: assign({ pendingEntryUrl: "" }) },
    BROWSE_QUERY_DISPLACED: {
      // Despite its historic event name this commits a displaced query of
      // *any* tab, provided the pending candidate belongs to the observed
      // source. Ribbon-to-ribbon transitions must not replace a Return owner.
      guard: ({ context, event }) => !context.returnUrl &&
        Boolean(context.pendingEntryUrl) && context.key === event.sourceKey,
      actions: assign(({ context }) => ({
        returnUrl: context.pendingEntryUrl, pendingEntryUrl: "",
      })),
    },
    CONTEXT_RETURNED: { actions: assign({ returnUrl: "", pendingEntryUrl: "", returnVisible: false }) },
    HISTORY_NAVIGATION_PENDING: { actions: assign(({ event }) => ({ historyPending: event.direction })) },
  },
  states: { restoring: {}, browse: {}, view: {}, analyze: {} },
});

const createGraphActor = () => createActor(graphMachine);
const createQueryActor = () => createActor(queryMachine);
const createRequestActor = () => createActor(requestsMachine);
const createNavigationActor = () => createActor(navigationMachine);
type GraphActor = ReturnType<typeof createGraphActor>;
type QueryActor = ReturnType<typeof createQueryActor>;
type RequestActor = ReturnType<typeof createRequestActor>;
type NavigationActor = ReturnType<typeof createNavigationActor>;

export type MaestroOperationsSnapshot = Readonly<{
  graph: Readonly<GraphContext & { phase: GraphPhase }>;
  query: Readonly<QueryContext & { phase: QueryPhase }>;
  requests: Readonly<RequestContext & { phase: RequestPhase }>;
  navigation: Readonly<NavigationContext & { phase: "restoring" | NavigationTab }>;
}>;
const initialSnapshot: MaestroOperationsSnapshot = Object.freeze({
  graph: Object.freeze({ ...emptyGraph, phase: "unknown" as const }),
  query: Object.freeze({ ...emptyQuery, phase: "restoring" as const }),
  requests: Object.freeze({ ...emptyRequests, phase: "idle" as const }),
  navigation: Object.freeze({ ...emptyNavigation, phase: "restoring" as const }),
});

/** Per-workspace actor registry. Actors are recreated after Strict Mode stop;
 * current facts are supplied again by the hook. No module-global UI state. */
export function createMaestroOperationsController() {
  let graph: GraphActor | null = null;
  let query: QueryActor | null = null;
  let requests: RequestActor | null = null;
  let navigation: NavigationActor | null = null;
  let snapshot: MaestroOperationsSnapshot = initialSnapshot;
  const listeners = new Set<() => void>();
  const subscriptions: Array<{ unsubscribe(): void }> = [];
  const publish = () => {
    if (!graph || !query || !requests || !navigation) return;
    const next: MaestroOperationsSnapshot = Object.freeze({
      graph: { ...graph.getSnapshot().context, phase: graph.getSnapshot().value as GraphPhase },
      query: { ...query.getSnapshot().context, phase: query.getSnapshot().value as QueryPhase },
      requests: { ...requests.getSnapshot().context, phase: requests.getSnapshot().value as RequestPhase },
      navigation: { ...navigation.getSnapshot().context, phase: navigation.getSnapshot().value as "restoring" | NavigationTab },
    });
    const same = (Object.keys(next) as Array<keyof typeof next>).every(domain =>
      (Object.keys(next[domain]) as Array<string>).every(field =>
        (next[domain] as unknown as Record<string, unknown>)[field] ===
        (snapshot[domain] as unknown as Record<string, unknown>)[field]));
    if (same) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };
  return {
    start() {
      if (graph) return;
      graph = createGraphActor(); query = createQueryActor(); requests = createRequestActor(); navigation = createNavigationActor();
      subscriptions.push(
        graph.subscribe(publish),
        query.subscribe(publish),
        requests.subscribe(publish),
        navigation.subscribe(publish),
      );
      for (const actor of [graph, query, requests, navigation]) actor.start();
      publish();
    },
    stop() {
      for (const subscription of subscriptions.splice(0)) subscription.unsubscribe();
      for (const actor of [graph, query, requests, navigation]) actor?.stop();
      graph = null; query = null; requests = null; navigation = null;
      snapshot = initialSnapshot;
      for (const listener of listeners) listener();
    },
    send(event: MaestroOperationsEvent) {
      if (event.type === "GRAPH_OBSERVED") {
        // Graph readiness is owned by graphMachine; do not duplicate its
        // transition rules in the controller's send path.
        const phase: GraphPhase = !event.selected || !event.registryReady ? "checking"
          : event.ready ? "ready" : event.failed ? "unavailable" : "checking";
        if (graph && (snapshot.graph.key !== event.key || snapshot.graph.phase !== phase)) graph.send(event);
      } else if (event.type === "QUERY_OBSERVED") {
        if (query && (snapshot.query.key !== event.key || snapshot.query.hydrated !== event.hydrated || snapshot.query.graphReady !== event.graphReady)) query.send(event);
      } else if (event.type === "REQUEST_ACTIVITY") {
        if (requests && (snapshot.requests.queued !== event.queued || snapshot.requests.active !== event.active)) requests.send(event);
      } else if (event.type === "NAVIGATION_OBSERVED") {
        if (navigation && (snapshot.navigation.key !== event.key || snapshot.navigation.lastUrl !== event.url || snapshot.navigation.hydrated !== event.hydrated || snapshot.navigation.tab !== event.tab || snapshot.navigation.viewPanel !== event.viewPanel || snapshot.navigation.isProviderQuery !== event.isProviderQuery)) navigation.send(event);
      } else if (event.type === "RIBBON_ENTRY_FROM_BROWSE" || event.type === "FEATURES_ENTERED" || event.type === "PERSONAL_PERSPECTIVE_ENTERED" || event.type === "PROVIDERS_ENTRY_REQUESTED" || event.type === "PROVIDERS_ENTRY_CANCELLED" || event.type === "BROWSE_QUERY_DISPLACED" || event.type === "CONTEXT_RETURNED" || event.type === "HISTORY_NAVIGATION_PENDING") {
        navigation?.send(event);
      } else {
        query?.send(event);
      }
    },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
export type MaestroOperationsController = ReturnType<typeof createMaestroOperationsController>;

/** Identity checks close gates immediately, even before React observes a query
 * or graph switch. No extra query revision counters or SPARQL parsing. */
export function selectMaestroExecution(snapshot: MaestroOperationsSnapshot, input: {
  graphKey: string; queryKey: string; hydrated: boolean; sourceReady: boolean;
}) {
  const graphReady = input.sourceReady && snapshot.graph.phase === "ready" && snapshot.graph.key === input.graphKey;
  return {
    canExecuteQuery: input.hydrated && graphReady && snapshot.query.key === input.queryKey &&
      snapshot.query.graphReady && snapshot.query.hydrated &&
      snapshot.query.phase !== "restoring" && snapshot.query.phase !== "restoreFailed" && snapshot.query.phase !== "waitingForServer",
    queryPhase: snapshot.query.key === input.queryKey ? snapshot.query.phase : "waitingForServer" as QueryPhase,
    graphPhase: snapshot.graph.key === input.graphKey ? snapshot.graph.phase : "checking" as GraphPhase,
  };
}
