import { assign, createActor, setup } from "xstate";

/** Root specializes an ordinary breadcrumb node: it never owns navigation,
 * stack pop, query execution, or the shared breadcrumb presentation.  This
 * actor owns only the root's two independent interactive surfaces. */
export type RootBreadcrumbEvent =
  | { type: "LABEL_ENTER" | "LABEL_LEAVE" | "INPUT_FOCUS" | "INPUT_BLUR" }
  | { type: "SIGNAL_ENTER" | "SIGNAL_LEAVE" | "SIGNAL_SELECTED" }
  | { type: "SET_EDITOR" | "SET_SIGNAL"; open: boolean };

type RootBreadcrumbContext = { labelHovered: boolean; inputFocused: boolean };
export const maestroRootBreadcrumbMachine = setup({
  types: { context: {} as RootBreadcrumbContext, events: {} as RootBreadcrumbEvent },
}).createMachine({
  id: "maestro-root-breadcrumb",
  type: "parallel",
  context: { labelHovered: false, inputFocused: false },
  states: {
    presentation: {
      initial: "resting",
      states: {
        resting: {
          on: {
            LABEL_ENTER: { target: "editing", actions: assign({ labelHovered: true }) },
            INPUT_FOCUS: { target: "editing", actions: assign({ inputFocused: true }) },
            SET_EDITOR: { guard: ({ event }) => event.type === "SET_EDITOR" && event.open, target: "editing" },
          },
        },
        editing: {
          on: {
            LABEL_ENTER: { actions: assign({ labelHovered: true }) },
            LABEL_LEAVE: [
              { guard: ({ context }) => !context.inputFocused, target: "resting", actions: assign({ labelHovered: false }) },
              { actions: assign({ labelHovered: false }) },
            ],
            INPUT_FOCUS: { actions: assign({ inputFocused: true }) },
            INPUT_BLUR: [
              { guard: ({ context }) => !context.labelHovered, target: "resting", actions: assign({ inputFocused: false }) },
              { actions: assign({ inputFocused: false }) },
            ],
            SET_EDITOR: {
              guard: ({ event }) => event.type === "SET_EDITOR" && !event.open,
              target: "resting", actions: assign({ labelHovered: false, inputFocused: false }),
            },
          },
        },
      },
    },
    signal: {
      initial: "collapsed",
      states: {
        collapsed: {
          on: {
            SIGNAL_ENTER: "unfurled",
            SET_SIGNAL: { guard: ({ event }) => event.type === "SET_SIGNAL" && event.open, target: "unfurled" },
          },
        },
        unfurled: {
          on: {
            SIGNAL_LEAVE: "collapsed",
            SIGNAL_SELECTED: "collapsed",
            SET_SIGNAL: { guard: ({ event }) => event.type === "SET_SIGNAL" && !event.open, target: "collapsed" },
          },
        },
      },
    },
  },
});

type Snapshot = ReturnType<ReturnType<typeof createRootBreadcrumbController>["getSnapshot"]>;
export const rootBreadcrumbEditing = (snapshot: Snapshot) => snapshot.matches({ presentation: "editing" });
export const rootBreadcrumbSignalsOpen = (snapshot: Snapshot) => snapshot.matches({ signal: "unfurled" });

/** Stable React subscription, shared by all breadcrumb render sites. */
export function createRootBreadcrumbController() {
  const make = () => createActor(maestroRootBreadcrumbMachine);
  let actor: ReturnType<typeof make> | null = null;
  let snapshot = make().getSnapshot();
  let subscription: { unsubscribe(): void } | undefined;
  const listeners = new Set<() => void>();
  const publish = () => { for (const listener of listeners) listener(); };
  return {
    start() {
      if (actor) return;
      actor = make();
      subscription = actor.subscribe(next => { snapshot = next; publish(); });
      actor.start();
    },
    stop() {
      subscription?.unsubscribe();
      actor?.stop();
      actor = null;
      snapshot = make().getSnapshot();
      publish();
    },
    send(event: RootBreadcrumbEvent) { actor?.send(event); },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
