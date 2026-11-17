import { test } from "node:test";
import assert from "node:assert/strict";
import { createMaestroConfigureController, selectConfigure } from "../src/lib/app-lifecycle/configure";
import { createMaestroRecordSessionController } from "../src/lib/app-lifecycle/record-session";
import { RecordSessionsController } from "../src/canvas/controllers/record-session-model";

function draft() {
  const controller = createMaestroConfigureController();
  controller.start();
  controller.send({ type: "BEGIN", group: "Properties", sourceKey: "query-1" });
  controller.send({ type: "ASSIGN", key: "property:urn:a", uid: "a" });
  return controller;
}

test("Configure stages OR membership without changing the live query and commits atomically", () => {
  const controller = draft();
  assert.deepEqual(selectConfigure(controller.getSnapshot()).membership, { "property:urn:a": "a" });
  assert.equal(selectConfigure(controller.getSnapshot()).phase, "editing");
  controller.send({ type: "COMMIT", sourceKey: "wrong-query" });
  assert.equal(selectConfigure(controller.getSnapshot()).phase, "editing");
  controller.send({ type: "COMMIT", sourceKey: "query-1" });
  assert.equal(selectConfigure(controller.getSnapshot()).phase, "committing");
  controller.send({ type: "ASSIGN", key: "property:urn:b", uid: "a" });
  assert.equal(Object.keys(selectConfigure(controller.getSnapshot()).membership).length, 1);
  controller.send({ type: "COMMITTED" });
  assert.equal(selectConfigure(controller.getSnapshot()).phase, "idle");
  assert.equal(selectConfigure(controller.getSnapshot()).hasChanges, false);
  controller.stop();
});

test("Configure Close and external FCT navigation discard the draft, never commit it", () => {
  const controller = draft();
  controller.send({ type: "MENU", key: "property:urn:b" });
  assert.equal(selectConfigure(controller.getSnapshot()).menuFor, "property:urn:b");
  controller.send({ type: "SOURCE_CHANGED", sourceKey: "query-1" });
  assert.equal(selectConfigure(controller.getSnapshot()).phase, "editing");
  controller.send({ type: "SOURCE_CHANGED", sourceKey: "query-2" });
  assert.equal(selectConfigure(controller.getSnapshot()).phase, "idle");
  assert.deepEqual(selectConfigure(controller.getSnapshot()).membership, {});
  controller.send({ type: "BEGIN", group: "Roles", sourceKey: "query-2" });
  controller.send({ type: "ASSIGN", key: "property-of:urn:creator", uid: "b" });
  controller.send({ type: "CANCEL" });
  assert.equal(selectConfigure(controller.getSnapshot()).hasChanges, false);
  controller.stop();
});

test("Configure a failed commit preserves the draft for correction", () => {
  const controller = draft();
  controller.send({ type: "COMMIT", sourceKey: "query-1" });
  controller.send({ type: "COMMIT_FAILED", error: "Invalid OR UID" });
  assert.equal(selectConfigure(controller.getSnapshot()).phase, "editing");
  assert.equal(selectConfigure(controller.getSnapshot()).error, "Invalid OR UID");
  assert.equal(selectConfigure(controller.getSnapshot()).membership["property:urn:a"], "a");
  controller.stop();
});

const record = () => { const controller = createMaestroRecordSessionController(); controller.start(); return controller; };

test("Record description and policy are separate keyed lifecycles", () => {
  const controller = record();
  controller.selectRecord("record-A|graph-1");
  controller.operation("description", "OP_STARTED", "record-A|graph-1");
  controller.operation("policy", "OP_STARTED", "record-A|graph-1");
  controller.operation("description", "OP_SUCCEEDED", "record-A|graph-1");
  assert.equal(controller.getSnapshot().context.phases.description, "ready");
  assert.equal(controller.getSnapshot().context.phases.policy, "loading");
  controller.send({ type: "OP_FAILED", key: "record-A|graph-1", operation: "policy", error: "Policy unavailable" });
  controller.operation("policy", "OP_SUCCEEDED", "record-A|graph-1");
  assert.equal(controller.getSnapshot().context.phases.policy, "failed");
  assert.equal(controller.getSnapshot().context.errors.policy, "Policy unavailable");
  controller.stop();
});

