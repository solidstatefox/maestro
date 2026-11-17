"use client";
import { assign, createActor, fromPromise, setup } from "xstate";
import type { AnalysisProvider } from "@/lib/personal-sparql-reads";

type Executor = (signal: AbortSignal) => Promise<AnalysisProvider[]>;
type Context = { key: string; providers: AnalysisProvider[]; execute: Executor | null; error: string };
type Event = { type: "DISCOVER"; key: string; execute: Executor } | { type: "CANCEL" };
const empty = (): Context => ({ key: "", providers: [], execute: null, error: "" });
/** Analyze ribbons have an exact query/History/approval scope. An XState
 * invocation owns the request and aborts it when that scope is invalidated. */
export const maestroAnalyzeDiscoveryMachine = setup({
  types: { context: {} as Context, events: {} as Event },
  actors: { load: fromPromise(async ({ input, signal }: { input: { execute: Executor }; signal: AbortSignal }) => input.execute(signal)) },
}).createMachine({
  id: "maestro-analyze-discovery", initial: "inactive", context: empty,
  on: {
    DISCOVER: { target: ".loading", actions: assign(({ event }) => ({ ...empty(), key: event.key, execute: event.execute })) },
    CANCEL: { target: ".inactive", actions: assign(empty) },
  },
  states: {
    inactive: {},
    loading: { invoke: { src: "load", input: ({ context }) => ({ execute: context.execute! }),
      onDone: { target: "ready", actions: assign(({ event }) => ({ providers: event.output, error: "", execute: null })) },
      onError: { target: "failed", actions: assign(({ event }) => ({ providers: [], execute: null,
        error: event.error instanceof Error ? event.error.message : String(event.error) })) },
    } },
    ready: {}, failed: {},
  },
});
function fresh() { return createActor(maestroAnalyzeDiscoveryMachine); }
export function createMaestroAnalyzeDiscoveryController() {
  let actor: ReturnType<typeof fresh> | null = null;
  let snapshot = fresh().getSnapshot();
  let sub: { unsubscribe(): void } | null = null;
  const listeners = new Set<() => void>();
  const publish = () => { for (const cb of listeners) cb(); };
  return {
    start() { if (actor) return; actor = fresh(); sub = actor.subscribe(next => { snapshot = next; publish(); }); actor.start(); },
    stop() { sub?.unsubscribe(); sub = null; actor?.stop(); actor = null; snapshot = fresh().getSnapshot(); publish(); },
    discover(key: string, execute: Executor) { actor?.send({ type: "DISCOVER", key, execute }); },
    cancel() { actor?.send({ type: "CANCEL" }); },
    getSnapshot: () => snapshot,
    subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; },
  };
}
