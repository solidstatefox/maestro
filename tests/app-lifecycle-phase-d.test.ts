import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createMaestroProviderDiscoveryController,
  createMaestroProviderInstanceController,
  selectProviderMatches,
  type ProviderMatches,
} from "../src/lib/app-lifecycle/providers";
import { createMaestroProviderCatalogController, selectProviderCatalog } from "../src/lib/app-lifecycle/provider-catalog";

const numeric: ProviderMatches = {
  temporal: [], tags: [],
  numeric: [{ uri: "urn:provider:numeric", eligibleProperties: ["urn:prop:year"], projections: [
    { aggregate: "MIN", expression: "xsd:decimal(?facetValue)", alias: "min" },
    { aggregate: "MAX", expression: "xsd:decimal(?facetValue)", alias: "max" },
  ] }],
};
const noMatches: ProviderMatches = { temporal: [], numeric: [], tags: [] };
const evidence = JSON.stringify({ "urn:prop:year": ["http://www.w3.org/2001/XMLSchema#integer"] });
const emptyEvidence = JSON.stringify({ "urn:prop:year": [] });
const dateEvidence = JSON.stringify({ "urn:prop:year": ["http://www.w3.org/2001/XMLSchema#date"] });
const scoped = (c: ReturnType<typeof createMaestroProviderDiscoveryController>, key = "q1", applicability = "graph+focus+year", types = evidence) =>
  selectProviderMatches(c.getSnapshot(), key, applicability, types);
function ready() {
  const c = createMaestroProviderDiscoveryController(); c.start();
  c.send({ type: "DISCOVERY_STARTED", requestKey: "q1", applicabilityKey: "graph+focus+year", evidenceKey: evidence });
  c.send({ type: "DISCOVERY_RESOLVED", requestKey: "q1", matches: numeric, evidenceKey: evidence });
  return c;
}

test("provider applicability is authorized only by server SHACL + approval results", () => {
  const c = createMaestroProviderDiscoveryController(); c.start();
  assert.equal(scoped(c).numeric.length, 0);
  c.send({ type: "DISCOVERY_STARTED", requestKey: "q1", applicabilityKey: "graph+focus+year", evidenceKey: evidence });
  assert.equal(scoped(c).phase, "discovering");
  assert.equal(scoped(c).numeric.length, 0);
  c.send({ type: "DISCOVERY_RESOLVED", requestKey: "q1", matches: numeric, evidenceKey: evidence });
  assert.equal(scoped(c).numeric[0]?.eligibleProperties[0], "urn:prop:year");
  assert.equal(scoped(c).phase, "ready");
  c.stop();
});

test("new focus, graph, or provider-query scope immediately hides an old slider", () => {
  const c = ready();
  assert.equal(scoped(c, "q2", "other-graph+focus", evidence).numeric.length, 0);
  c.send({ type: "DISCOVERY_STARTED", requestKey: "q2", applicabilityKey: "other-graph+focus", evidenceKey: evidence });
  assert.equal(scoped(c, "q2", "other-graph+focus", evidence).numeric.length, 0);
  c.send({ type: "DISCOVERY_RESOLVED", requestKey: "q1", matches: numeric, evidenceKey: evidence });
  assert.equal(scoped(c, "q2", "other-graph+focus", evidence).phase, "discovering");
  c.send({ type: "DISCOVERY_RESOLVED", requestKey: "q2", matches: noMatches, evidenceKey: evidence });
  assert.equal(scoped(c, "q2", "other-graph+focus", evidence).phase, "empty");
  c.stop();
});

test("numeric selection refresh retains only an earlier validated same-scope match", () => {
  const c = ready();
  // The range-bound live query lost its own datatype evidence during refresh.
  c.send({ type: "DISCOVERY_STARTED", requestKey: "q2", applicabilityKey: "graph+focus+year", evidenceKey: emptyEvidence });
  assert.equal(scoped(c, "q2", "graph+focus+year", emptyEvidence).numeric.length, 1);
  c.send({ type: "DISCOVERY_RESOLVED", requestKey: "q2", matches: noMatches, evidenceKey: emptyEvidence });
  assert.equal(scoped(c, "q2", "graph+focus+year", emptyEvidence).numeric.length, 1);
  assert.equal(scoped(c, "q2", "graph+focus+year", emptyEvidence).phase, "ready");
  c.stop();
});

test("new contradictory datatype evidence invalidates prior numeric applicability", () => {
  const c = ready();
  assert.equal(scoped(c, "q2", "graph+focus+year", dateEvidence).numeric.length, 0);
  c.send({ type: "DISCOVERY_STARTED", requestKey: "q2", applicabilityKey: "graph+focus+year", evidenceKey: dateEvidence });
  assert.equal(scoped(c, "q2", "graph+focus+year", dateEvidence).numeric.length, 0);
  c.send({ type: "DISCOVERY_RESOLVED", requestKey: "q2", matches: noMatches, evidenceKey: dateEvidence });
  assert.equal(scoped(c, "q2", "graph+focus+year", dateEvidence).phase, "empty");
  c.stop();
});

