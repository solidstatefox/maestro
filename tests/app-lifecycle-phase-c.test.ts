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

test("Providers Return is captured once, not replaced by subsequent ribbon queries", () => {
  const c = ready();
  const observe = (key: string, url: string, isProviderQuery: boolean, tab: "browse" | "view" | "analyze" = "view", restoringHistory = false) =>
    c.send({ type: "NAVIGATION_OBSERVED", key, url, hydrated: true, tab, isProviderQuery, restoringHistory });
  observe("browse-query", "https://maestro.test/?q=browse", false, "browse");
  c.send({ type: "PROVIDERS_ENTRY_REQUESTED", fromUrl: "https://maestro.test/?q=browse" });
  // The endpoint selector may briefly rewrite addr before the Providers FCT query is installed.
  observe("browse-query-intermediate", "https://maestro.test/?q=personal-endpoint", false, "browse");
  observe("providers-policies", "https://maestro.test/?q=policy", true);
  assert.equal(c.getSnapshot().navigation.returnUrl, "https://maestro.test/?q=browse");
  observe("providers-formats", "https://maestro.test/?q=formats", true);
  assert.equal(c.getSnapshot().navigation.returnUrl, "https://maestro.test/?q=browse");
  observe("history-query", "https://maestro.test/?q=history", false, "browse");
  assert.equal(c.getSnapshot().navigation.returnUrl, "");
  observe("providers-fsm", "https://maestro.test/?q=fsm", true, "view", true);
  assert.equal(c.getSnapshot().navigation.returnUrl, "", "History restoration never invents Return destination");
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
