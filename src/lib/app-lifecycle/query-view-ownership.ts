import { assign, createActor, fromCallback, sendTo, setup } from "xstate";
import type { ProviderKind } from "@/lib/provider-catalog-xslt";

/** The foreground is a state-machine selection, not a display hint for a
 * transport watchdog. Each transition stops the invoked request-owner actor. */
export type MaestroQueryTab = "browse" | "view" | "analyze";
export type MaestroQueryViewSelection = {
  tab: MaestroQueryTab;
  viewPanel: "trail" | "perspectives" | "providers";
  viewProvider: ProviderKind | null;
  selectedViewUri: string;
  selectedAnalysisUri: string;
  histogram: boolean;
};
export type MaestroQueryViewOwner = Readonly<{ key: string; tab: MaestroQueryTab; ribbon: string }>;
export type MaestroLifecycleScope = "shared" | "record" | "personal";
export type MaestroQueryScope = Readonly<{ tab: MaestroQueryTab | MaestroLifecycleScope; ribbon: string }>;
export const SHARED_QUERY_SCOPE = { tab: "shared", ribbon: "query" } as const;
export const RECORD_QUERY_SCOPE = { tab: "record", ribbon: "session" } as const;
export const PERSONAL_QUERY_SCOPE = { tab: "personal", ribbon: "session" } as const;
export const lifecycleScope = (scope: MaestroQueryScope): MaestroLifecycleScope | null =>
  scope.tab === "shared" && scope.ribbon === "query" ? "shared" :
  (scope.tab === "record" || scope.tab === "personal") && scope.ribbon === "session" ? scope.tab : null;

export const DEFAULT_QUERY_VIEW_SELECTION: MaestroQueryViewSelection = {
  tab: "browse", viewPanel: "perspectives", viewProvider: null,
  selectedViewUri: "", selectedAnalysisUri: "", histogram: false,
};
export function maestroQueryViewOwner(selection: MaestroQueryViewSelection): MaestroQueryViewOwner {
  const { tab } = selection;
  if (tab === "browse") return { key: "browse", tab, ribbon: "browse" };
  if (tab === "view") {
    const ribbon = selection.viewPanel === "providers" ? `providers:${selection.viewProvider ?? "catalog"}`
      : selection.viewPanel === "perspectives" ? `perspectives:${selection.selectedViewUri || "default"}`
      : "trail";
    return { key: `view:${ribbon}`, tab, ribbon };
  }
  const ribbon = `${selection.selectedAnalysisUri || "default"}${selection.histogram ? ":histogram" : ""}`;
  return { key: `analyze:${ribbon}`, tab, ribbon };
}
export function maestroQueryScopeKey(scope: MaestroQueryScope): string {
  return scope.tab === "browse" && scope.ribbon === "browse" ? "browse" : `${scope.tab}:${scope.ribbon}`;
}
export function maestroViewClaimAllowed(active: MaestroQueryViewOwner, scope: MaestroQueryScope): boolean {
  return active.key === maestroQueryScopeKey(scope);
}
export function maestroOffstageError(): DOMException {
  return new DOMException("The view that owned this query is inactive", "AbortError");
}

type ExecuteRequest = {
  type: "EXECUTE";
  ownerKey: string;
  generation: number;
  signal?: AbortSignal | null;
  run: (signal: AbortSignal) => Promise<unknown>;
  resolve: (result: unknown) => void;
  reject: (reason: unknown) => void;
};
type Event = ExecuteRequest | { type: "NAVIGATE"; selection: MaestroQueryViewSelection }
  | { type: "CANCEL" } | { type: "RESUME" } | { type: "SET_READY"; ready: boolean } | { type: "QUERY_CHANGED" };
type Context = { selection: MaestroQueryViewSelection; owner: MaestroQueryViewOwner; generation: number; cancelled: boolean; ready: boolean };

/** The worker is an invoked XState actor: it *starts* every transport, owns
 * every AbortController, and stops all of them on its own state exit. React
 * may send a query intent, but it cannot dispatch a network request. */
