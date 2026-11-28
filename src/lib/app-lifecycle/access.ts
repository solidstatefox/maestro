import { runActorQuery } from "./actor-query-authority";
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
  loginPending: boolean;
  challengeResponsePending: boolean;
  initializationPulse: boolean;
  policyStage: "unavailable" | "seeding" | "verifying" | "ready" | "failed";
  policyAttemptId: number;
  policyError: string;
  /** Last completed protected HTTP request, separate from graph-policy readiness. */
  authState: "unknown" | "success" | "rejected" | "degraded";
  authResponseStatus: number | null;
  authResponseAt: number;
  proxyTransport: "unknown" | "reachable" | "unavailable";
};
export type AccessEvent =
  | { type: "PROXY_TRANSPORT_OBSERVED"; state: "reachable" | "unavailable" }
  | { type: "LOGIN_ACTIVITY"; pending: boolean }
  | { type: "AUTH_CHALLENGE_SENT" }
  | { type: "SESSION_OBSERVED"; restored: boolean; sessionKey: string }
  | { type: "QUERY_CHANGED"; queryKey: string }
  | { type: "AUTH_STATUS_OBSERVED"; sessionKey: string; state: "success" | "rejected" | "degraded"; status: number | null; at: number }
  | { type: "POLICY_STATUS_OBSERVED"; sessionKey: string; stage: "seeding" | "verifying" | "ready" | "failed"; error?: string; attemptId?: number }
  | { type: "BOOKMARK_CHECK_REQUESTED"; queryKey: string; sessionKey: string; execute: BookmarkCheckExecutor }
  | { type: "BOOKMARK_CONFIRMED"; queryKey: string; bookmarkId: string }
  | { type: "BOOKMARK_REVOKED"; queryKey: string };

const initialContext: AccessContext = {
  sessionKey: "", queryKey: "", bookmark: "unavailable", bookmarkId: "", verificationPending: false, bookmarkExecutor: null, loginPending: false, challengeResponsePending: false, initializationPulse: false, policyStage: "unavailable", policyAttemptId: 0, policyError: "", authState: "unknown", authResponseStatus: null, authResponseAt: 0, proxyTransport: "unknown",
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
    policyStage: sessionKey ? "verifying" : "unavailable", policyAttemptId: 0, policyError: "",
    initializationPulse: Boolean(sessionKey && !context.sessionKey && context.initializationPulse),
    // Carry the successful Connect response into the newly observed session;
    // this is an HTTP observation, never a grant of personal-store readiness.
    ...(!context.sessionKey && sessionKey && context.loginPending && context.authState === "success"
      ? { authState: context.authState, authResponseStatus: context.authResponseStatus, authResponseAt: context.authResponseAt }
      : { authState: "unknown" as const, authResponseStatus: null, authResponseAt: 0 }) };
};