test("An older format request for the same Record cannot cancel its replacement", () => {
  const controller = record();
  controller.selectRecord("A");
  controller.operation("format", "OP_STARTED", "A", "template-1");
  controller.operation("format", "OP_STARTED", "A", "template-2");
  controller.operation("format", "OP_CANCELLED", "A", "template-1");
  controller.operation("format", "OP_SUCCEEDED", "A", "template-1");
  assert.equal(controller.getSnapshot().context.phases.format, "loading");
  controller.operation("format", "OP_SUCCEEDED", "A", "template-2");
  assert.equal(controller.getSnapshot().context.phases.format, "ready");
  controller.stop();
});

test("Old Record completions cannot overwrite a newly selected session", () => {
  const controller = record();
  controller.selectRecord("A");
  controller.operation("format", "OP_STARTED", "A");
  controller.selectRecord("B");
  controller.operation("description", "OP_STARTED", "B");
  controller.operation("format", "OP_SUCCEEDED", "A");
  controller.send({ type: "OP_FAILED", key: "A", operation: "description", error: "late" });
  assert.equal(controller.getSnapshot().context.phases.format, "idle");
  assert.equal(controller.getSnapshot().context.phases.description, "loading");
  assert.equal(controller.getSnapshot().context.errors.description, "");
  controller.stop();
});

test("Record cancellation, validation, and formatting remain per session", () => {
  const left = record(); const right = record();
  left.selectRecord("A"); right.selectRecord("B");
  left.operation("format", "OP_STARTED", "A");
  right.operation("validation", "OP_STARTED", "B");
  left.operation("format", "OP_CANCELLED", "A");
  right.operation("validation", "OP_SUCCEEDED", "B");
  assert.equal(left.getSnapshot().context.phases.format, "idle");
  assert.equal(right.getSnapshot().context.phases.validation, "ready");
  left.send({ type: "CLOSE" });
  left.operation("description", "OP_STARTED", "A");
  assert.equal(left.getSnapshot().value, "closed");
  assert.equal(left.getSnapshot().context.phases.description, "idle");
  left.stop(); right.stop();
});

test("Discarding one pivot aborts only its requests; breadcrumb focus does not", () => {
  const trail = new RecordSessionsController({ value: "urn:root", termType: "uri", queryXml: "<query/>" });
  const first = trail.appendPivot({ value: "urn:first", termType: "uri", queryXml: "<query/>" },
    { subjectSessionId: "record-0", predicate: "urn:p", direction: "property" }, 0);
  const second = trail.appendPivot({ value: "urn:second", termType: "uri", queryXml: "<query/>" },
    { subjectSessionId: first.id, predicate: "urn:q", direction: "property" }, 1);
  const firstRequest = new AbortController(); const secondRequest = new AbortController();
  trail.registerRequest(first.id, firstRequest);
  trail.registerRequest(second.id, secondRequest);
  trail.focusSession(0);
  assert.equal(firstRequest.signal.aborted, false);
  assert.equal(secondRequest.signal.aborted, false);
  trail.disposeAfter(1);
  assert.equal(firstRequest.signal.aborted, false);
  assert.equal(secondRequest.signal.aborted, true);
  trail.shrink();
  assert.equal(firstRequest.signal.aborted, true);
});

test("Phase E controllers do not persist draft or loading state across stop/start", () => {
  const configure = draft();
  configure.stop(); configure.start();
  assert.equal(selectConfigure(configure.getSnapshot()).phase, "idle");
  const viewer = record(); viewer.selectRecord("A");
  viewer.operation("description", "OP_STARTED", "A");
  viewer.stop(); viewer.start();
  assert.equal(viewer.getSnapshot().context.phases.description, "idle");
  assert.equal(viewer.getSnapshot().context.key, "");
  configure.stop(); viewer.stop();
});
