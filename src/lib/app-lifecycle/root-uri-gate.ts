import { assign, createActor, setup } from "xstate";
import { isRootUriOrPrefix, parseRootUri } from "@/lib/root-uri-policy";

type GateEvent = { type: "EDIT" | "COMMIT"; value: string };
type GateContext = { draft: string; committedUri: string | null };
const initial = (): GateContext => ({ draft: "", committedUri: null });

/** Browser XState guard for the URI signal. Typing never creates an FCT node;
 * only a COMMIT reaching accepted may authorize <value datatype="uri">.
 * A rejected free-text draft must never be converted to <text> either. */
export const maestroRootUriGateMachine = setup({
  types: { context: {} as GateContext, events: {} as GateEvent },
  actions: {
    setDraft: assign(({ event }) => ({ draft: event.value })),
    setAccepted: assign(({ event }) => ({ draft: event.value, committedUri: parseRootUri(event.value) })),
  },
}).createMachine({
  id: "maestro-root-uri-signal-gate", initial: "empty", context: initial,
  on: {
    EDIT: [
      { guard: ({ event }) => !event.value.trim(), target: ".empty", actions: "setDraft" },
      { guard: ({ event }) => parseRootUri(event.value) !== null, target: ".valid", actions: "setDraft" },
      { guard: ({ event }) => isRootUriOrPrefix(event.value), target: ".prefix", actions: "setDraft" },
      { target: ".searching", actions: "setDraft" },
    ],
    COMMIT: [
      { guard: ({ event }) => !event.value.trim(), target: ".empty", actions: assign(({ event }) => ({ draft: event.value, committedUri: null })) },
      { guard: ({ event }) => parseRootUri(event.value) !== null, target: ".accepted", actions: "setAccepted" },
      { target: ".rejected", actions: "setDraft" },
    ],
  },
  states: { empty: {}, searching: {}, prefix: {}, valid: {}, accepted: {}, rejected: {} },
});

const make = () => createActor(maestroRootUriGateMachine);
export type RootUriGateState = "empty" | "searching" | "prefix" | "valid" | "accepted" | "rejected";
export type RootUriDecision = { kind: "accepted"; uri: string } | { kind: "cleared" } | { kind: "rejected" };

/** StrictMode-safe actor wrapper. Mirrors the existing autocomplete controller. */
export function createRootUriGateController() {
  let actor: ReturnType<typeof make> | null = null;
  let snapshot = make().getSnapshot();
  let subscription: { unsubscribe(): void } | undefined;
  const listeners = new Set<() => void>();
  const publish = () => { for (const callback of listeners) callback(); };
  return {
    start() { if (actor) return; actor = make(); subscription = actor.subscribe(next => { snapshot = next; publish(); }); actor.start(); },
    stop() { subscription?.unsubscribe(); actor?.stop(); actor = null; snapshot = make().getSnapshot(); publish(); },
    edit(value: string) { if (actor && actor.getSnapshot().context.draft !== value) actor.send({ type: "EDIT", value }); },
    commit(value: string): RootUriDecision {
      if (!actor) return { kind: "rejected" };
      actor.send({ type: "COMMIT", value });
      const next = actor.getSnapshot();
      if (next.matches("accepted")) {
        const uri = next.context.committedUri;
        return uri ? { kind: "accepted", uri } : { kind: "rejected" };
      }
      return next.matches("empty") ? { kind: "cleared" } : { kind: "rejected" };
    },
    getSnapshot: () => snapshot,
    subscribe(callback: () => void) { listeners.add(callback); return () => { listeners.delete(callback); }; },
  };
}

export function rootUriGateState(snapshot: ReturnType<ReturnType<typeof createRootUriGateController>["getSnapshot"]>): RootUriGateState {
  return snapshot.value as RootUriGateState;
}
