import { assign, createActor, fromPromise, setup } from "xstate";

/** Phase B: authoritative UI access state. No credentials or RDF data are stored
 * here. Query identity is the canonical identity of the live FCT query. */
/** The existing access actor owns bookmark verification and cancels it on a
 * session/query change, unbookmark, bookmark, or actor shutdown. */
export type BookmarkCheckResult = { bookmarked: boolean; bookmarkId: string };
export type BookmarkCheckExecutor = (signal: AbortSignal) => Promise<BookmarkCheckResult>;
export type BookmarkVerification = "unavailable" | "checking" | "bookmarked" | "unbookmarked" | "error";
export type AccessContext = {
  sessionKey: string;
  queryKey: string;
  bookmark: BookmarkVerification;
  bookmarkId: string;
  /** An in-flight verifier may update the gate only until a local bookmark action settles. */
  verificationPending: boolean;
  bookmarkExecutor: BookmarkCheckExecutor | null;
  policyStage: "unavailable" | "seeding" | "verifying" | "ready" | "failed";
  policyError: string;
};
export type AccessEvent =
  | { type: "SESSION_OBSERVED"; restored: boolean; sessionKey: string }
  | { type: "QUERY_CHANGED"; queryKey: string }
  | { type: "POLICY_STATUS_OBSERVED"; sessionKey: string; stage: "seeding" | "verifying" | "ready" | "failed"; error?: string }
  | { type: "BOOKMARK_CHECK_REQUESTED"; queryKey: string; sessionKey: string; execute: BookmarkCheckExecutor }
  | { type: "BOOKMARK_CONFIRMED"; queryKey: string; bookmarkId: string }
  | { type: "BOOKMARK_REVOKED"; queryKey: string };

const initialContext: AccessContext = {
  sessionKey: "", queryKey: "", bookmark: "unavailable", bookmarkId: "", verificationPending: false, bookmarkExecutor: null, policyStage: "unavailable", policyError: "",
};
/** A pure context updater, not a reusable XState action. XState infers the
 * precise SESSION_OBSERVED event type at each assign(...) call site. */
const updateObservedSession = (
  context: AccessContext,
  event: Extract<AccessEvent, { type: "SESSION_OBSERVED" }>,
): Partial<AccessContext> => {
  const sessionKey = event.restored ? event.sessionKey : "";
  if (sessionKey === context.sessionKey) return {};
  return { sessionKey, bookmark: sessionKey ? "checking" : "unavailable", bookmarkId: "", verificationPending: false, bookmarkExecutor: null,
    policyStage: sessionKey ? "verifying" : "unavailable", policyError: "" };
};

