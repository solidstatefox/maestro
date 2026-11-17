import { assign, createActor, fromPromise, setup } from "xstate";

export type UriSuggestion = { uri: string; label: string; rdfType?: string };
type Executor = (signal: AbortSignal) => Promise<UriSuggestion[]>;
type Enricher = (items: UriSuggestion[], signal: AbortSignal) => Promise<Map<string, string>>;
type Context = {
  key: string;
  items: UriSuggestion[];
  error: string;
  execute: Executor | null;
  enrich: Enricher | null;
  popupOpen: boolean;
};
type Event =
  | { type: "FIND"; key: string; execute: Executor; enrich?: Enricher }
  | { type: "CLEAR" | "POPUP_OPEN" | "POPUP_CLOSE" };
const empty = (): Context => ({ key: "", items: [], error: "", execute: null, enrich: null, popupOpen: true });

/** One actor owns debounce, request cancellation, suggestion publication,
 * optional type enrichment, and popup visibility. No independent component
 * timers, duplicate React request state, or metadata request outside XState.
 * Selecting the signal mode belongs to the separate root breadcrumb actor. */
export const maestroUriAutocompleteMachine = setup({
  types: { context: {} as Context, events: {} as Event },
  actors: {
    find: fromPromise(async ({ input, signal }: { input: { execute: Executor }; signal: AbortSignal }) => input.execute(signal)),
    enrich: fromPromise(async ({ input, signal }: { input: { items: UriSuggestion[]; enrich: Enricher | null }; signal: AbortSignal }) =>
      input.enrich && input.items.length ? input.enrich(input.items, signal) : new Map<string, string>()),
  },
}).createMachine({
  id: "maestro-root-uri-autocomplete", initial: "idle", context: empty,
  on: {
    CLEAR: { target: ".idle", actions: assign(({ context }) => ({ ...empty(), popupOpen: context.popupOpen })) },
    FIND: { target: ".debouncing", actions: assign(({ context, event }) => ({
      ...empty(), key: event.key, execute: event.execute, enrich: event.enrich ?? null,
      popupOpen: context.popupOpen,
    })) },
    POPUP_OPEN: { actions: assign({ popupOpen: true }) },
    POPUP_CLOSE: { actions: assign({ popupOpen: false }) },
  },
  states: {
    idle: {},
    debouncing: { after: { 280: { target: "loading" } } },
    loading: { invoke: {
      src: "find", input: ({ context }) => ({ execute: context.execute! }),
      onDone: { target: "ready", actions: assign(({ event }) => ({ items: event.output, error: "", execute: null })) },
      onError: { target: "failed", actions: assign(({ event }) => ({ items: [],
        error: event.error instanceof Error ? event.error.message : String(event.error), execute: null })) },
    } },
    // Suggestions are visible immediately. Type enrichment is an independent
    // invoked actor; leaving this state aborts it, and failure cannot conceal
    // ranked URI/label rows or change their ordering.
    ready: { invoke: {
      src: "enrich", input: ({ context }) => ({ items: context.items, enrich: context.enrich }),
      onDone: { target: "complete", actions: assign(({ context, event }) => ({
        items: context.items.map(item => ({ ...item, rdfType: event.output.get(item.uri) || item.rdfType })),
        enrich: null,
      })) },
      onError: { target: "complete", actions: assign({ enrich: null }) },
    } },
    complete: {},
    failed: {},
  },
});
const make = () => createActor(maestroUriAutocompleteMachine);
export function createUriAutocompleteController() {
  let actor: ReturnType<typeof make> | null = null;
  let snapshot = make().getSnapshot();
  let sub: { unsubscribe(): void } | undefined;
  const listeners = new Set<() => void>();
  const publish = () => { for(const listener of listeners) listener(); };
  return {
    start() { if(actor) return; actor=make(); sub=actor.subscribe(s=>{snapshot=s;publish();}); actor.start(); },
    stop() { sub?.unsubscribe(); actor?.stop(); actor=null; snapshot=make().getSnapshot(); publish(); },
    find(key: string, execute: Executor, enrich?: Enricher) { actor?.send({type:"FIND",key,execute,enrich}); },
    clear() { actor?.send({type:"CLEAR"}); },
    setOpen(open:boolean) { actor?.send({type:open?"POPUP_OPEN":"POPUP_CLOSE"}); },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => {listeners.delete(listener);}; },
  };
}
export function selectUriAutocomplete(s: ReturnType<ReturnType<typeof createUriAutocompleteController>["getSnapshot"]>, key: string) {
  const same=s.context.key===key;
  const ready = s.matches("ready") || s.matches("complete");
  return {
    items: same && ready ? s.context.items : [],
    loading: same && (s.matches("debouncing") || s.matches("loading")),
    ready: same && ready,
    typeLoading: same && s.matches("ready"),
    error: same && s.matches("failed") ? s.context.error : "",
    open: s.context.popupOpen,
  };
}
