import { assign, createActor, setup } from "xstate";

/** Phase C: the UI control plane, not a second query engine.
 * Graph health, FCT XML, aborts, and the proxy scheduler remain authoritative. */
export type GraphPhase = "unknown" | "checking" | "ready" | "unavailable";
export type QueryPhase = "restoring" | "waitingForServer" | "readyToExecute" | "executing" | "ready" | "failed" | "cancelled";
export type RequestPhase = "idle" | "queued" | "active";
export type NavigationTab = "browse" | "view" | "analyze";
export type GraphEvent = {
  type: "GRAPH_OBSERVED"; key: string; registryReady: boolean;
  selected: boolean; ready: boolean; failed: boolean;
};
export type QueryEvent =
  | { type: "QUERY_OBSERVED"; key: string; hydrated: boolean; graphReady: boolean }
  | { type: "RESULTS_STARTED" | "RESULTS_SUCCEEDED" | "RESULTS_FAILED" | "RESULTS_CANCELLED"; key: string };
export type RequestEvent = { type: "REQUEST_ACTIVITY"; queued: number; active: number };
export type NavigationEvent =
  | { type: "NAVIGATION_OBSERVED"; key: string; url: string; hydrated: boolean;
      tab: NavigationTab; isProviderQuery: boolean; restoringHistory: boolean }
  | { type: "PROVIDERS_ENTRY_REQUESTED"; fromUrl: string }
  | { type: "RIBBON_ENTRY_FROM_BROWSE"; sourceKey: string; fromUrl: string }
  | { type: "PROVIDERS_ENTRY_CANCELLED" }
  | { type: "BROWSE_QUERY_DISPLACED"; sourceKey: string }
  | { type: "CONTEXT_RETURNED" }
  | { type: "HISTORY_NAVIGATION_PENDING"; direction: "backward" | "forward" | null };
export type MaestroOperationsEvent = GraphEvent | QueryEvent | RequestEvent | NavigationEvent;

