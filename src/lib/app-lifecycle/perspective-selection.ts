import { assign, createActor, setup } from "xstate";

/** Perspective-selection ownership is independent of asynchronous SHACL
 * validation, provider discovery and result rendering. The machine may
 * propose an initial selection only after the visible ribbon is ready.
 * Later discovery results cannot clear an explicitly chosen or restored URI. */
type Context = { proposedUri: string };
export type PerspectiveSelectionEvent =
  | { type: "RIBBON_OBSERVED"; panel: "trail" | "perspectives" | "providers"; loading: boolean; firstUri: string; selectedUri: string }
  | { type: "AUTO_APPLIED"; uri: string }
  | { type: "QUERY_CHANGED" };

export const maestroPerspectiveSelectionMachine = setup({
  types: { context: {} as Context, events: {} as PerspectiveSelectionEvent },
}).createMachine({
  id: "maestro-perspective-selection",
  initial: "waiting",
  context: { proposedUri: "" },
  states: {
    waiting: {
      on: {
        QUERY_CHANGED: { actions: assign({ proposedUri: "" }) },
        RIBBON_OBSERVED: [
          { guard: ({ event }) => Boolean(event.selectedUri), target: "selected" },
          { guard: ({ event }) => event.panel === "perspectives" && !event.loading && Boolean(event.firstUri),
            target: "proposed", actions: assign(({ event }) => ({ proposedUri: event.firstUri })) },
        ],
      },
    },
    proposed: {
      on: {
        QUERY_CHANGED: { target: "waiting", actions: assign({ proposedUri: "" }) },
        RIBBON_OBSERVED: [
          { guard: ({ event }) => Boolean(event.selectedUri), target: "selected" },
          { guard: ({ event }) => event.panel !== "perspectives" || event.loading,
            target: "waiting", actions: assign({ proposedUri: "" }) },
          { guard: ({ event }) => Boolean(event.firstUri),
            actions: assign(({ event }) => ({ proposedUri: event.firstUri })) },
        ],
        AUTO_APPLIED: { guard: ({ context, event }) => context.proposedUri === event.uri,
          target: "selected", actions: assign({ proposedUri: "" }) },
      },
    },
    selected: {
      // A genuinely new query may need its own first eligible Perspective.
      // Async SHACL/discovery results never send QUERY_CHANGED or clear an
      // explicitly chosen/URL-restored selection for the same query.
      on: { QUERY_CHANGED: { target: "waiting", actions: assign({ proposedUri: "" }) } },
    },
  },
});

export function createMaestroPerspectiveSelectionController() {
  const make = () => createActor(maestroPerspectiveSelectionMachine);
  let actor: ReturnType<typeof make> | null = null;
  let snapshot = make().getSnapshot();
  let subscription: { unsubscribe(): void } | null = null;
  const listeners = new Set<() => void>();
  const publish = () => { for (const listener of listeners) listener(); };
  return {
    start() {
      if (actor) return;
      actor = make(); subscription = actor.subscribe(next => { snapshot = next; publish(); });
      actor.start();
    },
    stop() {
      subscription?.unsubscribe(); subscription = null; actor?.stop(); actor = null;
      snapshot = make().getSnapshot(); publish();
    },
    send(event: PerspectiveSelectionEvent) { actor?.send(event); },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