test("approval revision and logout close provider discovery, failures fail closed", () => {
  const c = ready();
  assert.equal(scoped(c, "q2", "new-approval-revision", evidence).numeric.length, 0);
  c.send({ type: "DISCOVERY_STARTED", requestKey: "q2", applicabilityKey: "new-approval-revision", evidenceKey: evidence });
  c.send({ type: "DISCOVERY_FAILED", requestKey: "q2", error: "SHACL unavailable" });
  assert.equal(scoped(c, "q2", "new-approval-revision", evidence).phase, "failed");
  assert.equal(scoped(c, "q2", "new-approval-revision", evidence).numeric.length, 0);
  c.send({ type: "DISCOVERY_INACTIVE" });
  assert.equal(scoped(c, "", "", emptyEvidence).phase, "inactive");
  c.stop();
});

test("per-widget actor follows applicability, domain loading, failure and ready", () => {
  const c = createMaestroProviderInstanceController(); c.start();
  c.send({ type: "INSTANCE_APPLICABLE", identity: "numeric|urn:prop:year" });
  c.send({ type: "INSTANCE_LOADING", identity: "numeric|urn:prop:year" });
  assert.equal(c.getSnapshot().value, "loading");
  c.send({ type: "INSTANCE_READY", identity: "previous-other-widget" });
  assert.equal(c.getSnapshot().value, "loading");
  c.send({ type: "INSTANCE_FAILED", identity: "numeric|urn:prop:year", error: "Domain timeout" });
  assert.equal(c.getSnapshot().value, "failed");
  c.send({ type: "INSTANCE_LOADING", identity: "numeric|urn:prop:year" });
  c.send({ type: "INSTANCE_READY", identity: "numeric|urn:prop:year" });
  assert.equal(c.getSnapshot().value, "ready");
  c.stop();
});

test("Providers catalog distinguishes FCT waiting, XSLT rendering, ready and empty", () => {
  const c = createMaestroProviderCatalogController(); c.start();
  c.send({ type: "CATALOG_WAITING", key: "query-a|policies" });
  assert.equal(selectProviderCatalog(c.getSnapshot(), "query-a|policies").loading, true);
  c.send({ type: "CATALOG_STARTED", key: "query-a|policies" });
  c.send({ type: "CATALOG_RENDERING", key: "query-a|policies" });
  assert.equal(selectProviderCatalog(c.getSnapshot(), "query-a|policies").phase, "rendering");
  c.send({ type: "CATALOG_RESOLVED", key: "query-a|policies", html: "<article>Policy</article>", count: 1 });
  assert.equal(selectProviderCatalog(c.getSnapshot(), "query-a|policies").html, "<article>Policy</article>");
  assert.equal(selectProviderCatalog(c.getSnapshot(), "query-b|formats").html, "");
  c.send({ type: "CATALOG_STARTED", key: "query-b|formats" });
  c.send({ type: "CATALOG_RESOLVED", key: "query-b|formats", html: "", count: 0 });
  assert.equal(selectProviderCatalog(c.getSnapshot(), "query-b|formats").phase, "empty");
  c.stop();
});

test("late old Providers responses cannot overwrite current results; cancel is sticky", () => {
  const c = createMaestroProviderCatalogController(); c.start();
  c.send({ type: "CATALOG_STARTED", key: "old" });
  c.send({ type: "CATALOG_STARTED", key: "new" });
  c.send({ type: "CATALOG_RESOLVED", key: "old", html: "stale", count: 1 });
  c.send({ type: "CATALOG_FAILED", key: "old", error: "stale failure" });
  assert.equal(selectProviderCatalog(c.getSnapshot(), "new").phase, "resolving");
  c.send({ type: "CATALOG_CANCELLED", key: "new" });
  assert.equal(selectProviderCatalog(c.getSnapshot(), "new").phase, "cancelled");
  c.send({ type: "CATALOG_RESOLVED", key: "new", html: "late", count: 1 });
  // Important: a late response after cancellation must never revive a catalog.
  assert.equal(selectProviderCatalog(c.getSnapshot(), "new").html, "");
  c.stop();
});

test("Strict Mode restarts and separate workspaces recreate empty actors", () => {
  const c = ready(); const other = createMaestroProviderDiscoveryController(); other.start();
  assert.equal(scoped(other).numeric.length, 0);
  c.stop(); c.start();
  assert.equal(scoped(c).numeric.length, 0);
  const providerCatalog = createMaestroProviderCatalogController(); providerCatalog.start();
  providerCatalog.send({ type: "CATALOG_STARTED", key: "x" });
  providerCatalog.stop(); providerCatalog.start();
  assert.equal(selectProviderCatalog(providerCatalog.getSnapshot(), "x").phase, "waitingForResults");
  providerCatalog.stop(); c.stop(); other.stop();
});
