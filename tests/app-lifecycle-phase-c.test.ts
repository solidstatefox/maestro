import { test } from "node:test";
import assert from "node:assert/strict";
import { createMaestroOperationsController, selectMaestroExecution } from "../src/lib/app-lifecycle/operations";

const server = "graph-server-1";
const queryA = "fct-A";
const queryB = "fct-B";
function ready() {
  const controller = createMaestroOperationsController(); controller.start();
  controller.send({ type: "GRAPH_OBSERVED", key: server, registryReady: true, selected: true, ready: true, failed: false });
  controller.send({ type: "QUERY_OBSERVED", key: queryA, hydrated: true, graphReady: true });
  return controller;
}
const canExecute = (controller: ReturnType<typeof createMaestroOperationsController>, key = queryA, graphKey = server) =>
  selectMaestroExecution(controller.getSnapshot(), { graphKey, queryKey: key, hydrated: true, sourceReady: true }).canExecuteQuery;

test("graph readiness gates FCT until the exact selected graph server is healthy", () => {
  const c = createMaestroOperationsController(); c.start();
  c.send({ type: "GRAPH_OBSERVED", key: server, registryReady: false, selected: true, ready: false, failed: false });
  c.send({ type: "QUERY_OBSERVED", key: queryA, hydrated: true, graphReady: false });
  assert.equal(canExecute(c), false);
  c.send({ type: "GRAPH_OBSERVED", key: server, registryReady: true, selected: true, ready: true, failed: false });
  c.send({ type: "QUERY_OBSERVED", key: queryA, hydrated: true, graphReady: true });
  assert.equal(canExecute(c), true);
  assert.equal(canExecute(c, queryA, "other-server"), false);
  c.send({ type: "GRAPH_OBSERVED", key: server, registryReady: true, selected: true, ready: false, failed: true });
  c.send({ type: "QUERY_OBSERVED", key: queryA, hydrated: true, graphReady: false });
  assert.equal(canExecute(c), false);
  assert.equal(c.getSnapshot().graph.phase, "unavailable");
  c.stop();
});

test("stale Results completion cannot make another query ready", () => {
  const c = ready();
  c.send({ type: "RESULTS_STARTED", key: queryA });
  assert.equal(c.getSnapshot().query.phase, "executing");
  c.send({ type: "QUERY_OBSERVED", key: queryB, hydrated: true, graphReady: true });
  assert.equal(canExecute(c, queryB), true);
  c.send({ type: "RESULTS_SUCCEEDED", key: queryA });
  c.send({ type: "RESULTS_FAILED", key: queryA });
  assert.equal(c.getSnapshot().query.phase, "readyToExecute");
  c.send({ type: "RESULTS_STARTED", key: queryB });
  c.send({ type: "RESULTS_SUCCEEDED", key: queryB });
  assert.equal(c.getSnapshot().query.phase, "ready");
  c.stop();
});

test("query restoration and cancellation use the existing execution identity", () => {
  const c = ready();
  c.send({ type: "QUERY_OBSERVED", key: queryB, hydrated: false, graphReady: false });
  assert.equal(canExecute(c, queryB), false);
  assert.equal(c.getSnapshot().query.phase, "restoring");
  c.send({ type: "QUERY_OBSERVED", key: queryB, hydrated: true, graphReady: true });
  c.send({ type: "RESULTS_STARTED", key: queryB });
  c.send({ type: "RESULTS_CANCELLED", key: queryB });
  assert.equal(c.getSnapshot().query.phase, "cancelled");
  c.stop();
});

test("a captured Providers candidate does not start Return without explicit Features entry", () => {
  const c = ready();
  const observe = (key: string, url: string, isProviderQuery: boolean, tab: "browse" | "view" | "analyze" = "view", restoringHistory = false) =>
    c.send({ type: "NAVIGATION_OBSERVED", key, url, hydrated: true, tab, viewPanel: "providers", isProviderQuery, restoringHistory });
  observe("browse-query", "https://maestro.test/?q=browse", false, "browse");
  c.send({ type: "PROVIDERS_ENTRY_REQUESTED", fromUrl: "https://maestro.test/?q=browse" });
  // The endpoint selector may briefly rewrite addr before the Providers FCT query is installed.
  observe("browse-query-intermediate", "https://maestro.test/?q=personal-endpoint", false, "browse");
  observe("providers-policies", "https://maestro.test/?q=policy", true);
  assert.equal(c.getSnapshot().navigation.returnUrl, "https://maestro.test/?q=browse");
  assert.equal(c.getSnapshot().navigation.returnVisible, false, "a provider query alone must not initiate Return");
  observe("providers-formats", "https://maestro.test/?q=formats", true);
  assert.equal(c.getSnapshot().navigation.returnUrl, "https://maestro.test/?q=browse");
  assert.equal(c.getSnapshot().navigation.returnVisible, false);
  observe("history-query", "https://maestro.test/?q=history", false, "browse");
  assert.equal(c.getSnapshot().navigation.returnUrl, "");
  observe("providers-fsm", "https://maestro.test/?q=fsm", true, "view", true);
  assert.equal(c.getSnapshot().navigation.returnUrl, "", "History restoration never invents Return destination");
  c.stop();
});