export const maestroAccessMachine = setup({
  types: { context: {} as AccessContext, events: {} as AccessEvent },
  actors: {
    checkBookmark: fromPromise(async ({input, signal}: { input: {
      sessionKey: string; queryKey: string; execute: BookmarkCheckExecutor | null;
    }; signal: AbortSignal }) => input.execute
      ? { sessionKey: input.sessionKey, queryKey: input.queryKey, ...(await input.execute(signal)) }
      : null),
  },
}).createMachine({
  id: "maestro-ui-access",
  initial: "restoring",
  context: initialContext,
  on: {
    SESSION_OBSERVED: [
      { guard: ({ event }) => !event.restored, target: ".restoring", actions: assign(({ context, event }) => updateObservedSession(context, event)) },
      { guard: ({ event }) => !!event.sessionKey, target: ".signedIn", actions: assign(({ context, event }) => updateObservedSession(context, event)) },
      { target: ".signedOut", actions: assign(({ context, event }) => updateObservedSession(context, event)) },
    ],
    POLICY_STATUS_OBSERVED: {
      guard: ({ context, event }) => Boolean(context.sessionKey) && context.sessionKey === event.sessionKey,
      actions: assign(({ event }) => ({ policyStage: event.stage, policyError: event.error ?? "" })),
    },
    QUERY_CHANGED: [
      // Reentering signedIn stops the previous invoked verifier immediately.
      { guard: ({ context, event }) => Boolean(context.sessionKey) && event.queryKey !== context.queryKey,
        target: ".signedIn", reenter: true,
        actions: assign(({ event }) => ({ queryKey: event.queryKey, bookmark: "checking" as const,
          bookmarkId: "", verificationPending: false, bookmarkExecutor: null })) },
      { actions: assign(({ context, event }) => event.queryKey === context.queryKey ? {} : ({
        queryKey: event.queryKey, bookmark: "unavailable" as const,
        bookmarkId: "", verificationPending: false, bookmarkExecutor: null,
      })) },
    ],
    BOOKMARK_CHECK_REQUESTED: {
      guard: ({ context, event }) => Boolean(context.sessionKey) &&
        event.sessionKey === context.sessionKey && event.queryKey === context.queryKey,
      target: ".signedIn", reenter: true,
      actions: assign(({ event }) => ({ bookmarkExecutor: event.execute,
        bookmark: "checking" as const, bookmarkId: "", verificationPending: true })),
    },
    BOOKMARK_CONFIRMED: {
      guard: ({ context, event }) => Boolean(context.sessionKey) && event.queryKey === context.queryKey,
      target: ".signedIn", reenter: true,
      actions: assign(({ event }) => ({ bookmark: "bookmarked" as const, bookmarkId: event.bookmarkId,
        verificationPending: false, bookmarkExecutor: null })),
    },
    BOOKMARK_REVOKED: {
      guard: ({ context, event }) => Boolean(context.sessionKey) && event.queryKey === context.queryKey,
      target: ".signedIn", reenter: true,
      actions: assign({ bookmark: "unbookmarked" as const, bookmarkId: "", verificationPending: false, bookmarkExecutor: null }),
    },
  },
  states: {
    restoring: {}, signedOut: {},
    signedIn: {
      invoke: {
        src: "checkBookmark",
        input: ({context}) => ({ sessionKey: context.sessionKey, queryKey: context.queryKey,
          execute: context.bookmarkExecutor }),
        onDone: { guard: ({context,event}) => Boolean(event.output) && context.verificationPending &&
          context.sessionKey === event.output?.sessionKey && context.queryKey === event.output?.queryKey,
          actions: assign(({event}) => ({
            bookmark: event.output!.bookmarked ? "bookmarked" as const : "unbookmarked" as const,
            bookmarkId: event.output!.bookmarked ? event.output!.bookmarkId : "",
            verificationPending: false, bookmarkExecutor: null,
          })) },
        onError: { guard: ({context}) => context.verificationPending,
          actions: assign({ bookmark: "error" as const, bookmarkId: "", verificationPending: false, bookmarkExecutor: null }) },
      },
    },
  },
});

type AccessActor = ReturnType<typeof createMaestroAccessActor>;
export function createMaestroAccessActor() { return createActor(maestroAccessMachine); }

/** Strict Mode can stop and restart the workspace. Recreate stopped actors;
 * access is recomputed from authoritative session/query events on reconnect. */
export function createMaestroAccessController() {
  let actor: AccessActor | null = null;
  let snapshot = createMaestroAccessActor().getSnapshot();
  const listeners = new Set<() => void>();
  const publish = () => { for (const listener of listeners) listener(); };
  return {
    start() {
      if (actor) return;
      actor = createMaestroAccessActor();
      actor.subscribe((next) => { snapshot = next; publish(); });
      actor.start();
    },
    stop() { actor?.stop(); actor = null; snapshot = createMaestroAccessActor().getSnapshot(); publish(); },
    send(event: AccessEvent) { actor?.send(event); },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
export type MaestroAccessController = ReturnType<typeof createMaestroAccessController>;
export type MaestroAccessSnapshot = ReturnType<MaestroAccessController["getSnapshot"]>;

/** Capability decisions are pure selectors of the XState snapshot. For any
 * query-scoped action, callers MUST pass the CURRENT query identity. This
 * closes a gate immediately even before React commits a QUERY_CHANGED event. */
export function selectMaestroCapabilities(snapshot: MaestroAccessSnapshot, input: {
  queryKey?: string; recordSelected?: boolean; providersActive?: boolean;
} = {}) {
  const sessionReady = snapshot.value === "signedIn" && Boolean(snapshot.context.sessionKey);
  const policyReady = sessionReady && snapshot.context.policyStage === "ready";
  const queryMatches = Boolean(input.queryKey) && snapshot.context.queryKey === input.queryKey;
  const bookmarked = sessionReady && queryMatches && snapshot.context.bookmark === "bookmarked";
  return {
    canUsePersonalStore: sessionReady,
    canUsePolicyProviders: policyReady,
    policyStage: sessionReady ? snapshot.context.policyStage : "unavailable",
    policyError: sessionReady ? snapshot.context.policyError : "",
    canMutatePersonalStore: sessionReady,
    canShowStatusFacet: bookmarked,
    canShowRecordStatusActions: bookmarked && Boolean(input.recordSelected),
    canApproveProvider: bookmarked && policyReady && Boolean(input.providersActive),
    bookmarkVerified: sessionReady && queryMatches && (snapshot.context.bookmark === "bookmarked" || snapshot.context.bookmark === "unbookmarked"),
    bookmarkId: bookmarked ? snapshot.context.bookmarkId : "",
  };
}
