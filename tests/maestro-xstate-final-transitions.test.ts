import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Parser } from "n3";
import { compileStatusMachines, clearCompiledStatusMachines, effectiveStatus,
  machineForTarget, STATUS_MUI, STATUS_RDFS, transitionStatus, transitionStatusTo,
  type StatusMachineRow } from "../src/lib/status-machine-runtime";
import { statusTransitionUpdate } from "../src/lib/status-machine-sparql";
import { createMaestroAccessController, selectMaestroCapabilities } from "../src/lib/app-lifecycle/access";
import { createMaestroRecordSessionController } from "../src/lib/app-lifecycle/record-session";
import { createMaestroProviderCatalogController, selectProviderCatalog } from "../src/lib/app-lifecycle/provider-catalog";
import { createMaestroOperationsController, selectMaestroExecution } from "../src/lib/app-lifecycle/operations";
import { createMaestroConfigureController, selectConfigure } from "../src/lib/app-lifecycle/configure";

const M = STATUS_MUI;
const R = `${STATUS_RDFS}Resource`;
const type = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const SH = "http://www.w3.org/ns/shacl#";

/** Parse the shipped RDF, not a hand-written duplicate of the transition map. */
function seededRows(): StatusMachineRow[] {
  const quads = new Parser().parse(readFileSync("graph/maestro-status-machines.ttl", "utf8"));
  const find = (subject: string, predicate: string) => quads
    .filter(q => q.subject.value === subject && q.predicate.value === predicate).map(q => q.object.value);
  const required = (s: string, p: string) => {
    const result = find(s, p);
    assert.equal(result.length, 1, `Expected one ${p} for ${s}`);
    return result[0];
  };
  const machines = quads.filter(q => q.predicate.value === type && q.object.value === `${M}StateMachineProvider`)
    .map(q => q.subject.value);
  const result: StatusMachineRow[] = [];
  for (const machine of machines) for (const target of find(machine, `${SH}targetClass`))
    for (const track of find(machine, `${M}statusTrack`))
      for (const transition of find(track, `${M}transition`)) {
        result.push({ machine, target, dimension: required(track, `${M}trackDimension`),
          initial: required(track, `${M}initialState`), from: required(transition, `${M}fromState`),
          trigger: required(transition, `${M}trigger`), to: required(transition, `${M}toState`),
          assertState: find(transition, `${M}assertState`)[0], digest: find(machine, `${M}implementationDigest`)[0] });
      }
  assert.ok(result.length >= 10, "The shipped RDF must define the resource and approval transitions.");
  return result;
}
const machines = compileStatusMachines(seededRows());
const resource = machineForTarget(machines, R);
const curator = machineForTarget(machines, `${M}CurationProvider`);
const classPolicy = machineForTarget(machines, `${M}ClassPolicy`);

function apply(assertions: readonly string[], target: string): string[] {
  const planned = transitionStatusTo(resource, assertions, target);
  if (!planned) return [...assertions];
  return assertions.filter(value => !planned.remove.includes(value))
    .concat(planned.add ? [planned.add] : []);
}

test("RDF resource tracks share one parallel XState machine without materializing initial values", () => {
  assert.deepEqual(effectiveStatus(resource, []), {
    [`${M}ReadStatus`]: `${M}Unseen`,
    [`${M}VisibilityStatus`]: `${M}Visible`,
    [`${M}StarStatus`]: `${M}Unstarred`,
  });
  assert.deepEqual(apply([], `${M}Seen`), [`${M}Seen`]);
  assert.deepEqual(apply([`${M}Seen`], `${M}Hidden`), [`${M}Seen`, `${M}Hidden`]);
  assert.deepEqual(apply([`${M}Seen`, `${M}Hidden`], `${M}Starred`), [`${M}Seen`, `${M}Hidden`, `${M}Starred`]);
  assert.deepEqual(apply([`${M}Seen`, `${M}Hidden`, `${M}Starred`], `${M}Visible`), [`${M}Seen`, `${M}Starred`]);
  assert.deepEqual(apply([`${M}Seen`, `${M}Starred`], `${M}Unstarred`), [`${M}Seen`]);
  assert.deepEqual(apply([`${M}Seen`], `${M}Unseen`), [`${M}Unseen`]);
  assert.equal(transitionStatusTo(resource, [`${M}Seen`], `${M}Seen`), null);
  assert.equal(transitionStatusTo(resource, [], `${M}Visible`), null);
});

test("RDF approval machines use asserted Approved and virtual Pending, without affecting the other targets", () => {
  for (const machine of [curator, classPolicy]) {
    assert.equal(effectiveStatus(machine, [])[`${M}ApprovalStatus`], `${M}Pending`);
    const approve = transitionStatusTo(machine, [], `${M}Approved`);
    assert.equal(approve?.add, `${M}Approved`);
    assert.deepEqual(approve?.remove, []);
    const revoke = transitionStatusTo(machine, [`${M}Approved`], `${M}Pending`);
    assert.equal(revoke?.add, null);
    assert.deepEqual(revoke?.remove, [`${M}Approved`]);
    assert.equal(transitionStatusTo(machine, [], `${M}Pending`), null);
  }
});

