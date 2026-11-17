import { assign, createActor, fromPromise, setup } from "xstate";

export type KindDiscoveryResult = Record<"property" | "role", string[]>;
type Context = { key: string; result: KindDiscoveryResult | null; error: string; execute: ((signal: AbortSignal) => Promise<KindDiscoveryResult>) | null };
type Event = { type: "EXECUTE"; key: string; execute: (signal: AbortSignal) => Promise<KindDiscoveryResult> } | { type: "CLEAR" };
const initial = (): Context => ({ key: "", result: null, error: "", execute: null });
/** A distinct invoked actor owns each exact query scope and its cancellation. */
export const maestroKindDiscoveryMachine = setup({
  types: { context: {} as Context, events: {} as Event },
  actors: { discover: fromPromise(async ({ input, signal }: { input: { execute: NonNullable<Context["execute"]> }; signal: AbortSignal }) => input.execute(signal)) },
}).createMachine({
  id: "maestro-kind-discovery", initial: "idle", context: initial,
  on: {
    CLEAR: { target: ".idle", actions: assign(initial) },
    EXECUTE: { target: ".loading", actions: assign(({ event }) => ({ ...initial(), key: event.key, execute: event.execute })) },
  },
  states: {
    idle: {},
    loading: { invoke: { src: "discover", input: ({ context }) => ({ execute: context.execute! }),
      onDone: { target: "ready", actions: assign(({ event }) => ({ result: event.output, error: "", execute: null })) },
      onError: { target: "failed", actions: assign(({ event }) => ({ result: null, error: event.error instanceof Error ? event.error.message : String(event.error), execute: null })) },
    } },
    ready: {}, failed: {},
  },
});
function freshActor() { return createActor(maestroKindDiscoveryMachine); }
export function createMaestroKindDiscoveryController() {
  let actor: ReturnType<typeof freshActor> | null = null;
  let snapshot = freshActor().getSnapshot();
  let subscription: { unsubscribe(): void } | null = null;
  const listeners = new Set<() => void>();
  const publish = () => { for(const listener of listeners) listener(); };
  return {
    start() { if(actor) return; actor=freshActor(); subscription=actor.subscribe(s=>{ snapshot=s; publish(); }); actor.start(); },
    stop() { subscription?.unsubscribe(); subscription=null; actor?.stop(); actor=null; snapshot=freshActor().getSnapshot(); publish(); },
    execute(key: string, run: NonNullable<Context["execute"]>) { actor?.send({type:"EXECUTE",key,execute:run}); },
    clear() { actor?.send({type:"CLEAR"}); },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
export function selectKinds(s: ReturnType<ReturnType<typeof createMaestroKindDiscoveryController>["getSnapshot"]>, key: string) {
  const same = s.context.key === key;
  return { loading: key !== "" && (!same || s.matches("loading")), ready: same && s.matches("ready"),
    error: same && s.matches("failed") ? s.context.error : "", availability: same && s.matches("ready") ? s.context.result : null };
}
