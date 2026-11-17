import { assign, createActor, fromPromise, setup } from "xstate";

/** Navigation is one abortable transaction. All awaits must check signal before
 * committing the new live FCT tree; source query data remain authoritative. */
export type NavigationJob = (signal: AbortSignal) => Promise<void>;
type Context = { key: string; job: NavigationJob | null; error: string };
type Event = { type: "RUN"; key: string; job: NavigationJob } | { type: "CANCEL" };
const empty = (): Context => ({ key: "", job: null, error: "" });
export const maestroNavigationTransactionMachine = setup({
  types: { context: {} as Context, events: {} as Event },
  actors: { execute: fromPromise(async ({ input, signal }: { input: { key: string; job: NavigationJob }; signal: AbortSignal }) => {
    await input.job(signal);
    return input.key;
  }) },
}).createMachine({
  id: "maestro-navigation-transaction", initial: "idle", context: empty,
  on: {
    RUN: { target: ".running", actions: assign(({ event }) => ({ key: event.key, job: event.job, error: "" })) },
    CANCEL: { target: ".idle", actions: assign(() => empty()) },
  },
  states: {
    idle: {},
    running: { invoke: { src: "execute", input: ({ context }) => ({ key: context.key, job: context.job! }),
      onDone: { target: "ready", actions: assign({ job: null, error: "" }) },
      onError: { target: "failed", actions: assign(({ event }) => ({ job: null,
        error: event.error instanceof Error ? event.error.message : "Could not restore the requested query." })) },
    } },
    ready: {}, failed: {},
  },
});
export function createMaestroNavigationTransactionController() {
  const create = () => createActor(maestroNavigationTransactionMachine);
  let actor: ReturnType<typeof create> | null = null;
  let snapshot = create().getSnapshot();
  let subscription: { unsubscribe(): void } | null = null;
  const listeners = new Set<() => void>();
  const publish = () => { for (const listener of listeners) listener(); };
  return {
    start() { if (actor) return; actor = create(); subscription = actor.subscribe(next => { snapshot = next; publish(); }); actor.start(); },
    stop() { subscription?.unsubscribe(); subscription = null; actor?.stop(); actor = null; snapshot = create().getSnapshot(); publish(); },
    run(key: string, job: NavigationJob) { actor?.send({ type: "RUN", key, job }); },
    cancel() { actor?.send({ type: "CANCEL" }); },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
