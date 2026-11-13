import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { selectedFacetCount, selectedFacetLabel } from "../src/lib/selected-facet-presentation";
import { isCoercibleNumericLexical, numericFacetBinding, guardedNumericRangeFilter, NUMERIC_FACET_PROJECTION } from "../src/lib/virtuoso-numeric-coercion";
import { buildFctCountSparql } from "../src/lib/fct-count-sparql";
import type { FctQueryTree } from "../src/lib/fct-query-api";

const read = (filename: string) => readFileSync(filename, "utf8");

test("Selected Properties and Roles show unknown counts without fake zeros or QName fallback", () => {
  assert.equal(selectedFacetCount(undefined), null);
  assert.equal(selectedFacetCount(null), null);
  assert.equal(selectedFacetCount(0), 0);
  assert.equal(selectedFacetCount(32), 32);
  assert.equal(selectedFacetLabel("http://dbpedia.org/property/utcOffset", "Property"), "UTC offset");
  assert.equal(selectedFacetLabel("http://dbpedia.org/property/timezone", "Role"), "timezone");
  assert.equal(selectedFacetLabel("http://dbpedia.org/property/timezone", "Property", "Time zone"), "Time zone");
  const source = read("src/canvas/left/configure-pane.tsx");
  assert.match(source, /selectedFacetCount\(facet\?\.count\)/);
  assert.match(source, /selectedFacetLabel\(key,/);
  assert.match(source, /<DistinctCount tree=\{queryTree\} kind=\{group === "Properties" \? "property" : "role"\}/);
  assert.doesNotMatch(source, /count: facet\?\.count \?\? 0/);
});

test("Selected Categories preserve query-selected classes but no longer forge counts in enumeration", () => {
  const controller = read("src/canvas/utils/workspace-controller.tsx");
  const block = controller.slice(controller.indexOf("const classDisplayFacets ="), controller.indexOf("const categoryMetadataUrisKey ="));
  assert.match(block, /const classDisplayFacets = classFacets/);
  assert.match(block, /const selectedClassDisplayFacets = Array\.from\(selectedClasses/);
  assert.doesNotMatch(block, /selectedClasses\)[\s\S]*?map\(\(uri\) => \(\{ uri, label: uri, count: 0 \}\)\)/);
  const ui = read("src/canvas/left/filter-pane.tsx");
  assert.match(ui, /selectedFacetCount\(classFacets\.find/);
  assert.match(ui, /count === null \? "—"/);
  assert.match(ui, /selectedFacetLabel\(item\.uri, "Class", item\.label\)/);
});

test("Coercible numeric mode recognizes finite signed decimal and scientific values only", () => {
  for (const input of ["-20", "+3.125", " -0.07 ", ".5", "-2.", "1.5e-3", "2E+4", "0", "330.0"]) {
    assert.equal(isCoercibleNumericLexical(input), true, input);
  }
  for (const input of ["", "NaN", "Infinity", "12°C", "+05:30", "-20..0", "1e9999", "1,234", "13 degrees"]) {
    assert.equal(isCoercibleNumericLexical(input), false, input);
  }
  assert.match(numericFacetBinding(), /bif:number\(bif:trim\(STR\(\?facetValue\)\)\)/);
  assert.match(numericFacetBinding(), /bif:isfinitenumeric\(\?facetNumber\)/);
  assert.match(guardedNumericRangeFilter("?v", ">=", "-12.5"), /IF\(REGEX[\s\S]+bif:number[\s\S]+>= -12\.5, false/);
});

test("Approved numeric provider declares guarded coercion and scalar MIN/MAX projections", () => {
  const ttl = read("graph/numeric/provider.ttl");
  assert.match(ttl, /mui:numericCoercion "finite-lexical-v1"/);
  assert.match(ttl, /mui:expression "\?facetNumber"/);
  assert.match(ttl, /sh:pattern/);
  const route = read("src/app/proxy/api/service/handlers/personal-facet-providers.ts");
  assert.match(route, /COERCIBLE_NUMERIC_MODE/);
  assert.match(route, /readPolicyApprovals\(request\)/);

  const tree: FctQueryTree = {
    name: "query", attributes: { id: "a", ctr: "14", addr: "https://example.org/graph@https://example.org/sparql" }, children: [
      { id: "c", name: "class", attributes: { iri: "https://example.org/Class" }, children: [] },
      { id: "b", uiKey: "query-view", name: "view", attributes: { type: "list", limit: "30" }, children: [] },
    ],
  };
  const projections = [
    { aggregate: "MIN" as const, expression: NUMERIC_FACET_PROJECTION, alias: "min" },
    { aggregate: "MAX" as const, expression: NUMERIC_FACET_PROJECTION, alias: "max" },
  ];
  const query = buildFctCountSparql(tree, { predicate: "https://example.org/temperature", projections });
  assert.ok(query);
  assert.match(query, /COUNT\(DISTINCT \?fct0\) AS \?ct/);
  assert.match(query, /MIN\(\?facetNumber\) AS \?min/);
  assert.match(query, /MAX\(\?facetNumber\) AS \?max/);
  assert.match(query, /OPTIONAL \{ GRAPH <https:\/\/example.org\/graph> \{ \?fct0 <https:\/\/example.org\/temperature> \?facetValue/);
  assert.match(query, /BIND \(IF\(REGEX/);
  assert.match(query, /bif:isfinitenumeric/);
  assert.equal(buildFctCountSparql(tree, { predicate: "https://example.org/temperature", projections: [{...projections[0],expression: "bif:eval(?facetValue)" as never}] }),null);

  const ranged: FctQueryTree = { ...tree, children: [
    tree.children[0],
    { id: "d", name: "property", attributes: { iri: "https://example.org/temperature" }, children: [
      { id: "e", name: "value", attributes: { datatype: "double", coerce: "numeric", rangeStart: "-10.5", rangeEnd: "2.25" }, text: "", children: [] },
    ] },
    tree.children[1],
  ] };
  const rangedCount = buildFctCountSparql(ranged);
  assert.ok(rangedCount);
  assert.match(rangedCount, /IF\(REGEX\(bif:trim\(STR\(\?fct1\)\)/);
  assert.match(rangedCount, /bif:number\(bif:trim\(STR\(\?fct1\)\)\)/);
  assert.match(rangedCount, />= "-10\.5"\^\^<http:\/\/www\.w3\.org\/2001\/XMLSchema#double>/);
});

test("Slider writes explicit numeric coercion for both FCT count and results compiler", () => {
  const controller = read("src/canvas/utils/workspace-controller.tsx");
  assert.match(controller, /coerce: "numeric"/);
  const countCompiler = read("src/lib/fct-count-sparql.ts");
  const resultCompiler = read("src/lib/fct-sparql-translator.ts");
  assert.match(countCompiler, /guardedNumericRangeFilter/);
  assert.match(resultCompiler, /node\.attributes\.coerce === "numeric"/);
  assert.match(resultCompiler, /"bif:number"/);
});
