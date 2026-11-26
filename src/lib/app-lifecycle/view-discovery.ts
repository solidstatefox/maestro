import { assign, createActor, fromPromise, setup } from "xstate";
import type { DiscoveredViewProvider } from "@/lib/personal-sparql-reads";

export type DiscoveryResult<T> = { items: T[]; warnings: string[] };
export type DiscoveryExecutor<T> = (signal: AbortSignal) => Promise<T[] | DiscoveryResult<T>>;
type Context<T> = { key: string; items: T[]; error: string; execute: DiscoveryExecutor<T> | null; waiting: string };
export type DiscoveryEvent<T> = { type: "DISCOVER"; key: string; execute: DiscoveryExecutor<T> } | { type: "WAIT"; key: string; reason: string } | { type: "INACTIVE" } | { type: "CANCEL" } | { type: "RETRY" };
const blank = <T>(): Context<T> => ({ key: "", items: [], error: "", execute: null, waiting: "" });
/** Shared invocation contract: same-key observations do not restart work;
 * explicit retry is the only same-key rearm. No wall clock competes with the
 * scheduler's execution budget. Transport timeouts are terminal outcomes. */
export function makeDiscoveryMachine<T>(id: string) { return setup({
  types: { context: {} as Context<T>, events: {} as DiscoveryEvent<T> },
  actors: { load: fromPromise(async ({ input, signal }: { input: { key: string; execute: DiscoveryExecutor<T> }; signal: AbortSignal }) => {
    const result = await input.execute(signal);
    signal.throwIfAborted();
    return { key: input.key, ...(Array.isArray(result) ? { items: result, warnings: [] } : result) };
  }) },
}).createMachine({
  id, initial: "inactive", context: () => blank<T>(),
  on: {
    DISCOVER: { guard: ({ context, event }) => context.key !== event.key || context.execute === null && Boolean(context.waiting), target: ".loading", reenter: true, actions: assign(({ event }) => ({ ...blank<T>(), key: event.key, execute: event.execute })) },
    WAIT: { guard: ({ context, event }) => context.key !== event.key || context.waiting !== event.reason, target: ".waiting", actions: assign(({ event }) => ({ ...blank<T>(), key: event.key, waiting: event.reason })) },
    INACTIVE: { target: ".inactive", actions: assign(() => blank<T>()) },
    CANCEL: { target: ".cancelled", actions: assign({ items: () => [], error: "", waiting: "" }) },
  },
  states: {
    inactive: {}, waiting: {},
    loading: { invoke: { src: "load", input: ({ context }) => ({ key: context.key, execute: context.execute! }),
      onDone: [
        { guard: ({ event }) => event.output.warnings.length > 0, target: "partial", actions: assign(({ event }) => ({ items: event.output.items, error: event.output.warnings.join("\n") })) },
        { target: "ready", actions: assign(({ event }) => ({ items: event.output.items, error: "" })) },
      ],
      onError: [
        { guard: ({ event }) => event.error instanceof Error && event.error.name === "TimeoutError", target: "timedOut", actions: assign(({ event }) => ({ error: String(event.error) })) },
        { target: "failed", actions: assign(({ event }) => ({ error: event.error instanceof Error ? event.error.message : String(event.error) })) },
      ],
    } },
    ready: {},
    partial: { on: { RETRY: { target: "loading", actions: assign({ error: "", items: () => [] }) } } },
    failed: { on: { RETRY: { target: "loading", actions: assign({ error: "", items: () => [] }) } } },
    timedOut: { on: { RETRY: { target: "loading", actions: assign({ error: "", items: () => [] }) } } },
    cancelled: {},
  },
}); }
export const maestroViewDiscoveryMachine = makeDiscoveryMachine<DiscoveredViewProvider>("maestro-view-discovery");
export function createMaestroViewDiscoveryController<T = DiscoveredViewProvider>(id = "maestro-view-discovery") {
  const machine = makeDiscoveryMachine<T>(id);
  const create = () => createActor(machine);
  let actor: ReturnType<typeof create> | null = null;
  let snapshot = create().getSnapshot();
  let subscription: { unsubscribe(): void } | null = null;
  const listeners = new Set<() => void>();
  const publish = () => { for (const listener of listeners) listener(); };
  return {
    start() { if (actor) return; actor = create(); subscription = actor.subscribe(next => { snapshot = next; publish(); }); actor.start(); },
    stop() { subscription?.unsubscribe(); subscription = null; actor?.stop(); actor = null; snapshot = create().getSnapshot(); publish(); },
    discover(key: string, execute: DiscoveryExecutor<T>) { actor?.send({ type: "DISCOVER", key, execute }); },
    wait(key: string, reason: string) { actor?.send({ type: "WAIT", key, reason }); },
    retry() { actor?.send({ type: "RETRY" }); },
    cancel() { actor?.send({ type: "CANCEL" }); },
    inactive() { actor?.send({ type: "INACTIVE" }); },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
