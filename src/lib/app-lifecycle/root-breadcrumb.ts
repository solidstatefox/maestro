import { assign, createActor, setup } from "xstate";
import { readRootHoverDelayMs } from "@/lib/root-breadcrumb-settings";

/** Root specializes an ordinary breadcrumb node: it never owns navigation,
 * stack pop, query execution, or the shared breadcrumb presentation.  This
 * actor owns only the root's two independent interactive surfaces. */
export type RootBreadcrumbEvent =
  | { type: "LABEL_ENTER" | "LABEL_LEAVE" | "INPUT_FOCUS" | "INPUT_BLUR" }
  | { type: "SIGNAL_ENTER" | "SIGNAL_LEAVE" | "SIGNAL_SELECTED" }
  | { type: "SET_EDITOR" | "SET_SIGNAL"; open: boolean }
  | { type: "POINTER_NEAR" | "POINTER_AWAY" | "EDIT_ACTIVITY" };

type RootBreadcrumbContext = { labelHovered: boolean; inputFocused: boolean; pointerAway: boolean };
export const maestroRootBreadcrumbMachine = setup({
  types: { context: {} as RootBreadcrumbContext, events: {} as RootBreadcrumbEvent },
  delays: { rootHoverDelay: () => readRootHoverDelayMs() },
}).createMachine({
  id: "maestro-root-breadcrumb",
  type: "parallel",
  context: { labelHovered: false, inputFocused: false, pointerAway: false },
  states: {
    presentation: {
      initial: "resting",
      states: {
        resting: {
          id: "root-resting",
          on: {
            // Respect the Sheet hover setting (2 seconds by default) before
            // replacing the ordinary breadcrumb navigation button.
            LABEL_ENTER: { target: "hovering", actions: assign({ labelHovered: true }) },
            INPUT_FOCUS: { target: "editing", actions: assign({ inputFocused: true }) },
            SET_EDITOR: { guard: ({ event }) => event.type === "SET_EDITOR" && event.open, target: "editing" },
          },
        },
        hovering: {
          after: {
            rootHoverDelay: { guard: ({ context }) => context.labelHovered, target: "editing" },
          },
          on: {
            LABEL_LEAVE: { target: "resting", actions: assign({ labelHovered: false }) },
            INPUT_FOCUS: { target: "editing", actions: assign({ inputFocused: true }) },
            SET_EDITOR: { guard: ({ event }) => event.type === "SET_EDITOR" && event.open, target: "editing" },
          },
        },
        editing: {
          // Proximity is interpreted only in this state. Hovering and
          // ordinary breadcrumb navigation never invoke this machinery.
          initial: "near",
          on: {
            LABEL_ENTER: { actions: assign({ labelHovered: true }) },
            LABEL_LEAVE: { actions: assign({ labelHovered: false }) },
            INPUT_FOCUS: { actions: assign({ inputFocused: true }) },
            INPUT_BLUR: { actions: assign({ inputFocused: false }) },
            SET_EDITOR: {
              guard: ({ event }) => event.type === "SET_EDITOR" && !event.open,
              target: "#root-resting", actions: assign({ labelHovered: false, inputFocused: false, pointerAway: false }),
            },
          },
          states: {
            near: {
              on: {
                POINTER_AWAY: { target: "leaving", actions: assign({ pointerAway: true }) },
                EDIT_ACTIVITY: "typing",
              },
            },
            leaving: {
              // Moving back within the buffer cancels the pending collapse.
              after: { 300: { target: "#root-resting", actions: assign({
                labelHovered: false, inputFocused: false, pointerAway: false,
              }) } },
              on: {
                POINTER_NEAR: { target: "near", actions: assign({ pointerAway: false }) },
                EDIT_ACTIVITY: "typing",
              },
            },
            typing: {
              // A keyboard-active editor cannot disappear under the typist.
              // Only after inactivity may proximity initiate the close delay.
              after: {
                1200: [
                  { guard: ({ context }) => context.pointerAway, target: "leaving" },
                  { target: "near" },
                ],
              },
              on: {
                EDIT_ACTIVITY: { target: "typing", reenter: true },
                POINTER_NEAR: { actions: assign({ pointerAway: false }) },
                POINTER_AWAY: { actions: assign({ pointerAway: true }) },
              },
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