const viewOperations = fromCallback<ExecuteRequest>(({ receive }) => {
  const running = new Set<AbortController>();
  receive((event) => {
    if (event.type !== "EXECUTE") return;
    if (event.signal?.aborted) { event.reject(maestroOffstageError()); return; }
    const controller = new AbortController();
    running.add(controller);
    const onAbort = () => controller.abort();
    event.signal?.addEventListener("abort", onAbort, { once: true });
    if (event.signal?.aborted) controller.abort();
    const rejectAborted = () => { finish(); event.reject(maestroOffstageError()); };
    const finish = () => { event.signal?.removeEventListener("abort", onAbort); controller.signal.removeEventListener("abort", rejectAborted); running.delete(controller); };
    if (controller.signal.aborted) { finish(); event.reject(maestroOffstageError()); return; }
    // Work is invoked inside the live child actor, never inside the transport's
    // queue-drain callback or a React effect. The worker owns cancellation.
    void Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return event.run(controller.signal);
    }).then((result) => {
      if (controller.signal.aborted) event.reject(maestroOffstageError());
      else event.resolve(result);
    }, event.reject).finally(finish);
    controller.signal.addEventListener("abort", rejectAborted, { once: true });
  });
  return () => { for (const controller of running) controller.abort(); running.clear(); };
});

export const maestroQueryViewMachine = setup({
  types: { context: {} as Context, events: {} as Event },
  actors: { operations: viewOperations },
}).createMachine({
  id: "maestro-workspace-view-execution", initial: "waiting",
  context: () => ({ selection: { ...DEFAULT_QUERY_VIEW_SELECTION }, owner: maestroQueryViewOwner(DEFAULT_QUERY_VIEW_SELECTION), generation: 0, cancelled: false, ready: false }),
  on: {
    NAVIGATE: [
      { guard: ({ context, event }) => context.owner.key === maestroQueryViewOwner(event.selection).key,
        actions: assign(({ event }) => ({ selection: { ...event.selection } })) },
      { guard: ({ context }) => context.cancelled,
        actions: assign(({ context, event }) => ({ selection: { ...event.selection }, owner: maestroQueryViewOwner(event.selection), generation: context.generation + 1, ready: false })) },
      { target: ".waiting", reenter: true, actions: assign(({ context, event }) => ({
        selection: { ...event.selection }, owner: maestroQueryViewOwner(event.selection), generation: context.generation + 1, ready: false,
      })) },
    ],
    SET_READY: [
      { guard: ({ context, event }) => !context.cancelled && event.ready, target: ".foreground",
        actions: assign({ ready: true }) },
      { guard: ({ context, event }) => !context.cancelled && !event.ready, target: ".waiting",
        actions: assign({ ready: false }) },
      { actions: assign(({ event }) => ({ ready: event.ready })) },
    ],
    QUERY_CHANGED: [
      { guard: ({context}) => !context.cancelled && context.ready, target: ".foreground", reenter: true, actions: assign(({context}) => ({generation:context.generation+1})) },
      { actions: assign(({context}) => ({generation:context.generation+1})) },
    ],
    CANCEL: { target: ".cancelled", actions: assign({ cancelled: true }) },
    RESUME: [
      { guard: ({ context }) => context.ready, target: ".foreground", reenter: true,
        actions: assign(({ context }) => ({ cancelled: false, generation: context.generation + 1 })) },
      { target: ".waiting", actions: assign(({ context }) => ({ cancelled: false, generation: context.generation + 1 })) },
    ],
  },
  states: {
    waiting: { on: { EXECUTE: { actions: ({ event }) => event.reject(maestroOffstageError()) } } },
    foreground: {
      invoke: { id: "view-operations", src: "operations" },
      on: {
        EXECUTE: [
          { guard: ({ context, event }) => !context.cancelled && event.ownerKey === context.owner.key && event.generation === context.generation,
            actions: sendTo("view-operations", ({ event }) => event) },
          { actions: ({ event }) => event.reject(maestroOffstageError()) },
        ],
      },
    },
    cancelled: { on: { EXECUTE: { actions: ({ event }) => event.reject(maestroOffstageError()) } } },
  },
});


