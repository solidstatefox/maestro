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

test("restoration and sign-out deny all personal UI without credentials", () => {
  const c = createMaestroAccessController(); c.start();
  assert.equal(caps(c).canUsePersonalStore, false);
  c.send({ type: "SESSION_OBSERVED", restored: true, sessionKey: "" });
  assert.equal(c.getSnapshot().value, "signedOut");
  assert.equal(caps(c).canMutatePersonalStore, false);
  c.send({ type: "SESSION_OBSERVED", restored: true, sessionKey: session });
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
