import { assign, createActor, fromPromise, setup } from "xstate";

/** Phase D: one authoritative lifecycle for the current FCT-backed Providers catalog.
 * The live FCT tree owns membership; the catalog actor owns only request/render state.
 * Keys include the exact query, page, provider kind and approval projection. */
export type ProviderCatalogPhase = "inactive" | "waitingForResults" | "resolving" | "rendering" | "ready" | "empty" | "failed" | "cancelled";
export type ProviderCatalogResult = { html: string; count: number };
export type ProviderCatalogExecutor = (signal: AbortSignal) => Promise<ProviderCatalogResult>;
type CatalogContext = { key: string; html: string; count: number; error: string; inFlight: boolean; executor: ProviderCatalogExecutor | null };
export type ProviderCatalogEvent =
  | { type: "CATALOG_INACTIVE" }
  | { type: "CATALOG_EXECUTE"; key: string; execute: ProviderCatalogExecutor }
  | { type: "CATALOG_WAITING" | "CATALOG_STARTED" | "CATALOG_RENDERING" | "CATALOG_CANCELLED"; key: string }
  | { type: "CATALOG_RESOLVED"; key: string; html: string; count: number }
  | { type: "CATALOG_FAILED"; key: string; error: string };
const empty: CatalogContext = { key: "", html: "", count: 0, error: "", inFlight: false, executor: null };
export const maestroProviderCatalogMachine = setup({
  types: { context: {} as CatalogContext, events: {} as ProviderCatalogEvent },
  actors: { resolveCatalog: fromPromise(async ({ input, signal }: {
    input: { key: string; execute: ProviderCatalogExecutor }; signal: AbortSignal;
  }) => ({ key: input.key, ...await input.execute(signal) })) },
}).createMachine({
  id: "maestro-provider-catalog", initial: "inactive", context: empty,
  on: {
    CATALOG_INACTIVE: { target: ".inactive", actions: assign(() => ({ ...empty })) },
    CATALOG_WAITING: { target: ".waitingForResults", actions: assign(({ event }) => ({ ...empty, key: event.key })) },
    CATALOG_STARTED: { target: ".resolving", actions: assign(({ event }) => ({ ...empty, key: event.key, inFlight: true })) },
    // Actor exit automatically aborts the exact scoped job on provider/query change.
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
          error: event.error instanceof Error ? event.error.message : "Provider lookup failed.",
        })) },
      },
    },
  },
});
function newActor() { return createActor(maestroProviderCatalogMachine); }
export function createMaestroProviderCatalogController() {
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
    send(event: ProviderCatalogEvent) { actor?.send(event); },
    execute(key: string, run: ProviderCatalogExecutor) { actor?.send({ type: "CATALOG_EXECUTE", key, execute: run }); },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
export type MaestroProviderCatalogController = ReturnType<typeof createMaestroProviderCatalogController>;
export function selectProviderCatalog(snapshot: ReturnType<MaestroProviderCatalogController["getSnapshot"]>, key: string) {
  const matching = Boolean(key) && snapshot.context.key === key;
  const phase: ProviderCatalogPhase = matching
    ? snapshot.value === "executing" ? "resolving" : snapshot.value as ProviderCatalogPhase
    : key ? "waitingForResults" : "inactive";
  return {
    phase,
    loading: phase === "waitingForResults" || phase === "resolving" || phase === "rendering",
    html: matching && (phase === "ready" || phase === "empty") ? snapshot.context.html : "",
    count: matching && (phase === "ready" || phase === "empty") ? snapshot.context.count : 0,
    error: matching && phase === "failed" ? snapshot.context.error : "",
  };
}
