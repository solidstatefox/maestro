import { assign, createActor, fromPromise, setup } from "xstate";
import type { DiscoveredViewProvider } from "@/lib/personal-sparql-reads";

/** The scope owns the invocation. Leaving View, changing classes, or a new
 * session aborts a pending discovery; a late result cannot replace a new one. */
type Executor<T> = (signal: AbortSignal) => Promise<T[]>;
type Context<T> = { key: string; items: T[]; error: string; execute: Executor<T> | null };
type Event<T> = { type: "DISCOVER"; key: string; execute: Executor<T> } | { type: "INACTIVE" } | { type: "CANCEL" };
const blank = <T>(): Context<T> => ({ key: "", items: [], error: "", execute: null });
function makeViewDiscoveryMachine<T>() { return setup({
  types: { context: {} as Context<T>, events: {} as Event<T> },
  actors: { load: fromPromise(async ({ input, signal }: { input: { key: string; execute: Executor<T> }; signal: AbortSignal }) =>
    ({ key: input.key, items: await input.execute(signal) })) },
}).createMachine({
  id: "maestro-view-discovery", initial: "inactive", context: () => blank<T>(),
  on: {
    DISCOVER: { guard: ({ context, event }) => context.key !== event.key, target: ".loading", reenter: true, actions: assign(({ event }) => ({ key: event.key, execute: event.execute, items: [], error: "" })) },
    INACTIVE: { target: ".inactive", actions: assign(() => blank<T>()) },
  },
  states: {
    inactive: {},
    loading: { on: { CANCEL: { target: "cancelled", actions: assign({ execute: null }) } }, invoke: { src: "load", input: ({ context }) => ({ key: context.key, execute: context.execute! }),
      onDone: { target: "ready", actions: assign(({ event }) => ({ key: event.output.key, items: event.output.items, execute: null, error: "" })) },
      onError: { target: "failed", actions: assign(({ event }) => ({ execute: null,
        error: event.error instanceof Error ? event.error.message : "Could not discover Views." })) },
    } },
    ready: {}, failed: {}, cancelled: {},
  },
}); }
export const maestroViewDiscoveryMachine = makeViewDiscoveryMachine<DiscoveredViewProvider>();
export function createMaestroViewDiscoveryController<T = DiscoveredViewProvider>() {
  const machine = makeViewDiscoveryMachine<T>();
  const create = () => createActor(machine);
  let actor: ReturnType<typeof create> | null = null;
  let snapshot = create().getSnapshot();
  let subscription: { unsubscribe(): void } | null = null;
  const listeners = new Set<() => void>();
  const publish = () => { for (const listener of listeners) listener(); };
  return {
    start() { if (actor) return; actor = create(); subscription = actor.subscribe(next => { snapshot = next; publish(); }); actor.start(); },
    stop() { subscription?.unsubscribe(); subscription = null; actor?.stop(); actor = null; snapshot = create().getSnapshot(); publish(); },
    discover(key: string, execute: Executor<T>) { actor?.send({ type: "DISCOVER", key, execute }); },
    cancel() { actor?.send({ type: "CANCEL" }); },
    inactive() { actor?.send({ type: "INACTIVE" }); },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