type GraphContext = { key: string };
type QueryContext = { key: string; hydrated: boolean; graphReady: boolean };
type RequestContext = { queued: number; active: number };
type NavigationContext = {
  key: string; lastUrl: string; returnUrl: string; pendingEntryUrl: string;
  browseQueryKey: string; browseUrl: string;
  hydrated: boolean; isProviderQuery: boolean; tab: NavigationTab;
  historyPending: "backward" | "forward" | null;
};
const emptyGraph: GraphContext = { key: "" };
const emptyQuery: QueryContext = { key: "", hydrated: false, graphReady: false };
const emptyRequests: RequestContext = { queued: 0, active: 0 };
const emptyNavigation: NavigationContext = {
  key: "", lastUrl: "", returnUrl: "", pendingEntryUrl: "",
  browseQueryKey: "", browseUrl: "",
  hydrated: false, isProviderQuery: false, tab: "browse", historyPending: null,
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
      { guard: ({ event }) => !event.hydrated, target: ".restoring",
        actions: assign(({ event }) => ({ key: event.key, hydrated: event.hydrated, graphReady: event.graphReady })) },
      { guard: ({ event }) => !event.graphReady, target: ".waitingForServer",
        actions: assign(({ event }) => ({ key: event.key, hydrated: event.hydrated, graphReady: event.graphReady })) },
      { guard: ({ context, event }) => context.key !== event.key || !context.hydrated || !context.graphReady,
        target: ".readyToExecute",
        actions: assign(({ event }) => ({ key: event.key, hydrated: event.hydrated, graphReady: event.graphReady })) },
      { actions: assign(({ event }) => ({ key: event.key, hydrated: event.hydrated, graphReady: event.graphReady })) },
    ],
    RESULTS_STARTED: {
      guard: ({ context, event }) => context.key === event.key && context.hydrated && context.graphReady,
      target: ".executing",
    },
  },
  states: {
    restoring: {}, waitingForServer: {}, readyToExecute: {},
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
  if (!event.hydrated) return { hydrated: false, returnUrl: "" };
  // Record a real Browse query, even after the user opens the View ribbon
  // without changing the live query. A ribbon query is NEVER a return target.
  const newBrowse = event.tab === "browse" && !event.isProviderQuery && !event.restoringHistory;
  const providerCommitted = event.isProviderQuery && !event.restoringHistory &&
    Boolean(context.pendingEntryUrl) && Boolean(context.browseQueryKey) &&
    event.key !== context.browseQueryKey;
  // Leaving a displaced Browse query through an unrelated Browse navigation
  // abandons its Return entry. Ribbon-to-ribbon changes must not create one.
  const abandoned = newBrowse && Boolean(context.returnUrl) &&
    event.key !== context.browseQueryKey;
  return {
    key: event.key, lastUrl: event.url, hydrated: true, tab: event.tab, isProviderQuery: event.isProviderQuery,
    browseQueryKey: newBrowse ? event.key : context.browseQueryKey,
    browseUrl: newBrowse ? event.url : context.browseUrl,
    returnUrl: abandoned ? "" : providerCommitted ? context.pendingEntryUrl : context.returnUrl,
    pendingEntryUrl: providerCommitted || abandoned ? "" : context.pendingEntryUrl,
  };
}
const navigationMachine = setup({
  types: { context: {} as NavigationContext, events: {} as NavigationEvent },
}).createMachine({
  id: "maestro-navigation", initial: "restoring", context: emptyNavigation,
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
    RIBBON_ENTRY_FROM_BROWSE: {
      // The Return control appears on entry to any View/Analyze ribbon, not
      // only after a Provider FCT replacement. Keep its original Browse owner
      // across all ribbon-to-ribbon transitions.
      guard: ({ context, event }) => context.hydrated && context.tab === "browse" &&
        !context.isProviderQuery && !context.returnUrl && Boolean(event.fromUrl) &&
        context.key === event.sourceKey && context.browseQueryKey === event.sourceKey,
      actions: assign(({ event }) => ({ returnUrl: event.fromUrl, pendingEntryUrl: "" })),
    },
    PROVIDERS_ENTRY_REQUESTED: {
      // Only the original Browse live-query identity can own a Return. A tab
      // label is not a query identity: View/Analyze may have been opened before
      // the first provider was activated. Never capture a ribbon's own query.
      guard: ({ context }) => !context.returnUrl && !context.pendingEntryUrl &&
        !context.isProviderQuery && Boolean(context.browseUrl) &&
        context.key === context.browseQueryKey,
      actions: assign(({ context }) => ({ pendingEntryUrl: context.browseUrl })),
    },
    PROVIDERS_ENTRY_CANCELLED: { actions: assign({ pendingEntryUrl: "" }) },
    BROWSE_QUERY_DISPLACED: {
      // Do not wait for a post-commit NAVIGATION_OBSERVED effect. The Browse
      // query still owns the actor here; only its actual displacement creates
      // Return, and other View/Analyze queries cannot replace that target.
      guard: ({ context, event }) => !context.returnUrl && Boolean(context.browseUrl) &&
        context.browseQueryKey === event.sourceKey,
      actions: assign(({ context }) => ({ returnUrl: context.browseUrl, pendingEntryUrl: "" })),
    },
    CONTEXT_RETURNED: { actions: assign({ returnUrl: "", pendingEntryUrl: "" }) },
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
        graph?.send(event);
      } else if (event.type === "QUERY_OBSERVED") {
        if (query && (snapshot.query.key !== event.key || snapshot.query.hydrated !== event.hydrated || snapshot.query.graphReady !== event.graphReady)) query.send(event);
      } else if (event.type === "REQUEST_ACTIVITY") {
        if (requests && (snapshot.requests.queued !== event.queued || snapshot.requests.active !== event.active)) requests.send(event);
      } else if (event.type === "NAVIGATION_OBSERVED") {
        if (navigation && (snapshot.navigation.key !== event.key || snapshot.navigation.lastUrl !== event.url || snapshot.navigation.hydrated !== event.hydrated || snapshot.navigation.tab !== event.tab || snapshot.navigation.isProviderQuery !== event.isProviderQuery)) navigation.send(event);
      } else if (event.type === "RIBBON_ENTRY_FROM_BROWSE" || event.type === "PROVIDERS_ENTRY_REQUESTED" || event.type === "PROVIDERS_ENTRY_CANCELLED" || event.type === "BROWSE_QUERY_DISPLACED" || event.type === "CONTEXT_RETURNED" || event.type === "HISTORY_NAVIGATION_PENDING") {
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
      snapshot.query.phase !== "restoring" && snapshot.query.phase !== "waitingForServer",
    queryPhase: snapshot.query.key === input.queryKey ? snapshot.query.phase : "waitingForServer" as QueryPhase,
    graphPhase: snapshot.graph.key === input.graphKey ? snapshot.graph.phase : "checking" as GraphPhase,
  };
}