export const maestroAccessMachine = setup({
  types: { context: {} as AccessContext, events: {} as AccessEvent },
  actors: {
    checkBookmark: fromPromise(async ({input, signal}: { input: {
      sessionKey: string; queryKey: string; execute: BookmarkCheckExecutor | null;
    }; signal: AbortSignal }) => input.execute
      ? { sessionKey: input.sessionKey, queryKey: input.queryKey, ...(await runActorQuery("bookmark-verification",signal,input.execute)) }
      : null),
  },
}).createMachine({
  id: "maestro-ui-access",
  initial: "restoring",
  context: initialContext,
  on: {
    PROXY_TRANSPORT_OBSERVED: { actions: assign(({event}) => ({proxyTransport: event.state})) },
    LOGIN_ACTIVITY: { actions: assign(({ context, event }) => ({ loginPending: event.pending, challengeResponsePending: false, initializationPulse: !event.pending && Boolean(context.sessionKey) && context.initializationPulse && (context.policyStage === "seeding" || context.policyStage === "verifying"),
      ...(event.pending && !context.sessionKey ? { authState: "unknown" as const, authResponseStatus: null, authResponseAt: 0 } : {}) })) },
    AUTH_CHALLENGE_SENT: { guard: ({context}) => context.loginPending,
      actions: assign({ challengeResponsePending: true, initializationPulse: true }) },
    SESSION_OBSERVED: [
      { guard: ({ event }) => !event.restored, target: ".restoring", actions: assign(({ context, event }) => updateObservedSession(context, event)) },
      { guard: ({ event }) => !!event.sessionKey, target: ".signedIn", actions: assign(({ context, event }) => updateObservedSession(context, event)) },
      { target: ".signedOut", actions: assign(({ context, event }) => updateObservedSession(context, event)) },
    ],
    AUTH_STATUS_OBSERVED: {
      // Connect can finish with 4xx/5xx before a session exists. Observing
      // that response must not change the session state or capabilities.
      guard: ({ context, event }) => context.sessionKey === event.sessionKey &&
        (Boolean(context.sessionKey) || context.loginPending) && event.at >= context.authResponseAt,
      actions: assign(({ event }) => ({ authState: event.state, authResponseStatus: event.status, authResponseAt: event.at, challengeResponsePending: false })),
    },
    POLICY_STATUS_OBSERVED: {
      guard: ({ context, event }) => Boolean(context.sessionKey) && context.sessionKey === event.sessionKey &&
        (event.attemptId === undefined
          ? (context.policyStage !== "ready" || event.stage === "ready")
          : (event.attemptId > context.policyAttemptId ||
             (event.attemptId === context.policyAttemptId &&
              (context.policyStage !== "ready" || event.stage === "ready")))),
      actions: assign(({ context, event }) => ({ policyStage: event.stage, policyAttemptId: event.attemptId ?? context.policyAttemptId, policyError: event.error ?? "", initializationPulse: event.stage === "ready" || event.stage === "failed" ? false : context.initializationPulse })),
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
  // Authentication is necessary but not sufficient: until the graph manifest
  // has been seeded and verified, no personal graph UI may issue reads/writes.
  const policyReady = sessionReady && snapshot.context.policyStage === "ready";
  const status = snapshot.context.authResponseStatus;
  const challenge = snapshot.context.challengeResponsePending;
  const initializing = sessionReady && (snapshot.context.policyStage === "seeding" || snapshot.context.policyStage === "verifying");
  const userSignal = snapshot.context.proxyTransport === "unavailable" ? "amber" : status !== null && status >= 500 && status < 600 ? "red"
    : status !== null && status >= 400 && status < 500 && !challenge ? "amber"
    : challenge ? "pulsingAmber"
    : sessionReady && status !== null && status >= 200 && status < 300 ? (policyReady ? "green" : "pulsingGreen")
    : "amber";
  const userSignalLabel = snapshot.context.proxyTransport === "unavailable" ? "Maestro proxy unavailable — personal authentication not reverified" : challenge ? "401 — awaiting authenticated result"
    : status !== null && status >= 400 ? `HTTP ${status}`
    : snapshot.context.policyStage === "failed" ? "Personal initialization failed (authentication status shown separately)"
    : initializing ? `${status !== null && status >= 200 && status < 300 ? `HTTP ${status} — authenticated; ` : ""}Loading personal store`
    : userSignal === "green" ? `HTTP ${status} — ready`
    : userSignal === "pulsingGreen" ? `HTTP ${status} — authenticated; personal policies not ready`
    : snapshot.context.loginPending ? "Connecting"
    : snapshot.context.authState === "degraded" ? "Personal endpoint request failed" : "No authenticated response yet";
  const queryMatches = Boolean(input.queryKey) && snapshot.context.queryKey === input.queryKey;
  const bookmarked = policyReady && queryMatches && snapshot.context.bookmark === "bookmarked";
  return {
    canUsePersonalStore: policyReady,
    userSignal, userSignalLabel,
    proxyTransport: snapshot.context.proxyTransport,
    authState: snapshot.context.authState,
    authResponseStatus: snapshot.context.authResponseStatus,
    challengeResponsePending: snapshot.context.challengeResponsePending,
    authResponseAt: snapshot.context.authResponseAt,
    // XState is authoritative for every Sheet cache-clearing action.
    canClearCaches: !snapshot.context.loginPending && snapshot.context.policyStage !== "seeding" &&
      snapshot.context.policyStage !== "verifying" && snapshot.value !== "restoring",
    canUsePolicyProviders: policyReady,
    policyStage: sessionReady ? snapshot.context.policyStage : "unavailable",
    policyError: sessionReady ? snapshot.context.policyError : "",
    canMutatePersonalStore: policyReady,
    canShowStatusFacet: bookmarked,
    canShowRecordStatusActions: bookmarked && Boolean(input.recordSelected),
    canApproveProvider: bookmarked && policyReady && Boolean(input.providersActive),
    bookmarkVerified: policyReady && queryMatches && (snapshot.context.bookmark === "bookmarked" || snapshot.context.bookmark === "unbookmarked"),
    bookmarkId: bookmarked ? snapshot.context.bookmarkId : "",
  };
}
