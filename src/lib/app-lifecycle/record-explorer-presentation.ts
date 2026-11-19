import { createActor, setup } from "xstate";

/** Fullscreen Record presentation is independent from Browse query state and
 * from the keyed Record description/policy/format XState actors. Only the
 * explicit SET QUERY command in the explorer is allowed to commit its wand. */
export type RecordExplorerPresentationEvent =
  | { type: "EXPAND" } | { type: "SHRINK" }
  | { type: "POINTER" } | { type: "WAND" };

export const maestroRecordExplorerPresentationMachine = setup({
  types: { events: {} as RecordExplorerPresentationEvent },
}).createMachine({
  id: "maestro-record-explorer-presentation",
  initial: "browse",
  states: {
    browse: { on: { EXPAND: "fullscreen" } },
    fullscreen: {
      initial: "pointer",
      on: { SHRINK: "browse" },
      states: {
        pointer: { on: { WAND: "wand" } },
        wand: { on: { POINTER: "pointer" } },
      },
    },
  },
});

const freshActor = () => createActor(maestroRecordExplorerPresentationMachine);
export function createRecordExplorerPresentationController() {
  let actor: ReturnType<typeof freshActor> | null = null;
  let snapshot = freshActor().getSnapshot();
  let subscription: { unsubscribe(): void } | null = null;
  const listeners = new Set<() => void>();
  const publish = () => { for (const listener of listeners) listener(); };
  return {
    start() {
      if (actor) return;
      actor = freshActor();
      subscription = actor.subscribe(next => { snapshot = next; publish(); });
      actor.start();
    },
    stop() {
      subscription?.unsubscribe(); subscription = null;
      actor?.stop(); actor = null;
      snapshot = freshActor().getSnapshot(); publish();
    },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    expand() { actor?.send({ type: "EXPAND" }); },
    shrink() { actor?.send({ type: "SHRINK" }); },
    setMode(mode: "pointer" | "wand") { actor?.send({ type: mode === "wand" ? "WAND" : "POINTER" }); },
  };
}
export type RecordExplorerPresentationController = ReturnType<typeof createRecordExplorerPresentationController>;
