import { createActor, setup } from "xstate";

/** The user's category-format preference is a capability, not a second formatter. */
export const recordFormatMemoryMachine = setup({
  types: { events: {} as { type: "RESTORE"; pinned: boolean } | { type: "PIN" } | { type: "UNPIN" } },
}).createMachine({
  id: "record-format-memory",
  initial: "restoring",
  states: {
    restoring: { on: { RESTORE: [
      { guard: ({ event }) => event.pinned, target: "pinned" },
      { target: "unpinned" },
    ] } },
    unpinned: { on: { PIN: "pinned" } },
    pinned: { on: { UNPIN: "unpinned" } },
  },
});
const freshActor = () => createActor(recordFormatMemoryMachine);
export function createRecordFormatMemoryController() {
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
    isPinned: () => snapshot.matches("pinned"),
    // A lease is invalidated by any real mode transition or actor restart.
    // Keep async IndexedDB and formatter work outside the state machine.
    captureMode() {
      const captured = snapshot;
      const owner = actor;
      return {
        pinned: captured.matches("pinned"),
        ready: !captured.matches("restoring"),
        isCurrent: () => owner !== null && owner === actor && captured === snapshot,
      };
    },
    restore(pinned: boolean, isCurrent: () => boolean) {
      if (!actor || !snapshot.matches("restoring") || !isCurrent()) return false;
      actor.send({ type: "RESTORE", pinned });
      return true;
    },
    setPinned(pinned: boolean) {
      if (!actor || snapshot.matches("restoring")) return false;
      if (snapshot.matches("pinned") !== pinned) actor.send({ type: pinned ? "PIN" : "UNPIN" });
      return true;
    },
  };
}
