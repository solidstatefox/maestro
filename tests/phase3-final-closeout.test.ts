import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createBlankNodeRecordContext } from "../src/lib/bnode/lifecycle";
import { isBoundedReadOnlySparql } from "../src/lib/sparql-read-guard";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("blank-node Records select automatically and only allow siblings of the initial response-local node", () => {
  const context = createBlankNodeRecordContext();
  context.select("urn:record:test", "uri");
  assert.equal(context.begin(), false, "ordinary RDF terms cannot enter bnode logic");
  context.select("urn:record:test", "bnode");
  assert.equal(context.begin(), true);
  const membership = [{candidate:true,parents:["p"]},{candidate:true,parents:["q"]},{candidate:true,parents:["p"]},{candidate:false,parents:["p"]}];
  assert.equal(context.received("urn:record:test", membership, true, 2), 2);
  assert.equal(context.isChosen(2), true);
  assert.equal(context.choose(-1), false);
  assert.equal(context.choose(4), false);
  assert.equal(context.choose(1), false, "unrelated parent cannot be selected as sibling");
  assert.equal(context.choose(3), true, "a proven same-response sibling is selectable");
  assert.equal(context.choose(0), true);
  assert.equal(context.begin(), true);
  assert.equal(context.isChosen(0), false, "reload invalidates prior membership");
  assert.equal(context.received("urn:record:test", membership, false, 1), 1);
  assert.equal(context.choose(0), false, "new response has new seed and family");
  assert.equal(context.begin(), true);
  assert.equal(context.received("urn:record:test", membership.slice(0,1), true, 0), 0);
  assert.equal(context.choose(1), false);
  assert.equal(context.begin(), true);
  assert.equal(context.received("urn:record:test", [], false, -1), -1);
  assert.equal(context.choose(0), false, "an empty response has no selectable node");
  context.select("urn:record:new", "bnode");
  assert.equal(context.begin(), true);
  assert.equal(context.received("urn:record:test", membership, false, 0), -1);
  assert.equal(context.choose(0), false, "stale response cannot authorize selection");
  context.select("urn:record:next", "uri");
  assert.equal(context.begin(), false);
  context.stop();
});

test("query inspector exposes actual XML/SPARQL pairs and uses read-only proxy", () => {
  const configure = source("src/canvas/left/configure-pane.tsx");
  const inspector = source("src/canvas/utils/query-inspector.tsx");
  assert.match(configure, /primaryTabLabel="Properties XML"/);
  assert.match(configure, /Count XML \(first predicate\)/);
  assert.match(configure, /Count SPARQL \(first predicate\)/);
  assert.match(configure, /Kinds XML/);
  assert.match(configure, /Kinds SPARQL/);
  assert.match(configure, /compileFctXmlToSparql\(valuesXml\)/);
  // Execute must use the address of the displayed tab, not the active Browse query.
  assert.match(inspector, /const displayedExecutionAddr = \(showingCount \? countAddr : selectedExtraQuery\?\.addr\) \?\? addr \?\? sourceAddr/);
  assert.match(inspector, /JSON\.stringify\(\{ query: displayedCode, addr: displayedExecutionAddr \}\)/);
  assert.match(inspector, /executionAddr=\{displayedExecutionAddr\}/);
  assert.doesNotMatch(inspector, /JSON\.stringify\(\{ query: displayedCode, addr \}\)/);
  assert.match(inspector, /\/proxy\/api\/sparql/);
  assert.doesNotMatch(inspector, /\/proxy\/api\/execute/);
});

test("safe FCT DEFINE options execute but arbitrary query directives and mutations do not", () => {
  assert.ok(isBoundedReadOnlySparql('DEFINE input:inference "urn:rule"\nSELECT ?s WHERE {?s ?p ?o} LIMIT 5', 10000));
  assert.ok(isBoundedReadOnlySparql('PREFIX ex: <urn:>\nDEFINE input:same-as "yes"\nSELECT ?s WHERE {?s ?p ?o} LIMIT 5', 10000));
  assert.ok(!isBoundedReadOnlySparql('DEFINE sql:log-enable 2\nSELECT ?s WHERE {?s ?p ?o}', 10000));
  assert.ok(!isBoundedReadOnlySparql('INSERT DATA { GRAPH <urn:test> { <urn:x> <urn:y> <urn:z> } }', 10000));
  assert.ok(!isBoundedReadOnlySparql('SELECT ?s WHERE { SERVICE <urn:remote> {?s ?p ?o} }', 10000));
});

test("Record Graphs pagination retains completeness boundary and same FCT population", () => {
  const graph = source("src/lib/record-graph-marshalling.ts");
  const compiler = source("src/lib/fct-sparql-translator.ts");
  assert.match(graph, /loadCompleteRecordGraphList/);
  assert.match(graph, /if \(!response\.upstreamComplete\) throw/);
  assert.match(graph, /view\.setAttribute\("offset", String\(page \* limit\)\)/);
  assert.match(compiler, /limit, offset,\s*\}\);\s*\} else if \(graphOnly\)/);
  assert.doesNotMatch(graph, /\bpopulationProbe\b/);
});

test("Kanban is a seeded, curated Perspective provider using shared FCT grouping", () => {
  const ttl = source("graph/kanban/provider.ttl");
  const manifest = JSON.parse(source("graph/manifest.json")) as Record<string, string>;
  assert.equal(manifest["kanban/provider.ttl"], "shacl-policies");
  assert.match(ttl, /a mui:Provider/);
  assert.match(ttl, /a mui:PerspectiveWidget/);
  assert.match(ttl, /sh:targetClass vfct:query/);
  assert.match(ttl, /xsl:key name="by-column"/);
  assert.match(source("graph/maestro-curation-providers.ttl"), /gttp:\/\/ggg\.maestro\.ui\/provider\/kanban/);
  assert.match(source("src/canvas/utils/workspace-controller.tsx"), /kanbanGroupKey/);
});
