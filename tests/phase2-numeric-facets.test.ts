import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildFctCountSparql } from "../src/lib/fct-count-sparql";
import type { FctQueryTree } from "../src/lib/fct-query-api";
const read = (path: string) => readFileSync(path, "utf8");

test("Map provider RDF and XSLT both omit the legend", () => {
  for (const file of ["graph/map/provider.ttl", "graph/map/perspective-ui.xsl"]) {
    const text = read(file);
    assert.doesNotMatch(text, /data-map-legend|legendRender|const legend =/);
    assert.match(text, /data-map-canvas/);
  }
});

test("Timeout master persists one full update rather than overwriting it row by row", () => {
  const sheet = read("src/canvas/sheet/settings-pane.tsx");
  assert.match(sheet, /writeMaestroWidgetTimeouts\(next\)/);
  const master = sheet.slice(sheet.indexOf("const applyMasterTimeout"),sheet.indexOf("const applyMasterLimit"));
  assert.doesNotMatch(master,/changeWidgetTimeout\(/);
});

test("Numeric facet provider declares SHACL datatypes, query projections, and a triple extension", () => {
  const ttl = read("graph/numeric/provider.ttl");
  assert.match(ttl, /a mui:Provider/);
  assert.match(ttl, /mui:accepts/);
  assert.match(ttl, /mui:NumericRangeFacetWidget/);
  assert.match(ttl, /mui:countTriple/);
  assert.match(ttl, /mui:countProjection/);
  assert.match(ttl, /mui:aggregate "MIN"/);
  assert.match(ttl, /mui:aggregate "MAX"/);
  assert.match(read("graph/manifest.json"), /numeric\/provider\.ttl/);
});

test("Numeric provider extends scalar count without removing the count or breaking graph scope", () => {
  const tree: FctQueryTree = {
    name: "query", attributes: { id: "a", ctr: "14", addr: "https://example.org/graph@https://example.org/sparql" }, children: [
      { id: "b", uiKey: "query-view", name: "view", attributes: { type: "list", limit: "30" }, children: [] },
    ],
  };
  const projections = [
    { aggregate: "MIN" as const, expression: "xsd:decimal(?facetValue)" as const, alias: "min" },
    { aggregate: "MAX" as const, expression: "xsd:decimal(?facetValue)" as const, alias: "max" },
  ];
  // A view-only query has no graph patterns and correctly fails closed.
  assert.equal(buildFctCountSparql(tree,{predicate:"https://example.org/numeric",projections}),null);
  tree.children.unshift({ id: "c", name: "class", attributes: { iri: "https://example.org/Class" }, children: [] });
  const query = buildFctCountSparql(tree,{predicate:"https://example.org/numeric",projections});
  assert.ok(query);
  assert.match(query,/PREFIX xsd: <http:\/\/www.w3.org\/2001\/XMLSchema#>/);
  assert.match(query,/COUNT\(DISTINCT \?fct0\) AS \?ct/);
  assert.match(query,/MIN\(xsd:decimal\(\?facetValue\)\) AS \?min/);
  assert.match(query,/MAX\(xsd:decimal\(\?facetValue\)\) AS \?max/);
  assert.match(query,/OPTIONAL \{ GRAPH <https:\/\/example.org\/graph> \{ \?fct0 <https:\/\/example.org\/numeric> \?facetValue/);
  assert.equal(buildFctCountSparql(tree,{predicate:"bad>uri",projections}),null);
  assert.equal(buildFctCountSparql(tree,{predicate:"https://example.org/numeric",projections:[{...projections[0],alias:"bad)"}]}),null);
});

test("Numeric UI uses shadcn vertical range slider beside checkbox list and writes FCT bounds", () => {
  const ui=read("src/canvas/left/personal-numeric-facet.tsx");
  assert.match(ui,/orientation="vertical"/);
  assert.match(ui,/h-52/);
  assert.match(ui,/onValueCommit/);
  assert.match(ui,/buildFctCountSparql/);
  const cards=read("src/canvas/left/personal-widget-cards.tsx");
  assert.match(cards,/<NumericFacetContent/);
  assert.match(cards,/type="checkbox"/);
  const controller=read("src/canvas/utils/workspace-controller.tsx");
  assert.match(controller,/setPersonalNumericRange/);
  assert.match(controller,/rangeStart: start/);
  assert.match(controller,/rangeEnd: end/);
});