test("XState refuses conflicting assertions, unsupported targets, triggers, and nondeterministic RDF edges", () => {
  assert.throws(() => effectiveStatus(resource, [`${M}Seen`, `${M}Unseen`]), /Conflicting stored statuses/);
  assert.throws(() => transitionStatus(resource, [], `${M}NoSuchTrigger`), /not allowed/);
  assert.throws(() => transitionStatusTo(resource, [], `${M}Approved`), /Expected one RDF status track/);
  const row = seededRows().find(r => r.trigger === `${M}ViewRecord`)!;
  assert.throws(() => compileStatusMachines([...seededRows(), { ...row, to: `${M}Unseen` }]), /Nondeterministic RDF transition/);
});

test("shared SPARQL writer preserves other tracks and requires the observed source state", () => {
  const inputs = { machine: resource, graph: "urn:personal:status", resource: "urn:record:1", predicate: `${M}status` };
  const toSeen = transitionStatusTo(resource, [], `${M}Seen`)!;
  const first = statusTransitionUpdate({ ...inputs, transition: toSeen, assertions: [] });
  assert.match(first, /FILTER\(!BOUND\(\?old\)\)/);
  assert.match(first, /INSERT\s*\{\s*GRAPH/);
  assert.match(first, /mui#status>|ns\/ui#status>/);
  assert.doesNotMatch(first, /DELETE WHERE/);
  const toVisible = transitionStatusTo(resource, [`${M}Seen`, `${M}Hidden`, `${M}Starred`], `${M}Visible`)!;
  const second = statusTransitionUpdate({ ...inputs, transition: toVisible,
    assertions: [`${M}Seen`, `${M}Hidden`, `${M}Starred`] });
  assert.match(second, /FILTER\(BOUND\(\?old\) && \?old = <[^>]*Hidden>\)/);
  assert.match(second, /INSERT\s*\{\s*\}/);
  assert.doesNotMatch(second, /<[^>]*Seen>\s*\} \}/);
  assert.throws(() => statusTransitionUpdate({ ...inputs, graph: "not a URI", transition: toSeen, assertions: [] }), /Invalid status IRI/);
});

test("RDF machine cache keys include the full definition and invalidate on reseeding", () => {
  assert.equal(compileStatusMachines(seededRows()), compileStatusMachines(seededRows()));
  clearCompiledStatusMachines();
  assert.notEqual(compileStatusMachines(seededRows()), machines);
});

test("bookmark XState rejects late verification after a local bookmark or revoke", async () => {
  const c = createMaestroAccessController(); c.start();
  c.send({ type: "SESSION_OBSERVED", restored: true, sessionKey: "session-1" });
  c.send({ type: "QUERY_CHANGED", queryKey: "q1" });
  let completeFirst!: (value: { bookmarked: boolean; bookmarkId: string }) => void;
  const first = new Promise<{ bookmarked: boolean; bookmarkId: string }>(resolve => { completeFirst = resolve; });
  c.send({ type: "BOOKMARK_CHECK_REQUESTED", sessionKey: "session-1", queryKey: "q1", execute: () => first });
  c.send({ type: "BOOKMARK_CONFIRMED", queryKey: "q1", bookmarkId: "urn:bookmark" });
  completeFirst({ bookmarked: false, bookmarkId: "" });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(selectMaestroCapabilities(c.getSnapshot(), { queryKey: "q1" }).canShowStatusFacet, true);
  let failSecond!: (reason: Error) => void;
  const second = new Promise<{ bookmarked: boolean; bookmarkId: string }>((_, reject) => { failSecond = reject; });
  c.send({ type: "BOOKMARK_CHECK_REQUESTED", sessionKey: "session-1", queryKey: "q1", execute: () => second });
  c.send({ type: "BOOKMARK_REVOKED", queryKey: "q1" });
  failSecond(new Error("stale verification failure"));
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(selectMaestroCapabilities(c.getSnapshot(), { queryKey: "q1" }).canShowStatusFacet, false);
  assert.equal(c.getSnapshot().context.bookmark, "unbookmarked");
  const oldQueryCheck = new Promise<{ bookmarked: boolean; bookmarkId: string }>(resolve => {
    queueMicrotask(() => resolve({ bookmarked: true, bookmarkId: "stale" }));
  });
  c.send({ type: "BOOKMARK_CHECK_REQUESTED", sessionKey: "session-1", queryKey: "q1", execute: () => oldQueryCheck });
  c.send({ type: "QUERY_CHANGED", queryKey: "q2" });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(selectMaestroCapabilities(c.getSnapshot(), { queryKey: "q2" }).canShowStatusFacet, false);
  const oldSessionCheck = new Promise<{ bookmarked: boolean; bookmarkId: string }>(resolve => {
    queueMicrotask(() => resolve({ bookmarked: true, bookmarkId: "old" }));
  });
  c.send({ type: "BOOKMARK_CHECK_REQUESTED", sessionKey: "session-1", queryKey: "q2", execute: () => oldSessionCheck });
  c.send({ type: "SESSION_OBSERVED", restored: true, sessionKey: "session-2" });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(c.getSnapshot().context.bookmarkId, "");
  c.stop();
});

