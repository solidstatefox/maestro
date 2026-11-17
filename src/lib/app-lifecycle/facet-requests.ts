import { assign, createActor, setup } from "xstate";

/** Independent FCT facet request lanes. The existing FCT proxy still executes
 * requests; XState owns their abort handles and scope-key settlement. A new
 * scope cancels only its own lane, never Properties vs Roles vs Categories vs
 * Graphs. Loaded partial/Anytime rows remain owned by the existing widgets. */
export type FacetLane = "properties" | "roles" | "categories" | "graphs";
export type FacetLanePhase = "idle" | "loading" | "ready" | "failed";
type Scope = { key: string; controller: AbortController | null; error: string };
type Context = Record<FacetLane, Scope>;
type Event =
  | { type: "FACET_STARTED"; lane: FacetLane; key: string; controller: AbortController }
  | { type: "FACET_SETTLED"; lane: FacetLane; key: string; error?: string }
  | { type: "FACET_CANCELLED"; lane: FacetLane; key: string }
  | { type: "FACETS_RESET" };
const blank = (): Scope => ({ key: "", controller: null, error: "" });
const initial = (): Context => ({ properties: blank(), roles: blank(), categories: blank(), graphs: blank() });
const abortScope = (scope: Scope) => scope.controller?.abort();

/** Keep all action and guard implementations inside setup() so XState 5
 * infers the declared union of events instead of widening them to EventObject.
 * Each parallel lane remains independently cancellable. */
const startLane = (context: Context, event: Event, name: FacetLane): Partial<Context> => {
  if (event.type !== "FACET_STARTED") return {};
  abortScope(context[name]);
  return { [name]: { key: event.key, controller: event.controller, error: "" } };
};
const settleLane = (context: Context, event: Event, name: FacetLane): Partial<Context> => {
  if (event.type !== "FACET_SETTLED") return {};
  return { [name]: { ...context[name], controller: null, error: event.error ?? "" } };
};
const cancelLane = (context: Context, name: FacetLane): Partial<Context> => {
  abortScope(context[name]);
  return { [name]: blank() };
};
const matches = (lane: FacetLane, context: Context, event: Event) =>
  "lane" in event && event.lane === lane && event.key === context[lane].key;

