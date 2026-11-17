import { assign, createActor, setup } from "xstate";

/** Record sessions own lifecycle only; the immutable FCT SELECT, policy RDF,
 * SHACL report and sanitized XSLT HTML remain in their existing data stores.
 * Keys are supplied by the existing Record identity and request scope. */
export type RecordOperation = "description" | "policy" | "format" | "validation";
export type RecordOperationPhase = "idle" | "loading" | "ready" | "failed";
type RecordContext = {
  key: string;
  phases: Record<RecordOperation, RecordOperationPhase>;
  errors: Record<RecordOperation, string>;
  requestIds: Record<RecordOperation, string>;
};
export type RecordSessionEvent =
  | { type: "SELECT_RECORD"; key: string }
  | { type: "OP_STARTED" | "OP_SUCCEEDED" | "OP_CANCELLED" | "OP_RESET"; key: string; operation: RecordOperation; requestId?: string }
  | { type: "OP_FAILED"; key: string; operation: RecordOperation; error: string; requestId?: string }
  | { type: "ERROR_CLEARED"; key: string; operation: RecordOperation }
  | { type: "CLOSE" };
const phases = (): RecordContext["phases"] => ({ description: "idle", policy: "idle", format: "idle", validation: "idle" });
const errors = (): RecordContext["errors"] => ({ description: "", policy: "", format: "", validation: "" });
const blank = (key = ""): RecordContext => ({
  key, phases: phases(), errors: errors(), requestIds: { description: "", policy: "", format: "", validation: "" },
});
const matchesRequest = (context: RecordContext, event: { operation: RecordOperation; requestId?: string }) =>
  event.requestId === undefined || context.requestIds[event.operation] === event.requestId;
export const maestroRecordSessionMachine = setup({
  types: { context: {} as RecordContext, events: {} as RecordSessionEvent },
}).createMachine({
  id: "maestro-record-session", initial: "active", context: () => blank(),
  on: {
    SELECT_RECORD: { target: ".active", guard: ({ context, event }) => context.key !== event.key,
      actions: assign(({ event }) => blank(event.key)) },
    CLOSE: { target: ".closed", actions: assign(() => blank()) },
  },
  states: {
    active: {
      on: {
        OP_STARTED: { guard: ({ context, event }) => context.key === event.key,
          actions: assign(({ context, event }) => ({
            phases: { ...context.phases, [event.operation]: "loading" as const },
            errors: { ...context.errors, [event.operation]: "" },
            requestIds: { ...context.requestIds, [event.operation]: event.requestId ?? "" },
          })) },
        OP_SUCCEEDED: { guard: ({ context, event }) => context.key === event.key &&
          matchesRequest(context, event) &&
          (context.phases[event.operation] === "loading" ||
           (event.operation === "format" && event.requestId === undefined &&
            context.requestIds.format === "" && context.phases.format !== "failed")),
          actions: assign(({ context, event }) => ({
            phases: { ...context.phases, [event.operation]: "ready" as const },
            errors: { ...context.errors, [event.operation]: "" },
          })) },
        OP_FAILED: { guard: ({ context, event }) => context.key === event.key && matchesRequest(context, event) &&
          (context.phases[event.operation] === "loading" ||
           (event.operation === "format" && event.requestId === undefined && context.requestIds.format === "")),
          actions: assign(({ context, event }) => ({
            phases: { ...context.phases, [event.operation]: "failed" as const },
            errors: { ...context.errors, [event.operation]: event.error },
          })) },
        OP_CANCELLED: { guard: ({ context, event }) => context.key === event.key && matchesRequest(context, event) && context.phases[event.operation] === "loading",
          actions: assign(({ context, event }) => ({
            phases: { ...context.phases, [event.operation]: "idle" as const },
          })) },
        OP_RESET: { guard: ({ context, event }) => context.key === event.key && matchesRequest(context, event),
          actions: assign(({ context, event }) => ({
            phases: { ...context.phases, [event.operation]: "idle" as const },
            errors: { ...context.errors, [event.operation]: "" },
            requestIds: { ...context.requestIds, [event.operation]: "" },
          })) },
        ERROR_CLEARED: { guard: ({ context, event }) => context.key === event.key,
          actions: assign(({ context, event }) => ({
            phases: context.phases[event.operation] === "failed"
              ? { ...context.phases, [event.operation]: "idle" as const } : context.phases,
            errors: { ...context.errors, [event.operation]: "" },
          })) },
      },
    },
    closed: {},
  },
});
function newActor() { return createActor(maestroRecordSessionMachine); }
export function createMaestroRecordSessionController() {
  let actor: ReturnType<typeof newActor> | null = null;
  let snapshot = newActor().getSnapshot();
  let subscription: { unsubscribe(): void } | null = null;
  // Abort handles are held outside XState context; they are request resources,
  // not durable Record data. Record identity and operation phases remain in XState.
  const requests = new Map<RecordOperation, { key: string; abort: AbortController }>();
  const abortAll = () => { for (const request of requests.values()) request.abort.abort(); requests.clear(); };
  const listeners = new Set<() => void>();
  const publish = () => { for (const listener of listeners) listener(); };
  return {
    start() {
      if (actor) return;
      actor = newActor();
      subscription = actor.subscribe(next => { snapshot = next; publish(); });
      actor.start();
    },
    stop() {
      abortAll();
      subscription?.unsubscribe(); subscription = null;
      actor?.stop(); actor = null;
      snapshot = newActor().getSnapshot(); publish();
    },
    send(event: RecordSessionEvent) {
      if ((event.type === "SELECT_RECORD" && event.key !== snapshot.context.key) || event.type === "CLOSE") abortAll();
      actor?.send(event);
    },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    selectRecord(key: string) {
      if (key !== snapshot.context.key) abortAll();
      actor?.send({ type: "SELECT_RECORD", key });
    },
    /** One current abort handle per Record operation and exact Record identity.
     * Starting another request supersedes that operation, not sibling stages. */
    scopedAbort(key: string, operation: RecordOperation): AbortController {
      const controller = new AbortController();
      if (!actor || actor.getSnapshot().context.key !== key) { controller.abort(); return controller; }
      requests.get(operation)?.abort.abort();
      requests.set(operation, { key, abort: controller });
      return controller;
    },
    releaseAbort(key: string, operation: RecordOperation, controller: AbortController) {
      if (requests.get(operation)?.key === key && requests.get(operation)?.abort === controller) requests.delete(operation);
    },
    /** Explicit keyed calls are for async completions captured at request start. */
    operation(operation: RecordOperation, type: "OP_STARTED" | "OP_SUCCEEDED" | "OP_CANCELLED" | "OP_RESET", key: string, requestId?: string) {
      actor?.send({ type, operation, key, requestId });
    },
  };
}
export type MaestroRecordSessionController = ReturnType<typeof createMaestroRecordSessionController>;