test("Record XState rejects late keyed completions after cancel, new selection, reset and restart", () => {
  const c = createMaestroRecordSessionController(); c.start(); c.selectRecord("record-a");
  c.operation("format", "OP_STARTED", "record-a", "request-1");
  c.operation("format", "OP_CANCELLED", "record-a", "request-1");
  c.operation("format", "OP_SUCCEEDED", "record-a", "request-1");
  c.send({ type: "OP_FAILED", key: "record-a", operation: "format", requestId: "request-1", error: "late" });
  assert.equal(c.getSnapshot().context.phases.format, "idle");
  c.operation("format", "OP_STARTED", "record-a", "request-2");
  c.operation("format", "OP_SUCCEEDED", "record-a", "request-1");
  assert.equal(c.getSnapshot().context.phases.format, "loading");
  c.selectRecord("record-b");
  c.send({ type: "OP_FAILED", key: "record-a", operation: "validation", error: "old record" });
  assert.equal(c.getSnapshot().context.errors.validation, "");
  c.operation("format", "OP_STARTED", "record-b", "request-3");
  c.operation("format", "OP_SUCCEEDED", "record-b", "request-3");
  assert.equal(c.getSnapshot().context.phases.format, "ready");
  c.stop(); c.start();
  assert.equal(c.getSnapshot().context.key, "");
  c.stop();
});

test("Provider XState keeps finished catalog visible and cancels only in-flight requests", () => {
  const c = createMaestroProviderCatalogController(); c.start();
  c.send({ type: "CATALOG_STARTED", key: "q1" });
  c.send({ type: "CATALOG_RESOLVED", key: "q1", html: "<p>OK</p>", count: 1 });
  c.send({ type: "CATALOG_CANCELLED", key: "q1" });
  assert.equal(selectProviderCatalog(c.getSnapshot(), "q1").html, "<p>OK</p>");
  c.send({ type: "CATALOG_STARTED", key: "q2" });
  c.send({ type: "CATALOG_CANCELLED", key: "q2" });
  c.send({ type: "CATALOG_RESOLVED", key: "q2", html: "stale", count: 1 });
  assert.equal(selectProviderCatalog(c.getSnapshot(), "q2").html, "");
  c.stop();
});

test("Graph and query XState preserve identity gates through failure and successful retry", () => {
  const c = createMaestroOperationsController(); c.start();
  c.send({ type: "GRAPH_OBSERVED", key: "server-a", registryReady: true, selected: true, ready: false, failed: true });
  c.send({ type: "QUERY_OBSERVED", key: "query-a", hydrated: true, graphReady: false });
  assert.equal(c.getSnapshot().graph.phase, "unavailable");
  assert.equal(selectMaestroExecution(c.getSnapshot(), {graphKey:"server-a", queryKey:"query-a", hydrated:true, sourceReady:false}).canExecuteQuery, false);
  c.send({ type: "GRAPH_OBSERVED", key: "server-a", registryReady: true, selected: true, ready: true, failed: false });
  c.send({ type: "QUERY_OBSERVED", key: "query-a", hydrated: true, graphReady: true });
  assert.equal(c.getSnapshot().graph.phase, "ready");
  assert.equal(selectMaestroExecution(c.getSnapshot(), {graphKey:"server-a", queryKey:"query-a", hydrated:true, sourceReady:true}).canExecuteQuery, true);
  c.send({ type: "RESULTS_STARTED", key: "query-a" });
  c.send({ type: "RESULTS_FAILED", key: "query-old" });
  assert.equal(c.getSnapshot().query.phase, "executing");
  c.send({ type: "RESULTS_CANCELLED", key: "query-a" });
  c.send({ type: "RESULTS_SUCCEEDED", key: "query-a" });
  assert.equal(c.getSnapshot().query.phase, "cancelled");
  c.send({ type: "GRAPH_OBSERVED", key: "server-b", registryReady: true, selected: true, ready: false, failed: true });
  assert.equal(selectMaestroExecution(c.getSnapshot(), {graphKey:"server-b", queryKey:"query-a", hydrated:true, sourceReady:true}).canExecuteQuery, false);
  c.stop();
});

test("Configure XState abandons draft on source change; late commit cannot publish it", () => {
  const c = createMaestroConfigureController(); c.start();
  c.send({ type:"BEGIN", group:"Properties", sourceKey:"q1" });
  c.send({ type:"ASSIGN", key:"urn:property", uid:"urn:widget" });
  c.send({ type:"COMMIT", sourceKey:"q1" });
  c.send({ type:"SOURCE_CHANGED", sourceKey:"q2" });
  c.send({ type:"COMMITTED" });
  assert.deepEqual(selectConfigure(c.getSnapshot()).membership, {});
  assert.equal(selectConfigure(c.getSnapshot()).phase, "idle");
  c.stop();
});