type LifecycleEvent = ExecuteRequest | { type: "OBSERVE"; key: string; ready: boolean } | { type: "CANCEL" } | { type: "RESUME" };
type LifecycleContext = { key: string; ready: boolean; generation: number; cancelled: boolean };
/** Independent operation lifetime. Only an identity/readiness transition stops
 * its invoked worker. Navigation is deliberately not an event in this machine. */
export const maestroScopedOperationsMachine = setup({
  types: { context: {} as LifecycleContext, events: {} as LifecycleEvent },
  actors: { operations: viewOperations },
}).createMachine({
  id: "maestro-scoped-operations", initial: "waiting",
  context: { key: "", ready: false, generation: 0, cancelled: false },
  on: {
    OBSERVE: [
      { guard: ({context,event}) => context.key === event.key && context.ready === event.ready },
      { guard: ({context}) => context.cancelled, actions: assign(({context,event}) => ({key:event.key, ready:event.ready, generation:context.generation+1})) },
      { guard: ({event}) => Boolean(event.key && event.ready), target: ".active", reenter:true, actions: assign(({context,event}) => ({key:event.key,ready:true,generation:context.generation+1})) },
      { target: ".waiting", actions: assign(({context,event}) => ({key:event.key,ready:event.ready,generation:context.generation+1})) },
    ],
    CANCEL: { target: ".cancelled", actions: assign({cancelled:true}) },
    RESUME: [
      { guard: ({context}) => !context.cancelled },
      { guard: ({context}) => Boolean(context.key && context.ready), target: ".active", actions: assign(({context}) => ({cancelled:false,generation:context.generation+1})) },
      { target: ".waiting", actions: assign(({context}) => ({cancelled:false,generation:context.generation+1})) },
    ],
  },
  states: {
    waiting: {on:{EXECUTE:{actions:({event})=>event.reject(maestroOffstageError())}}},
    active: {invoke:{id:"scoped-operations",src:"operations"},on:{EXECUTE:[
      {guard:({context,event})=>event.generation===context.generation && event.ownerKey===context.key,
        actions:sendTo("scoped-operations",({event})=>event)},
      {actions:({event})=>event.reject(maestroOffstageError())},
    ]}},
    cancelled: {on:{EXECUTE:{actions:({event})=>event.reject(maestroOffstageError())}}},
  },
});
function scopedOperations() { return createActor(maestroScopedOperationsMachine); }

/** Each workspace constructs and starts its own supervisor. There is no
 * module-global actor or separate registry of stale offstage requests. */
