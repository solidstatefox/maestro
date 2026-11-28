"use client";

import { assign, createActor, fromPromise, setup } from "xstate";

/** Personal RDF initialization has one XState owner per workspace. The Digest
 * carrier remains independent and is never disconnected by a retry. */
export type PersonalInitialization = { signal: AbortSignal };
export type PersonalInitializationTask = (attempt: PersonalInitialization) => Promise<boolean>;
type Request = { sessionKey: string; attemptId: number; execute: PersonalInitializationTask };
type Context = { request: Request | null; stage: "idle" | "running" | "ready" | "failed"; error: string };
type Event = { type: "INITIALIZE"; request: Request } | { type: "CANCEL" };

export const maestroPersonalInitializationMachine = setup({
  types: { context: {} as Context, events: {} as Event },
  actors: {
    initialize: fromPromise(async ({ input, signal }: { input: Request; signal: AbortSignal }) => {
      signal.throwIfAborted();
      return input.execute({ signal });
    }),
  },
}).createMachine({
  id: "maestro-personal-initialization",
  initial: "idle",
  context: { request: null, stage: "idle", error: "" },
  on: {
    INITIALIZE: { target: ".running", reenter: true,
      actions: assign(({ event }) => ({ request: event.request, stage: "running" as const, error: "" })) },
    CANCEL: { target: ".idle", actions: assign({ request: null, stage: "idle" as const, error: "" }) },
  },
  states: {
    idle: {},
    running: { invoke: { src: "initialize", input: ({ context }) => context.request!,
      onDone: [
        { guard: ({ event }) => event.output === true, target: "ready", actions: assign({ stage: "ready" as const }) },
        { target: "idle", actions: assign({ stage: "idle" as const }) },
      ],
      onError: { target: "failed", actions: assign(({ event }) => ({
        stage: "failed" as const, error: event.error instanceof Error ? event.error.message : "Personal initialization failed.",
      })) },
    } },
    ready: {}, failed: {},
  },
});

/** A stopped actor is recreated for React Strict Mode. Each run has an
 * independent signal, and superseding it resolves the prior caller as false.
 * No module-global AbortController, revision, or shared task Promise. */
export function createPersonalInitializationController() {
  const newActor = () => createActor(maestroPersonalInitializationMachine);
  let actor: ReturnType<typeof newActor> | null = null;
  let activeId = 0;
  let resolvePending: ((value: boolean) => void) | null = null;
  const listeners = new Set<() => void>();
  let snapshot = newActor().getSnapshot();
  const publish = () => { for (const listener of listeners) listener(); };
  const settle = (value: boolean) => { const resolve = resolvePending; resolvePending = null; resolve?.(value); };
  const start = () => {
    if (actor) return;
    actor = newActor();
    actor.subscribe(next => {
      snapshot = next;publish();
      // Resolve callers only after XState has committed a terminal state.
      // This keeps awaited login/retry actions consistent with policy gates.
      if(next.context.request?.attemptId === activeId && next.value !== "running")
        settle(next.value === "ready");
    });
    actor.start();
  };
  const cancel = () => { ++activeId; settle(false); actor?.send({ type: "CANCEL" }); };
  return {
    start,
    cancel,
    stop() { cancel(); actor?.stop(); actor = null; snapshot = newActor().getSnapshot(); publish(); },
    run(sessionKey: string, execute: PersonalInitializationTask): Promise<boolean> {
      start();
      const attemptId = ++activeId;
      settle(false);
      const completed = new Promise<boolean>(resolve => { resolvePending = resolve; });
      actor!.send({ type: "INITIALIZE", request: { sessionKey, attemptId, execute } });
      return completed;
    },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
export type PersonalInitializationController = ReturnType<typeof createPersonalInitializationController>;
