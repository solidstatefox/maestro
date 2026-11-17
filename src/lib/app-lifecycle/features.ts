import { assign, createActor, fromPromise, setup } from "xstate";

/** Phase D: one authoritative lifecycle for the current FCT-backed Features catalog.
 * The live FCT tree owns membership; the catalog actor owns only request/render state.
 * Keys include the exact query, page, feature kind and approval projection. */
export type FeatureCatalogPhase = "inactive" | "waitingForResults" | "resolving" | "rendering" | "ready" | "empty" | "failed" | "cancelled";
export type FeatureCatalogResult = { html: string; count: number };
export type FeatureCatalogExecutor = (signal: AbortSignal) => Promise<FeatureCatalogResult>;
type CatalogContext = { key: string; html: string; count: number; error: string; inFlight: boolean; executor: FeatureCatalogExecutor | null };
export type FeatureCatalogEvent =
  | { type: "CATALOG_INACTIVE" }
  | { type: "CATALOG_EXECUTE"; key: string; execute: FeatureCatalogExecutor }
  | { type: "CATALOG_WAITING" | "CATALOG_STARTED" | "CATALOG_RENDERING" | "CATALOG_CANCELLED"; key: string }
  | { type: "CATALOG_RESOLVED"; key: string; html: string; count: number }
  | { type: "CATALOG_FAILED"; key: string; error: string };
const empty: CatalogContext = { key: "", html: "", count: 0, error: "", inFlight: false, executor: null };
export const maestroFeatureCatalogMachine = setup({
  types: { context: {} as CatalogContext, events: {} as FeatureCatalogEvent },
  actors: { resolveCatalog: fromPromise(async ({ input, signal }: {
    input: { key: string; execute: FeatureCatalogExecutor }; signal: AbortSignal;
  }) => ({ key: input.key, ...await input.execute(signal) })) },
}).createMachine({
  id: "maestro-feature-catalog", initial: "inactive", context: empty,
  on: {
    CATALOG_INACTIVE: { target: ".inactive", actions: assign(() => ({ ...empty })) },
    CATALOG_WAITING: { target: ".waitingForResults", actions: assign(({ event }) => ({ ...empty, key: event.key })) },
    CATALOG_STARTED: { target: ".resolving", actions: assign(({ event }) => ({ ...empty, key: event.key, inFlight: true })) },
    // Actor exit automatically aborts the exact scoped job on feature/query change.
    CATALOG_EXECUTE: { target: ".executing", actions: assign(({ event }) => ({
      ...empty, key: event.key, inFlight: true, executor: event.execute,
    })) },
    CATALOG_RENDERING: { guard: ({ context, event }) => context.key === event.key && context.inFlight,
      target: ".rendering" },
    CATALOG_RESOLVED: [
      { guard: ({ context, event }) => context.key === event.key && context.inFlight && event.count > 0,
        target: ".ready", actions: assign(({ event }) => ({ html: event.html, count: event.count, error: "", inFlight: false })) },
      { guard: ({ context, event }) => context.key === event.key && context.inFlight,
        target: ".empty", actions: assign(({ event }) => ({ html: event.html, count: 0, error: "", inFlight: false })) },
    ],
    CATALOG_FAILED: { guard: ({ context, event }) => context.key === event.key && context.inFlight,
      target: ".failed", actions: assign(({ event }) => ({ html: "", count: 0, error: event.error, inFlight: false })) },
    CATALOG_CANCELLED: { guard: ({ context, event }) => context.key === event.key && context.inFlight,
      target: ".cancelled", actions: assign({ html: "", count: 0, error: "", inFlight: false }) },
  },
  states: {
    inactive: {}, waitingForResults: {}, resolving: {}, rendering: {}, ready: {}, empty: {}, failed: {}, cancelled: {},
    executing: {
      invoke: {
        src: "resolveCatalog",
        input: ({ context }) => ({ key: context.key, execute: context.executor! }),
        onDone: [
          { guard: ({ context, event }) => context.key === event.output.key && event.output.count > 0,
            target: "ready", actions: assign(({ event }) => ({ html: event.output.html, count: event.output.count, error: "", inFlight: false, executor: null })) },
          { target: "empty", actions: assign(({ event }) => ({ html: event.output.html, count: 0, error: "", inFlight: false, executor: null })) },
        ],
        onError: { target: "failed", actions: assign(({ event }) => ({
          html: "", count: 0, inFlight: false, executor: null,
          error: event.error instanceof Error ? event.error.message : "Feature lookup failed.",
        })) },
      },
    },
  },
});
function newActor() { return createActor(maestroFeatureCatalogMachine); }
export function createMaestroFeatureCatalogController() {
  let actor: ReturnType<typeof newActor> | null = null;
  let snapshot = newActor().getSnapshot();
  const listeners = new Set<() => void>();
  let subscription: { unsubscribe(): void } | null = null;
  const publish = () => { for (const listener of listeners) listener(); };
  return {
    start() {
      if (actor) return;
      actor = newActor();
      subscription = actor.subscribe(next => { snapshot = next; publish(); });
      actor.start();
    },
    stop() {
      subscription?.unsubscribe(); subscription = null;
      actor?.stop(); actor = null;
      snapshot = newActor().getSnapshot(); publish();
    },
    send(event: FeatureCatalogEvent) { actor?.send(event); },
    execute(key: string, run: FeatureCatalogExecutor) { actor?.send({ type: "CATALOG_EXECUTE", key, execute: run }); },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
export type MaestroFeatureCatalogController = ReturnType<typeof createMaestroFeatureCatalogController>;
export function selectFeatureCatalog(snapshot: ReturnType<MaestroFeatureCatalogController["getSnapshot"]>, key: string) {
  const matching = Boolean(key) && snapshot.context.key === key;
  const phase: FeatureCatalogPhase = matching
    ? snapshot.value === "executing" ? "resolving" : snapshot.value as FeatureCatalogPhase
    : key ? "waitingForResults" : "inactive";
  return {
    phase,
    loading: phase === "waitingForResults" || phase === "resolving" || phase === "rendering",
    html: matching && (phase === "ready" || phase === "empty") ? snapshot.context.html : "",
    count: matching && (phase === "ready" || phase === "empty") ? snapshot.context.count : 0,
    error: matching && phase === "failed" ? snapshot.context.error : "",
  };
}
