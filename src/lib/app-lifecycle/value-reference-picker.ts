"use client";
import { assign, createActor, setup } from "xstate";

export type ReferenceDraft = {
  parentId: string;
  valueId: string | null;
  mode: "from" | "fromView" | "constant";
  targetId: string;
  text: string;
  datatype: string;
  lang: string;
  op: string;
};

type PickerContext = { draft: ReferenceDraft | null };
type PickerEvent =
  | { type: "OPEN"; draft: ReferenceDraft }
  | { type: "CHANGE"; patch: Partial<ReferenceDraft> }
  | { type: "START_PICK" }
  | { type: "PICK"; targetId: string }
  | { type: "CANCEL_PICK" }
  | { type: "CLOSE" };

/** One XState-owned draft lifecycle: selecting a target never edits FCT.
 * Only an explicit Apply from the dialog is allowed to call the query API. */
export const maestroReferencePickerMachine = setup({
  types: { context: {} as PickerContext, events: {} as PickerEvent },
  actions: {
    open: assign(({ event }) => ({ draft: event.type === "OPEN" ? event.draft : null })),
    update: assign(({ context, event }) => ({
      draft: context.draft && event.type === "CHANGE" ? { ...context.draft, ...event.patch } : context.draft,
    })),
    pick: assign(({ context, event }) => ({
      draft: context.draft && event.type === "PICK" ? { ...context.draft, targetId: event.targetId } : context.draft,
    })),
    close: assign({ draft: null }),
  },
}).createMachine({
  id: "maestro-link-a-value-picker",
  initial: "idle",
  context: { draft: null },
  on: { OPEN: { target: ".editing", actions: "open" }, CLOSE: { target: ".idle", actions: "close" } },
  states: {
    idle: {},
    editing: {
      on: {
        CHANGE: { actions: "update" },
        START_PICK: { guard: ({ context }) => Boolean(context.draft && context.draft.mode !== "constant"), target: "pickingReferenceTarget" },
      },
    },
    pickingReferenceTarget: {
      on: {
        PICK: { guard: ({ event }) => Boolean(event.targetId.trim()), target: "editing", actions: "pick" },
        CANCEL_PICK: { target: "editing" },
      },
    },
  },
});

const fresh = () => createActor(maestroReferencePickerMachine);
export function createMaestroReferencePickerController() {
  let actor: ReturnType<typeof fresh> | null = null;
  let snapshot = fresh().getSnapshot();
  let subscription: { unsubscribe(): void } | null = null;
  const listeners = new Set<() => void>();
  const publish = () => { for (const cb of listeners) cb(); };
  return {
    start() { if (actor) return; actor = fresh(); subscription = actor.subscribe(s => { snapshot = s; publish(); }); actor.start(); },
    stop() { subscription?.unsubscribe(); subscription = null; actor?.stop(); actor = null; snapshot = fresh().getSnapshot(); publish(); },
    open(draft: ReferenceDraft) { actor?.send({ type: "OPEN", draft }); },
    change(patch: Partial<ReferenceDraft>) { actor?.send({ type: "CHANGE", patch }); },
    beginPicking() { actor?.send({ type: "START_PICK" }); },
    selectTarget(targetId: string) { actor?.send({ type: "PICK", targetId }); },
    cancelPicking() { actor?.send({ type: "CANCEL_PICK" }); },
    close() { actor?.send({ type: "CLOSE" }); },
    getSnapshot: () => snapshot,
    subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; },
  };
}