const facetMachineSetup = setup({
  types: { context: {} as Context, events: {} as Event },
  guards: {
    startProperties: ({ event }) => event.type === "FACET_STARTED" && event.lane === "properties",
    startRoles: ({ event }) => event.type === "FACET_STARTED" && event.lane === "roles",
    startCategories: ({ event }) => event.type === "FACET_STARTED" && event.lane === "categories",
    startGraphs: ({ event }) => event.type === "FACET_STARTED" && event.lane === "graphs",
    settlePropertiesError: ({ context, event }) => event.type === "FACET_SETTLED" && matches("properties", context, event) && Boolean(event.error),
    settleRolesError: ({ context, event }) => event.type === "FACET_SETTLED" && matches("roles", context, event) && Boolean(event.error),
    settleCategoriesError: ({ context, event }) => event.type === "FACET_SETTLED" && matches("categories", context, event) && Boolean(event.error),
    settleGraphsError: ({ context, event }) => event.type === "FACET_SETTLED" && matches("graphs", context, event) && Boolean(event.error),
    settleProperties: ({ context, event }) => event.type === "FACET_SETTLED" && matches("properties", context, event),
    settleRoles: ({ context, event }) => event.type === "FACET_SETTLED" && matches("roles", context, event),
    settleCategories: ({ context, event }) => event.type === "FACET_SETTLED" && matches("categories", context, event),
    settleGraphs: ({ context, event }) => event.type === "FACET_SETTLED" && matches("graphs", context, event),
    cancelProperties: ({ context, event }) => event.type === "FACET_CANCELLED" && matches("properties", context, event),
    cancelRoles: ({ context, event }) => event.type === "FACET_CANCELLED" && matches("roles", context, event),
    cancelCategories: ({ context, event }) => event.type === "FACET_CANCELLED" && matches("categories", context, event),
    cancelGraphs: ({ context, event }) => event.type === "FACET_CANCELLED" && matches("graphs", context, event),
  },
  actions: {
    startProperties: assign(({ context, event }) => startLane(context, event, "properties")),
    startRoles: assign(({ context, event }) => startLane(context, event, "roles")),
    startCategories: assign(({ context, event }) => startLane(context, event, "categories")),
    startGraphs: assign(({ context, event }) => startLane(context, event, "graphs")),
    settleProperties: assign(({ context, event }) => settleLane(context, event, "properties")),
    settleRoles: assign(({ context, event }) => settleLane(context, event, "roles")),
    settleCategories: assign(({ context, event }) => settleLane(context, event, "categories")),
    settleGraphs: assign(({ context, event }) => settleLane(context, event, "graphs")),
    cancelProperties: assign(({ context }) => cancelLane(context, "properties")),
    cancelRoles: assign(({ context }) => cancelLane(context, "roles")),
    cancelCategories: assign(({ context }) => cancelLane(context, "categories")),
    cancelGraphs: assign(({ context }) => cancelLane(context, "graphs")),
  },
});
const laneNames = {
  properties: { start: "startProperties", settle: "settleProperties", settleError: "settlePropertiesError", cancel: "cancelProperties" },
  roles: { start: "startRoles", settle: "settleRoles", settleError: "settleRolesError", cancel: "cancelRoles" },
  categories: { start: "startCategories", settle: "settleCategories", settleError: "settleCategoriesError", cancel: "cancelCategories" },
  graphs: { start: "startGraphs", settle: "settleGraphs", settleError: "settleGraphsError", cancel: "cancelGraphs" },
} as const;
const laneConfig = (name: FacetLane) => ({
  initial: "idle" as const,
  on: {
    FACET_STARTED: { guard: laneNames[name].start, target: ".loading", actions: laneNames[name].start },
    FACET_SETTLED: [
      { guard: laneNames[name].settleError, target: ".failed", actions: laneNames[name].settle },
      { guard: laneNames[name].settle, target: ".ready", actions: laneNames[name].settle },
    ],
    FACET_CANCELLED: { guard: laneNames[name].cancel, target: ".idle", actions: laneNames[name].cancel },
    FACETS_RESET: { target: ".idle", actions: laneNames[name].cancel },
  },
  states: { idle: {}, loading: {}, ready: {}, failed: {} },
});
export const maestroFacetRequestMachine = facetMachineSetup.createMachine({
  id: "maestro-parallel-facet-requests", type: "parallel", context: initial,
  states: {
    properties: laneConfig("properties"),
    roles: laneConfig("roles"),
    categories: laneConfig("categories"),
    graphs: laneConfig("graphs"),
  },
});
export function createMaestroFacetRequestController() {
  let actor: ReturnType<typeof createActor<typeof maestroFacetRequestMachine>> | null = null;
  const newActor = () => createActor(maestroFacetRequestMachine);
  return {
    startActor() { if (!actor) { actor = newActor(); actor.start(); } },
    stopActor() { actor?.send({ type: "FACETS_RESET" }); actor?.stop(); actor = null; },
    start(lane: FacetLane, key: string): AbortController {
      const controller = new AbortController();
      actor?.send({ type: "FACET_STARTED", lane, key, controller });
      return controller;
    },
    settle(lane: FacetLane, key: string, error?: string) { actor?.send({ type: "FACET_SETTLED", lane, key, error }); },
    cancel(lane: FacetLane, key: string) { actor?.send({ type: "FACET_CANCELLED", lane, key }); },
    reset() { actor?.send({ type: "FACETS_RESET" }); },
    snapshot: () => actor?.getSnapshot(),
  };
}
