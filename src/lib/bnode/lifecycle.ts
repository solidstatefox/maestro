import { assign, createActor, setup } from "xstate";

/** Only the already-decoded Record term type may activate this actor.
 * No population probe, extra server request, or repeated row scan. */
type RecordContext = { key: string; candidates: number; selected: number; incomplete: boolean };
type RecordEvent =
  | { type: "RECORD_SELECTED"; key: string; termType: string }
  | { type: "LOAD"; key: string }
  | { type: "CANDIDATES_RECEIVED"; key: string; count: number; incomplete: boolean }
  | { type: "CHOOSE"; key: string; index: number }
  | { type: "FAIL"; key: string }
  | { type: "RESET" };

const empty = (): RecordContext => ({ key: "", candidates: 0, selected: -1, incomplete: false });

export const maestroBlankNodeRecordMachine = setup({
  types: { context: {} as RecordContext, events: {} as RecordEvent },
  guards: {
    isBlankRecord: ({ event }) => event.type === "RECORD_SELECTED" && event.termType === "bnode",
    sameKey: ({ context, event }) => "key" in event && context.key === event.key,
    hasCandidates: ({ context, event }) => event.type === "CANDIDATES_RECEIVED" &&
      context.key === event.key && event.count > 0,
    chooseValid: ({ context, event }) => event.type === "CHOOSE" && context.key === event.key &&
      Number.isSafeInteger(event.index) && event.index >= 0 && event.index < context.candidates,
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
    eligible: { on: { LOAD: { guard: "sameKey", target: "loading" } } },
    loading: { on: {
      CANDIDATES_RECEIVED: [
        { guard: "hasCandidates", target: "ready", actions: assign(({ context, event }) =>
          // A first sibling is a UI default, NOT an identity claim. Keep the
          // user's previously chosen sibling index if still present on refresh.
          ({ candidates: event.count, incomplete: event.incomplete,
             selected: context.selected >= 0 && context.selected < event.count ? context.selected : 0 })) },
        { guard: "sameKey", target: "ambiguous", actions: assign(({ event }) =>
          event.type === "CANDIDATES_RECEIVED" ?
            ({ candidates: event.count, incomplete: event.incomplete, selected: -1 }) : {}) },
      ],
      FAIL: { guard: "sameKey", target: "failed" },
    } },
    ambiguous: { on: {
      LOAD: { guard: "sameKey", target: "loading" },
      CHOOSE: { guard: "chooseValid", target: "ready", actions: assign(({ event }) =>
        event.type === "CHOOSE" ? { selected: event.index } : {}) },
    } },
    ready: { on: {
      LOAD: { guard: "sameKey", target: "loading" },
      CHOOSE: { guard: "chooseValid", actions: assign(({ event }) =>
        event.type === "CHOOSE" ? { selected: event.index } : {}) },
    } },
    // Retry after failure without changing the selected RDF term or running a
    // population preflight. The existing key still guards request ownership.
    failed: { on: { LOAD: { guard: "sameKey", target: "loading" } } },
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
        snapshot.matches("ready") || snapshot.matches("ambiguous"))) return false;
      // Narrow the lazy actor once, so a concurrent stop/reset cannot leave
      // the closure dereferencing the nullable outer reference.
      const currentActor = actor;
      if (!currentActor) return false;
      currentActor.send({ type: "LOAD", key });
      return currentActor.getSnapshot().matches("loading");
    },
    received(count: number, incomplete: boolean) {
      actor?.send({ type: "CANDIDATES_RECEIVED", key, count, incomplete });
      return actor?.getSnapshot().context.selected ?? -1;
    },
    choose(index: number) {
      actor?.send({ type: "CHOOSE", key, index });
      return Boolean(actor?.getSnapshot().matches("ready") && actor.getSnapshot().context.selected === index);
    },
    fail() { actor?.send({ type: "FAIL", key }); },
    reset() { actor?.send({ type: "RESET" }); },
    stop() { actor?.stop(); actor = null; },
  };
}
