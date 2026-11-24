import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createMaestroAccessController,
  selectMaestroCapabilities,
  type BookmarkCheckResult,
} from "../src/lib/app-lifecycle/access";

const session = "https://example.test/sparql|https://example.test/personal|sparql-auth|user";
const a = "query-a";
const b = "query-b";

function signedIn() {
  const controller = createMaestroAccessController();
  controller.start();
  controller.send({ type: "SESSION_OBSERVED", restored: true, sessionKey: session });
  controller.send({ type: "QUERY_CHANGED", queryKey: a });
  controller.send({ type: "POLICY_STATUS_OBSERVED", sessionKey: session, stage: "ready" });
  return controller;
}

function caps(c: ReturnType<typeof createMaestroAccessController>, key = a) {
  return selectMaestroCapabilities(c.getSnapshot(), { queryKey: key, recordSelected: true, providersActive: true });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// Invoked fromPromise actors publish completion asynchronously. Wait for a
// macrotask rather than asserting on the snapshot immediately after resolving.
async function settleActor() {
  await new Promise<void>(resolve => setImmediate(resolve));
}

test("Connect HTTP outcomes are observable while anonymous without unlocking personal access", () => {
  const c = createMaestroAccessController(); c.start();
  c.send({ type: "SESSION_OBSERVED", restored: true, sessionKey: "" });
  c.send({ type: "LOGIN_ACTIVITY", pending: true });
  assert.equal(caps(c).challengeResponsePending, false);
  c.send({ type: "AUTH_CHALLENGE_SENT" });
  assert.equal(caps(c).challengeResponsePending, true);
  for (const [status, state] of [[401, "rejected"], [504, "degraded"], [201, "success"]] as const) {
    c.send({ type: "AUTH_STATUS_OBSERVED", sessionKey: "", status, state, at: status === 401 ? 1 : status === 504 ? 2 : 3 });
    assert.equal(caps(c).authResponseStatus, status);
    assert.equal(caps(c).challengeResponsePending, false);
    assert.equal(c.getSnapshot().value, "signedOut");
    assert.equal(caps(c).canUsePersonalStore, false);
  }
  c.send({ type: "SESSION_OBSERVED", restored: true, sessionKey: session });
  assert.equal(caps(c).authResponseStatus, 201);
  assert.equal(caps(c).canUsePersonalStore, false);
  c.send({ type: "LOGIN_ACTIVITY", pending: false });
  c.send({ type: "SESSION_OBSERVED", restored: true, sessionKey: "" });
  assert.equal(caps(c).authResponseStatus, null);
  c.send({ type: "AUTH_STATUS_OBSERVED", sessionKey: session, status: 504, state: "degraded", at: 4 });
  assert.equal(caps(c).authResponseStatus, null);
  c.stop();
});

test("restoration and sign-out deny all personal UI without credentials", () => {
  const c = createMaestroAccessController(); c.start();
  assert.equal(caps(c).canUsePersonalStore, false);
  c.send({ type: "SESSION_OBSERVED", restored: true, sessionKey: "" });
  assert.equal(c.getSnapshot().value, "signedOut");
  assert.equal(caps(c).canMutatePersonalStore, false);
  c.send({ type: "SESSION_OBSERVED", restored: true, sessionKey: session });
  assert.equal(caps(c).canUsePersonalStore, false, "signed-in is not enough before graph seeding");
  c.send({ type: "POLICY_STATUS_OBSERVED", sessionKey: session, stage: "ready" });
  assert.equal(caps(c).canUsePersonalStore, true);
  assert.equal(caps(c).canShowStatusFacet, false);
  c.stop();
});

test("only the confirmed exact bookmark enables Status, Record, and Providers approvals", async () => {
  const c = signedIn();
  assert.equal(caps(c).canShowStatusFacet, false);
  assert.equal(caps(c).canApproveProvider, false);
  c.send({ type: "POLICY_STATUS_OBSERVED", sessionKey: session, stage: "ready" });
  const check = deferred<BookmarkCheckResult>();
  c.send({ type: "BOOKMARK_CHECK_REQUESTED", queryKey: a, sessionKey: session, execute: () => check.promise });
  assert.equal(c.getSnapshot().context.bookmark, "checking");
  check.resolve({ bookmarked: true, bookmarkId: "book-1" });
  await settleActor();
  assert.equal(caps(c).canShowStatusFacet, true);
  assert.equal(caps(c).canShowRecordStatusActions, true);
  assert.equal(caps(c).canApproveProvider, true);
  assert.equal(caps(c).bookmarkId, "book-1");
  assert.equal(caps(c, b).canShowStatusFacet, false, "a different live query cannot inherit access");
  assert.equal(selectMaestroCapabilities(c.getSnapshot(), { queryKey: a, providersActive: false }).canApproveProvider, false);
  c.send({ type: "BOOKMARK_REVOKED", queryKey: a });
  assert.equal(caps(c).canShowStatusFacet, false);
  c.stop();
});

test("late bookmark results and stale confirmations cannot unlock a changed query", async () => {
  const c = signedIn();
  const oldCheck = deferred<BookmarkCheckResult>();
  c.send({ type: "BOOKMARK_CHECK_REQUESTED", queryKey: a, sessionKey: session, execute: () => oldCheck.promise });
  c.send({ type: "QUERY_CHANGED", queryKey: b });
  c.send({ type: "BOOKMARK_CONFIRMED", queryKey: a, bookmarkId: "old" });
  oldCheck.resolve({ bookmarked: true, bookmarkId: "old" });
  await settleActor();
  assert.equal(caps(c, b).canShowStatusFacet, false);
  assert.equal(caps(c, b).bookmarkVerified, false);
  const currentCheck = deferred<BookmarkCheckResult>();
  c.send({ type: "BOOKMARK_CHECK_REQUESTED", queryKey: b, sessionKey: session, execute: () => currentCheck.promise });
  currentCheck.resolve({ bookmarked: false, bookmarkId: "" });
  await settleActor();
  assert.equal(caps(c, b).bookmarkVerified, true);
  assert.equal(caps(c, b).canShowRecordStatusActions, false);
  c.send({ type: "BOOKMARK_CONFIRMED", queryKey: b, bookmarkId: "new" });
  assert.equal(caps(c, b).canShowStatusFacet, true);
  c.stop();
});

test("logout or different session invalidates bookmark even for the same query", async () => {
  const c = signedIn();
  const check = deferred<BookmarkCheckResult>();
  c.send({ type: "BOOKMARK_CHECK_REQUESTED", queryKey: a, sessionKey: session, execute: () => check.promise });
  c.send({ type: "BOOKMARK_CONFIRMED", queryKey: a, bookmarkId: "book-1" });
  c.send({ type: "SESSION_OBSERVED", restored: true, sessionKey: "" });
  assert.equal(caps(c).canUsePersonalStore, false);
  assert.equal(caps(c).canShowStatusFacet, false);
  c.send({ type: "SESSION_OBSERVED", restored: true, sessionKey: session + "-other" });
  check.resolve({ bookmarked: true, bookmarkId: "old" });
  await settleActor();
  assert.equal(caps(c).canShowStatusFacet, false);
  c.stop();
});

test("verification failure is fail-closed and does not authorize approval", async () => {
  const c = signedIn();
  const check = deferred<BookmarkCheckResult>();
  c.send({ type: "BOOKMARK_CHECK_REQUESTED", queryKey: a, sessionKey: session, execute: () => check.promise });
  check.reject(new Error("temporary SPARQL failure"));
  await settleActor();
  assert.equal(c.getSnapshot().context.bookmark, "error");
  assert.equal(caps(c).canApproveProvider, false);
  c.stop();
});

test("access controllers are isolated and survive Strict Mode stop/start", () => {
  const c = signedIn(); const other = createMaestroAccessController(); other.start();
  c.send({ type: "BOOKMARK_CONFIRMED", queryKey: a, bookmarkId: "one" });
  assert.equal(caps(other).canShowStatusFacet, false);
  c.stop(); c.start();
  assert.equal(caps(c).canUsePersonalStore, false);
  c.send({ type: "SESSION_OBSERVED", restored: true, sessionKey: session });
  c.send({ type: "QUERY_CHANGED", queryKey: a });
  assert.equal(caps(c).canShowStatusFacet, false, "a new actor requires re-verification");
  c.stop(); other.stop();
});

 test("personal readiness and HTTP traffic signals are independent, scoped to the current session",()=>{
  const c=createMaestroAccessController();c.start();
  c.send({type:"SESSION_OBSERVED",restored:true,sessionKey:session});
  c.send({type:"AUTH_STATUS_OBSERVED",sessionKey:session,state:"success",status:200,at:1});
  assert.equal(caps(c).canUsePersonalStore,false);assert.notEqual(caps(c).userSignal,"green");
  c.send({type:"POLICY_STATUS_OBSERVED",sessionKey:session,stage:"ready"});
  assert.equal(caps(c).canUsePersonalStore,true);assert.equal(caps(c).userSignal,"green");
  c.send({type:"AUTH_STATUS_OBSERVED",sessionKey:session,state:"rejected",status:401,at:2});
  assert.equal(caps(c).canUsePersonalStore,true);assert.equal(caps(c).userSignal,"amber");
  c.send({type:"AUTH_STATUS_OBSERVED",sessionKey:session,state:"degraded",status:504,at:3});
  assert.equal(caps(c).canUsePersonalStore,true);assert.equal(caps(c).userSignal,"red");
  c.send({type:"POLICY_STATUS_OBSERVED",sessionKey:session,stage:"failed"});
  assert.equal(caps(c).canUsePersonalStore,true,"late verification cannot revoke an initialized session");
  c.send({type:"AUTH_STATUS_OBSERVED",sessionKey:session,state:"success",status:200,at:4});
  assert.equal(caps(c).userSignal,"green");
  c.send({type:"SESSION_OBSERVED",restored:true,sessionKey:""});
  c.send({type:"AUTH_STATUS_OBSERVED",sessionKey:session,state:"success",status:200,at:5});
  assert.equal(caps(c).canUsePersonalStore,false);assert.notEqual(caps(c).userSignal,"green");c.stop();
});

test("first challenge pulses only until ready; restored sessions never pulse", () => {
  const first = createMaestroAccessController(); first.start();
  first.send({type:"SESSION_OBSERVED",restored:true,sessionKey:""});
  first.send({type:"LOGIN_ACTIVITY",pending:true});
  assert.notEqual(caps(first).userSignal,"pulsingAmber");
  first.send({type:"AUTH_CHALLENGE_SENT"});
  assert.equal(caps(first).userSignal,"pulsingAmber");
  first.send({type:"AUTH_STATUS_OBSERVED",sessionKey:"",state:"success",status:200,at:1});
  first.send({type:"SESSION_OBSERVED",restored:true,sessionKey:session});
  assert.equal(caps(first).userSignal,"pulsingAmber");
  first.send({type:"LOGIN_ACTIVITY",pending:false});
  assert.equal(caps(first).userSignal,"pulsingAmber");
  first.send({type:"POLICY_STATUS_OBSERVED",sessionKey:session,stage:"ready"});
  assert.equal(caps(first).userSignal,"green");
  first.send({type:"LOGIN_ACTIVITY",pending:false});
  const restored=createMaestroAccessController(); restored.start();
  restored.send({type:"SESSION_OBSERVED",restored:true,sessionKey:session});
  assert.notEqual(caps(restored).userSignal,"pulsingAmber");
  restored.send({type:"AUTH_STATUS_OBSERVED",sessionKey:session,state:"success",status:200,at:1});
  assert.notEqual(caps(restored).userSignal,"green");
  assert.notEqual(caps(restored).userSignal,"pulsingAmber");
  restored.send({type:"POLICY_STATUS_OBSERVED",sessionKey:session,stage:"ready"});
  assert.equal(caps(restored).userSignal,"green");
  first.stop(); restored.stop();
});
