import { assign, createActor, setup } from "xstate";

/** The Configure actor owns only a draft. The FCT tree owns committed state.
 * A transaction is bound to the exact source query and is committed with a
 * single replaceTree. No staging writes or implicit query migrations. */
export type ConfigureGroup = "Properties" | "Roles";
type ConfigureContext = {
  group: ConfigureGroup | null;
  sourceKey: string;
  membership: Record<string, string | null>;
  menuFor: string | null;
  error: string;
};
export type ConfigureEvent =
  | { type: "BEGIN"; group: ConfigureGroup; sourceKey: string }
  | { type: "ASSIGN"; key: string; uid: string | null }
  | { type: "MENU"; key: string | null }
  | { type: "SOURCE_CHANGED"; sourceKey: string }
  | { type: "COMMIT"; sourceKey: string }
  | { type: "COMMITTED" }
  | { type: "COMMIT_FAILED"; error: string }
  | { type: "CANCEL" };
const blank = (): ConfigureContext => ({ group: null, sourceKey: "", membership: {}, menuFor: null, error: "" });

export const maestroConfigureMachine = setup({
  types: { context: {} as ConfigureContext, events: {} as ConfigureEvent },
}).createMachine({
  id: "maestro-configure-transaction", initial: "idle", context: () => blank(),
  on: { CANCEL: { target: ".idle", actions: assign(() => blank()) } },
  states: {
    idle: {
      on: { BEGIN: { target: "editing", actions: assign(({ event }) => ({
        group: event.group, sourceKey: event.sourceKey, membership: {}, menuFor: null, error: "",
      })) } },
    },
    editing: {
      on: {
        BEGIN: { actions: assign(({ event }) => ({ group: event.group, sourceKey: event.sourceKey,
          membership: {}, menuFor: null, error: "" })) },
        ASSIGN: { actions: assign(({ context, event }) => ({
          membership: { ...context.membership, [event.key]: event.uid }, menuFor: null, error: "",
        })) },
        MENU: { actions: assign(({ event }) => ({ menuFor: event.key })) },
        SOURCE_CHANGED: { guard: ({ context, event }) => context.sourceKey !== event.sourceKey,
          target: "idle", actions: assign(() => blank()) },
        COMMIT: { guard: ({ context, event }) => context.sourceKey === event.sourceKey,
          target: "committing", actions: assign({ menuFor: null, error: "" }) },
      },
    },
    committing: {
      on: {
        COMMITTED: { target: "idle", actions: assign(() => blank()) },
        COMMIT_FAILED: { target: "editing", actions: assign(({ event }) => ({ error: event.error })) },
        SOURCE_CHANGED: { guard: ({ context, event }) => context.sourceKey !== event.sourceKey,
          target: "idle", actions: assign(() => blank()) },
      },
    },
  },
});

function makeActor() { return createActor(maestroConfigureMachine); }
export function createMaestroConfigureController() {
  let actor: ReturnType<typeof makeActor> | null = null;
  let snapshot = makeActor().getSnapshot();
  let subscription: { unsubscribe(): void } | null = null;
  const listeners = new Set<() => void>();
  const publish = () => { for (const listener of listeners) listener(); };
  return {
    start() {
      if (actor) return;
      actor = makeActor();
      subscription = actor.subscribe(next => { snapshot = next; publish(); });
      actor.start();
    },
    stop() {
      subscription?.unsubscribe(); subscription = null;
      actor?.stop(); actor = null;
      snapshot = makeActor().getSnapshot(); publish();
    },
    send(event: ConfigureEvent) { actor?.send(event); },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
export type MaestroConfigureController = ReturnType<typeof createMaestroConfigureController>;
export function selectConfigure(snapshot: ReturnType<MaestroConfigureController["getSnapshot"]>) {
  const phase = snapshot.value as "idle" | "editing" | "committing";
  return { phase, group: phase === "idle" ? null : snapshot.context.group,
    membership: snapshot.context.membership, menuFor: snapshot.context.menuFor,
    sourceKey: snapshot.context.sourceKey, error: snapshot.context.error,
    hasChanges: Object.keys(snapshot.context.membership).length > 0 };
}
