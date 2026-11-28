import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { isValidRdfIri } from "../src/lib/rdf-iri";
import { activeBrowsePaneOrder, DEFAULT_BROWSE_PANE_ORDER, isBrowsePaneOrder, moveBrowsePane, readBrowsePaneOrder, type BrowsePane } from "../src/canvas/browse-pane-order";

const indiaSubject = "http://dbpedia.org/resource/K.K._Gopalakrishnan__K.\u202fK.\u202fGopalakrishnan__1";
test("RFC 3987 accepts the exact India incoming subject and valid Unicode IRIs", () => {
  for (const iri of [indiaSubject, "https://example.org/a\u00a0b", "https://例子.example/भारत#名", "urn:example:\u{1f600}", "https://example.org/%20", "https://[2001:db8::1]:8080/x", "https://example.org/?q=\ue000", "urn:example:a#b"]) assert.equal(isValidRdfIri(iri), true, iri);
});
test("IRI validation still rejects forbidden characters, malformed escapes and malformed components", () => {
  for (const iri of ["relative/path", "https://example.org/a b", "https://example.org/a\n", "https://example.org/a\t", "urn:a\u0000", "urn:a\u0085", "urn:a\ud800", "urn:a\uffff", "urn:a\ufdd0", "urn:a\ue000", "urn:a#\ue000", "urn:a%2", "urn:a%zz", "urn:a<b", 'urn:a"b', "urn:a\\b", "urn:a#b#c", "https://example.org:x/path", "https://[not-an-ip]/", "urn:" + "x".repeat(4096)]) assert.equal(isValidRdfIri(iri), false, JSON.stringify(iri));
});
test("both SHACL paths share the IRI guard and preserve raw RDF named node identity", () => {
  for (const file of ["src/lib/client-record-shacl.ts", "src/lib/shacl-standard-validation.ts"]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /isValidRdfIri as goodIri/);
    assert.match(source, /goodIri\(triple\.predicate\)/);
    assert.match(source, /rdf\.namedNode\(iriOrBlank\)/);
    assert.match(source, /datatypeTerm\(triple\.datatype\)/);
    assert.doesNotMatch(source, /const iriRe/);
  }
});
test("all possible pane moves are unique permutations with the target index occupied", () => {
  const permutations = DEFAULT_BROWSE_PANE_ORDER.flatMap(a => DEFAULT_BROWSE_PANE_ORDER.filter(b => b !== a).map(b => [a, b, DEFAULT_BROWSE_PANE_ORDER.find(c => c !== a && c !== b)!]));
  for (const order of permutations) for (const pane of order) for (const index of [0, 1, 2]) {
    const next = moveBrowsePane(order, pane, index);
    assert.equal(next[index], pane);
    assert.ok(isBrowsePaneOrder(next));
    assert.deepEqual(next.filter(p => p !== pane), order.filter(p => p !== pane));
    assert.deepEqual(readBrowsePaneOrder(JSON.stringify(next)), next);
    assert.deepEqual(activeBrowsePaneOrder(next, false), next[0] === "filters" ? ["filters", "results"] : ["results", "filters"]);
    assert.equal(activeBrowsePaneOrder(next, true), next);
  }
  assert.deepEqual(moveBrowsePane(DEFAULT_BROWSE_PANE_ORDER, "filters", 2), ["results", "record", "filters"]);
  assert.deepEqual(moveBrowsePane(DEFAULT_BROWSE_PANE_ORDER, "record", 0), ["record", "filters", "results"]);
});
test("malformed pane preferences and invalid moves cannot omit or duplicate panes", () => {
  for (const input of [null, "bad json", "null", '["record","record","filters"]', '["record","filters"]', '["record","filters","other"]']) assert.equal(readBrowsePaneOrder(input), DEFAULT_BROWSE_PANE_ORDER);
  for (const index of [-1, 3, 0.5, NaN]) assert.equal(moveBrowsePane(DEFAULT_BROWSE_PANE_ORDER, "record", index), DEFAULT_BROWSE_PANE_ORDER);
  assert.equal(moveBrowsePane(DEFAULT_BROWSE_PANE_ORDER, "invalid" as BrowsePane, 0), DEFAULT_BROWSE_PANE_ORDER);
});
test("Sheet uses one persisted preference and live keyed pane layout, including skeletons", () => {
  const source = (path: string) => readFileSync(path, "utf8");
  const workspace = source("src/canvas/workspace.tsx");
  const layout = source("src/canvas/browse-pane-layout.tsx");
  const control = source("src/canvas/sheet/browse-pane-order-control.tsx");
  assert.match(workspace, /activePaneOrder\.map\(\(pane, index\) => <Fragment key=\{pane\}>/);
  assert.match(workspace, /index < activePaneOrder\.length - 1 && <ResizableHandle/);
  assert.equal((workspace.match(/<ResizablePanelGroup\b/g) || []).length, 1);
  assert.match(workspace, /<FacetsLoadingSkeleton/);
  assert.match(workspace, /<ResultsLoadingSkeleton/);
  assert.match(workspace, /<GraphUnavailableRecord/);
  assert.match(layout, /maestroStorageGet\(BROWSE_PANE_ORDER_STORAGE_KEY\)/);
  assert.match(layout, /maestroStorageSet\(BROWSE_PANE_ORDER_STORAGE_KEY, JSON.stringify\(next\)\)/);
  assert.match(control, /onDrop=\{/);
  assert.match(control, /move\(pane, index - 1\)/);
  assert.match(control, /move\(pane, index \+ 1\)/);
  assert.match(source("src/canvas/sheet/settings-pane.tsx"), /<BrowsePaneOrderControl \/>/);
  assert.doesNotMatch(layout, /setQuery|replaceState|pushState|fetch\(/);
});