export function createMaestroQueryViewCoordinator() {
  let actor = createActor(maestroQueryViewMachine);
  const createScopes = () => ({ shared: scopedOperations(), record: scopedOperations(), personal: scopedOperations() });
  let scopes = createScopes();
  const savedScopes: Record<MaestroLifecycleScope, {key:string;ready:boolean}> = {
    shared:{key:"",ready:false},record:{key:"",ready:false},personal:{key:"",ready:false},
  };
  let scopeSubscriptions: {unsubscribe():void}[] = [];
  let started = false;
  let stopped = false;
  let savedSelection: MaestroQueryViewSelection = { ...DEFAULT_QUERY_VIEW_SELECTION };
  let savedCancelled = false;
  let savedReady = false;
  const listeners = new Set<() => void>();
  let subscription: { unsubscribe(): void } | null = null;
  const notify = () => { for (const listener of listeners) listener(); };
  const ensureStarted = () => {
    if (stopped) throw maestroOffstageError();
    if (started) return;
    subscription = actor.subscribe(notify);
    actor.start();
    scopeSubscriptions = Object.values(scopes).map(child => child.subscribe(notify));
    for (const [name,child] of Object.entries(scopes)) {
      child.start();
      child.send({type:"OBSERVE",...savedScopes[name as MaestroLifecycleScope]});
      if (savedCancelled) child.send({type:"CANCEL"});
    }
    started = true;
  };
  return {
    start() {
      if (stopped) {
        actor = createActor(maestroQueryViewMachine);
        scopes = createScopes();
        stopped = false; started = false;
        ensureStarted();
        actor.send({ type: "NAVIGATE", selection: savedSelection });
        if (savedReady) actor.send({ type: "SET_READY", ready: true });
        if (savedCancelled) actor.send({ type: "CANCEL" });
      } else ensureStarted();
    },
    select(selection: MaestroQueryViewSelection): boolean {
      ensureStarted();
      const previous = actor.getSnapshot().context.selection;
      const old = actor.getSnapshot().context.owner.key;
      if (Object.keys(previous).every(key => previous[key as keyof MaestroQueryViewSelection] === selection[key as keyof MaestroQueryViewSelection])) return false;
      actor.send({ type: "NAVIGATE", selection });
      return actor.getSnapshot().context.owner.key !== old;
    },
    setReady(ready: boolean) { ensureStarted(); if(actor.getSnapshot().context.ready !== ready) actor.send({ type: "SET_READY", ready }); },
    observeScope(name: MaestroLifecycleScope, key: string, ready: boolean) {
      ensureStarted();
      const previous = savedScopes[name];
      if (previous.key === key && previous.ready === ready) return;
      savedScopes[name] = {key,ready};
      scopes[name].send({type:"OBSERVE",key,ready});
      if (name === "shared" && previous.key !== key) actor.send({type:"QUERY_CHANGED"});
    },
    isScopeReady(name: MaestroLifecycleScope) {return scopes[name].getSnapshot().matches("active");},
    ownsPendingKey(key: string) {
      if (key === "shared:query") return scopes.shared.getSnapshot().matches("active");
      if (key === "record:session") return scopes.record.getSnapshot().matches("active");
      if (key === "personal:session") return scopes.personal.getSnapshot().matches("active");
      return key === actor.getSnapshot().context.owner.key;
    },
    isReady: () => actor.getSnapshot().matches("foreground"),
    cancel() { ensureStarted(); if (actor.getSnapshot().context.cancelled) return; savedCancelled = true; actor.send({ type: "CANCEL" }); for (const child of Object.values(scopes)) child.send({type:"CANCEL"}); },
    resume() { ensureStarted(); if (!actor.getSnapshot().context.cancelled) return; savedCancelled = false; actor.send({ type: "RESUME" }); for (const child of Object.values(scopes)) child.send({type:"RESUME"}); },
    getActive: () => actor.getSnapshot().context.owner,
    getSelection: () => actor.getSnapshot().context.selection,
    getGeneration: () => actor.getSnapshot().context.generation,
    getSnapshot: () => actor.getSnapshot(),
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    execute<T>(scope: MaestroQueryScope, run: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal | null): Promise<T> {
      if (stopped || signal?.aborted) return Promise.reject(maestroOffstageError());
      ensureStarted();
      const ownedScope = lifecycleScope(scope);
      if (ownedScope) {
        const child = scopes[ownedScope], snapshot = child.getSnapshot();
        if (!snapshot.matches("active") || actor.getSnapshot().context.cancelled) return Promise.reject(maestroOffstageError());
        return new Promise<T>((resolve,reject)=>child.send({type:"EXECUTE",ownerKey:snapshot.context.key,generation:snapshot.context.generation,signal,
          run:run as (signal:AbortSignal)=>Promise<unknown>,resolve:resolve as (value:unknown)=>void,reject}));
      }
      const { owner, generation, cancelled } = actor.getSnapshot().context;
      if (cancelled || !actor.getSnapshot().matches("foreground") || !maestroViewClaimAllowed(owner, scope)) return Promise.reject(maestroOffstageError());
      return new Promise<T>((resolve, reject) => actor.send({
        type: "EXECUTE", ownerKey: owner.key, generation, signal,
        run: run as (signal: AbortSignal) => Promise<unknown>, resolve: resolve as (result: unknown) => void, reject,
      }));
    },
    stop() {
      if (stopped) return;
      savedSelection = actor.getSnapshot().context.selection;
      savedCancelled = actor.getSnapshot().context.cancelled;
      savedReady = actor.getSnapshot().context.ready;
      stopped = true; started = false;
      subscription?.unsubscribe(); subscription = null;
      for (const sub of scopeSubscriptions) sub.unsubscribe(); scopeSubscriptions = [];
      for (const child of Object.values(scopes)) child.stop();
      actor.stop(); notify();
    },
  };
}
export type MaestroQueryViewCoordinator = ReturnType<typeof createMaestroQueryViewCoordinator>;
