import { test } from "node:test";
import assert from "node:assert/strict";
import { createMaestroLifecycleRegistry, LIFECYCLE_DOMAINS } from "../src/lib/app-lifecycle/coordinator";
import { projectAppLifecycle, type AppLifecycleFacts } from "../src/canvas/diagnostics/use-app-lifecycle-observer";

const base: AppLifecycleFacts = {
  authRestored: false, signedIn: false, personalStoreReady: false,
  graphRegistryReady: false, selectedServerExists: false,
  selectedServerReady: false, selectedServerFailed: false,
  queryHydrated: false, queryStarted: false, queryReady: false,
  queryLoading: false, queryError: false, bookmarkVerified: false,
  queryBookmarked: false, presentationTab: "browse", viewProvidersOpen: false,
  providerCatalogLoading: false, providerCatalogError: false, returnAvailable: false,
  recordSelected: false, recordLoading: false, recordReady: false,
  recordError: false, requestBusy: false,
};

test("boot observations are passive, private, and read-only", () => {
  const registry = createMaestroLifecycleRegistry();
  assert.equal(registry.getSnapshot().running, false);
  assert.equal(registry.getSnapshot().observed.providers.state, "unobserved");
  assert.equal(registry.getSnapshot().observed.configure.state, "unobserved");
  registry.start();
  registry.observe(projectAppLifecycle(base));
  const snapshot = registry.getSnapshot();
  assert.equal(snapshot.observed.authentication.state, "restoring");
  assert.equal(snapshot.observed.liveQuery.state, "hydrating");
  assert.equal(snapshot.observed.bookmark.state, "unavailable");
  assert.equal(snapshot.observed.presentation.state, "browse");
  assert.deepEqual(LIFECYCLE_DOMAINS.length, 12);
  assert.equal(registry.observationSnapshot("authentication")?.state, "restoring");
  assert.equal(registry.coordinatorSnapshot()?.context.observations, snapshot.observations);
  registry.stop();
});

test("login, bookmark verification, navigation and logout observations", () => {
  const registry = createMaestroLifecycleRegistry();
  registry.start();
  registry.observe(projectAppLifecycle(base));
  registry.observe(projectAppLifecycle({ ...base, authRestored: true, signedIn: true, personalStoreReady: true,
    graphRegistryReady: true, selectedServerExists: true, selectedServerReady: true,
    queryHydrated: true, queryStarted: true, queryReady: true,
    bookmarkVerified: true, queryBookmarked: true, presentationTab: "view", viewProvidersOpen: true }));
  let s = registry.getSnapshot();
  assert.equal(s.observed.authentication.state, "signedIn");
  assert.equal(s.observed.personalStore.state, "ready");
  assert.equal(s.observed.graphServer.state, "ready");
  assert.equal(s.observed.bookmark.state, "bookmarked");
  assert.equal(s.observed.providerCatalog.state, "ready");
  registry.observe(projectAppLifecycle({ ...base, authRestored: true, queryHydrated: true, selectedServerExists: true }));
  s = registry.getSnapshot();
  assert.equal(s.observed.authentication.state, "signedOut");
  assert.equal(s.observed.bookmark.state, "unavailable");
  assert.equal(s.observed.liveQuery.state, "waitingForServer");
  registry.stop();
});

test("query, graph and Record transitions do not execute side effects", () => {
  const registry = createMaestroLifecycleRegistry();
  registry.start();
  let notifications = 0;
  const unsubscribe = registry.subscribe(() => { notifications++; });
  const loading = { ...base, authRestored: true, graphRegistryReady: true,
    selectedServerExists: true, selectedServerReady: true, queryHydrated: true,
    queryReady: true, queryStarted: true, queryLoading: true,
    recordSelected: true, recordLoading: true, requestBusy: true };
  registry.observe(projectAppLifecycle(loading));
  const old = registry.getSnapshot();
  registry.observe(projectAppLifecycle(loading));
  assert.strictEqual(registry.getSnapshot(), old, "identical observations produce no update");
  registry.observe(projectAppLifecycle({ ...loading, queryLoading: false,
    recordLoading: false, recordReady: true, requestBusy: false }));
  assert.equal(registry.getSnapshot().observed.liveQuery.state, "ready");
  assert.equal(registry.getSnapshot().observed.record.state, "ready");
  assert.equal(registry.getSnapshot().observed.requests.state, "idle");
  assert.equal(notifications, 2);
  unsubscribe();
  registry.stop();
});

test("React Strict Mode stop/start rehydrates actors and workspaces are isolated", () => {
  const a = createMaestroLifecycleRegistry();
  const b = createMaestroLifecycleRegistry();
  a.start(); b.start();
  a.observe(projectAppLifecycle({ ...base, authRestored: true, signedIn: true, personalStoreReady: true }));
  a.stop();
  a.start();
  assert.equal(a.observationSnapshot("authentication")?.state, "signedIn");
  assert.equal(b.getSnapshot().observed.authentication.state, "unobserved");
  a.stop(); b.stop();
});