test("Features initiates a persistent XState Return session; only Return or a new URL ends it", () => {
  const c = createMaestroOperationsController(); c.start();
  const observe = (tab: "browse" | "view" | "analyze", viewPanel: "trail" | "perspectives" | "providers",
    key = queryA, hydrated = true) => c.send({ type: "NAVIGATION_OBSERVED", key,
    url: `https://maestro.test/?q=${key}`, hydrated, tab, viewPanel,
    isProviderQuery: false, restoringHistory: false });
  assert.equal(c.getSnapshot().navigation.returnVisible, false);
  observe("browse", "trail");
  c.send({ type: "RIBBON_ENTRY_FROM_BROWSE", sourceKey: queryA, fromUrl: "https://maestro.test/?q=browse" });
  assert.equal(c.getSnapshot().navigation.returnVisible, false, "Browse candidate alone does not initiate Return");
  observe("view", "perspectives");
  assert.equal(c.getSnapshot().navigation.returnVisible, false);
  c.send({ type: "FEATURES_ENTERED", fromUrl: "https://maestro.test/?q=perspective" });
  assert.equal(c.getSnapshot().navigation.returnVisible, true, "selecting Features initiates Return immediately");
  assert.equal(c.getSnapshot().navigation.returnUrl, "https://maestro.test/?q=browse");
  observe("view", "providers");
  observe("view", "trail");
  assert.equal(c.getSnapshot().navigation.returnVisible, true, "leaving Features ribbon does not dismiss Return");
  observe("analyze", "providers");
  assert.equal(c.getSnapshot().navigation.returnVisible, true, "Analyze must not dismiss Return");
  observe("browse", "trail", queryB);
  assert.equal(c.getSnapshot().navigation.returnVisible, true, "Browse navigation must not dismiss Return");
  assert.equal(c.getSnapshot().navigation.returnUrl, "https://maestro.test/?q=browse", "return destination stays original");
  c.send({ type: "FEATURES_ENTERED", fromUrl: "https://maestro.test/?q=other" });
  assert.equal(c.getSnapshot().navigation.returnUrl, "https://maestro.test/?q=browse", "reentry must not overwrite saved Return");
  c.send({ type: "CONTEXT_RETURNED" });
  assert.equal(c.getSnapshot().navigation.returnVisible, false, "clicking Return terminates the session");
  assert.equal(c.getSnapshot().navigation.returnUrl, "");
  observe("view", "providers", queryB, false);
  assert.equal(c.getSnapshot().navigation.returnVisible, false, "a new URL/hydration may reset Return");
  c.stop();
});

test("Features can start Return from a Perspective even without prior Browse capture", () => {
  const c = createMaestroOperationsController(); c.start();
  c.send({ type: "NAVIGATION_OBSERVED", key: queryA, url: "https://maestro.test/?q=perspectives",
    hydrated: true, tab: "view", viewPanel: "perspectives", isProviderQuery: false, restoringHistory: false });
  c.send({ type: "FEATURES_ENTERED", fromUrl: "https://maestro.test/?q=perspectives" });
  assert.equal(c.getSnapshot().navigation.returnVisible, true);
  assert.equal(c.getSnapshot().navigation.returnUrl, "https://maestro.test/?q=perspectives");
  c.send({ type: "NAVIGATION_OBSERVED", key: queryB, url: "https://maestro.test/?q=new",
    hydrated: false, tab: "view", viewPanel: "providers", isProviderQuery: false, restoringHistory: false });
  assert.equal(c.getSnapshot().navigation.returnVisible, false);
  c.stop();
});

test("History navigation pending state is owned by the navigation actor", () => {
  const c = ready();
  c.send({ type: "HISTORY_NAVIGATION_PENDING", direction: "backward" });
  assert.equal(c.getSnapshot().navigation.historyPending, "backward");
  c.send({ type: "HISTORY_NAVIGATION_PENDING", direction: null });
  assert.equal(c.getSnapshot().navigation.historyPending, null);
  c.stop();
});

test("request actor observes actual queued and dispatched work without running requests", () => {
  const c = ready();
  c.send({ type: "REQUEST_ACTIVITY", queued: 3, active: 1 });
  assert.equal(c.getSnapshot().requests.queued, 3);
  assert.equal(c.getSnapshot().requests.active, 1);
  assert.equal(c.getSnapshot().requests.phase, "active");
  c.send({ type: "REQUEST_ACTIVITY", queued: 0, active: 0 });
  assert.equal(c.getSnapshot().requests.active, 0);
  c.stop();
});

test("Strict Mode stop/start and separate workspace actors fail closed", () => {
  const c = ready(); const other = createMaestroOperationsController(); other.start();
  assert.equal(canExecute(other), false);
  c.stop(); c.start();
  assert.equal(canExecute(c), false);
  c.send({ type: "RESULTS_SUCCEEDED", key: queryA });
  assert.equal(canExecute(c), false);
  c.stop(); other.stop();
});
