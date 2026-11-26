import { assign, createActor, setup } from "xstate";

/** Only the already-decoded Record term type may activate this actor.
 * No population probe, extra server request, or repeated row scan. */
type CandidateMembership = { candidate: boolean; parents: readonly string[] };
type RecordContext = { key: string; candidates: number; membership: readonly CandidateMembership[]; selected: number; seed: number; incomplete: boolean };
type RecordEvent =
  | { type: "RECORD_SELECTED"; key: string; termType: string }
  | { type: "LOAD"; key: string }
  | { type: "CANDIDATES_RECEIVED"; key: string; membership: readonly CandidateMembership[]; incomplete: boolean; initial: number }
  | { type: "CHOOSE"; key: string; index: number }
  | { type: "FAIL"; key: string }
  | { type: "RESET" };

const empty = (): RecordContext => ({ key: "", candidates: 0, membership: [], selected: -1, seed: -1, incomplete: false });

export const maestroBlankNodeRecordMachine = setup({
  types: { context: {} as RecordContext, events: {} as RecordEvent },
  guards: {
    isBlankRecord: ({ event }) => event.type === "RECORD_SELECTED" && event.termType === "bnode",
    sameKey: ({ context, event }) => "key" in event && context.key === event.key,
    chooseValid: ({ context, event }) => event.type === "CHOOSE" && context.key === event.key &&
      Number.isSafeInteger(event.index) && event.index >= 0 && event.index < context.candidates &&
      (event.index === context.seed || Boolean(context.membership[context.seed]?.parents.some(parent =>
        context.membership[event.index]?.parents.includes(parent)))),
    hasInitial: ({ context, event }) => event.type === "CANDIDATES_RECEIVED" && context.key === event.key &&
      Number.isSafeInteger(event.initial) && event.initial >= 0 && event.initial < event.membership.length &&
      event.membership[event.initial]?.candidate === true,
  },
}).createMachine({
  id: "maestro-blank-node-record", initial: "inactive", context: empty,
  on: {
    RECORD_SELECTED: [
      { guard: "isBlankRecord", target: ".eligible", actions: assign(({ event }) =>
        ({ ...empty(), key: event.key })) },
      { target: ".inactive", actions: assign(empty) },
    ],
    RESET: { target: ".inactive", actions: assign(empty) },
  },
  states: {
    inactive: {},
    eligible: { on: { LOAD: { guard: "sameKey", target: "loading", actions: assign(({ context }) => ({ ...empty(), key: context.key })) } } },
    loading: { on: {
      CANDIDATES_RECEIVED: [
        { guard: "hasInitial", target: "ready", actions: assign(({ event }) =>
          event.type === "CANDIDATES_RECEIVED" ?
            ({ candidates: event.membership.length, membership: event.membership, incomplete: event.incomplete, selected: event.initial, seed: event.initial }) : {}) },
        { guard: "sameKey", target: "failed" },
      ],
      FAIL: { guard: "sameKey", target: "failed" },
    } },
    ready: { on: {
      LOAD: { guard: "sameKey", target: "loading", actions: assign(({ context }) => ({ ...empty(), key: context.key })) },
      CHOOSE: { guard: "chooseValid", actions: assign(({ event }) =>
        event.type === "CHOOSE" ? { selected: event.index } : {}) },
    } },
    // Retry after failure without changing the selected RDF term or running a
    // population preflight. The existing key still guards request ownership.
    failed: { on: { LOAD: { guard: "sameKey", target: "loading", actions: assign(({ context }) => ({ ...empty(), key: context.key })) } } },
  },
});

/** Scoped runtime gate: callers cannot begin a blank-node Record operation
 * without the XState transition accepting a genuinely blank RDF term. */
export function createBlankNodeRecordContext() {
  // Lazy actor creation avoids a side effect during React render. A stopped
  // actor can be recreated after StrictMode's development effect replay.
  const newActor = () => createActor(maestroBlankNodeRecordMachine);
  let actor: ReturnType<typeof newActor> | null = null;
  const activeActor = () => {
    if (!actor) {
      actor = newActor();
      actor.start();
    }
    return actor;
  };
  let key = "";
  return {
    select(nextKey: string, termType: string) {
      key = nextKey;
      // Do not even create an XState actor for ordinary URI/literal Records.
      // The already-decoded term type is the only entry gate.
      if (termType === "bnode") activeActor().send({ type: "RECORD_SELECTED", key, termType });
      else actor?.send({ type: "RECORD_SELECTED", key, termType });
    },
    begin() {
      const snapshot = actor?.getSnapshot();
      if (!snapshot || !(snapshot.matches("eligible") || snapshot.matches("failed") ||
        snapshot.matches("ready"))) return false;
      // Narrow the lazy actor once, so a concurrent stop/reset cannot leave
      // the closure dereferencing the nullable outer reference.
      const currentActor = actor;
      if (!currentActor) return false;
      currentActor.send({ type: "LOAD", key });
      return currentActor.getSnapshot().matches("loading");
    },
    received(requestKey: string, membership: readonly CandidateMembership[], incomplete: boolean, initial: number) {
      if (requestKey !== key || !actor?.getSnapshot().matches("loading")) return -1;
      actor.send({ type: "CANDIDATES_RECEIVED", key: requestKey, membership: membership.map(({ candidate, parents }) => ({ candidate, parents: [...parents] })), incomplete, initial });
      const result = actor.getSnapshot();
      return result.matches("ready") ? result.context.selected : -1;
    },
    choose(index: number) {
      const current = actor?.getSnapshot();
      if (!current?.matches("ready")) return false;
      // Check the actual event before sending: a rejected event may leave the
      // previous selected index unchanged, which is not a successful choice.
      const event = { type: "CHOOSE" as const, key, index };
      if (!current.can(event)) return false;
      actor?.send(event);
      return Boolean(actor?.getSnapshot().matches("ready") && actor.getSnapshot().context.selected === index);
    },
    isChosen(index: number) { return Boolean(actor?.getSnapshot().matches("ready") && actor.getSnapshot().context.selected === index); },
    fail(requestKey: string) { actor?.send({ type: "FAIL", key: requestKey }); },
    reset() { actor?.send({ type: "RESET" }); },
    stop() { actor?.stop(); actor = null; },
  };
}
