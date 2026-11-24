"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("transported ancestor reference is scope-qualified, persisted and projected by the real group query", () => {
  const source = read("src/lib/fct-facet-alias.ts");
  const groups = read("src/lib/fct-query-derived.ts");
  assert.match(source, /export function activeTransportedFacets/);
  assert.match(source, /const resolved = getPath\(index, parent, href\)/);
  assert.match(source, /id: `transported-anchor-\$\{ancestorId\}-\$\{focus\.id\}`/);
  assert.doesNotMatch(source, /createTransportedFacetQuery|createGroupValuesQuery/);
  assert.doesNotMatch(groups, /transportedGroupTarget: option\.nodeId/);
  assert.match(groups, /return createPersonalFacetValuesQuery\(sourceTree, option\.uri, option\.direction, paging,/);
  assert.match(groups, /option\.anchorId \? option\.nodeId : undefined/);
  assert.match(groups, /if \(option\.anchorId\) return projectTransportedGroupMember/);
});

test("viewer-only anchors stay out of the generic provider FCT WHERE snapshot", () => {
  const clone = read("src/lib/fct-query-clone.ts");
  const provider = read("src/lib/maestro-provider-xslt.ts");
  assert.match(clone, /plane === "data" && Object\.keys\(node\)\.some\(key => key === "a"/);
  assert.match(provider, /snapshotFctQueryXml\(options\.queryXml, "data"\)/);
  assert.match(provider, /<mctx:transported-facets\/>/);
  assert.match(provider, /facet\.setAttribute\("key", `alias:\$\{id\}`\)/);
  assert.match(provider, /if \(!options\.describeXml\)/);
  assert.match(provider, /hop\.setAttribute\("direction"/);
});

test("Map Color By can project exact multi-hop alias values", () => {
  const map = read("graph/map/perspective-ui.xsl");
  const bridge = read("src/lib/maestro-provider-dom.ts");
  assert.match(map, /mctx:transported-facets\/mctx:facet/);
  assert.match(map, /data-alias-id="\{@id\}"/);
  assert.match(map, /data-alias-hop="true"/);
  assert.match(map, /api\.projectValues\(projectionXml/);
  assert.match(map, /selected\.hops\.length \? \{ hops: selected\.hops \}/);
  assert.match(bridge, /mergeValuesQueryClone\(queryXml/);
  assert.match(bridge, /\.\.\.\(hops\?\.length \? \{ hops \} : \{\}\)/);
});

test("Analyze Table/Compare, Kanban, Sankey and Spider key remote dimensions by anchor ID", () => {
  const analyze = read("src/canvas/utils/workspace-controller.tsx");
  const table = read("src/canvas/tab/analyze/page.tsx");
  const coverage = read("src/lib/sankey-coverage.ts");
  const spider = read("src/lib/spider-numeric-policy.ts");
  const xslt = read("graph/maestro-analyze.ttl");
  assert.match(analyze, /analysisFacetKey\.split\("\\u0000"\)/);
  assert.match(analyze, /hops: alias\.path\.map/);
  assert.match(analyze, /scope\.id && analyzeTableHeaderNodes\.some/);
  assert.match(analyze, /option\.anchorId \? activeTransportedFacets/);
  assert.match(table, /header\.name === "a"/);
  assert.match(xslt, /node-id/);
  assert.match(coverage, /predicateKey\(s\.direction,s\.property,s\.anchorId\)/);
  assert.match(coverage, /predicateKey\(p\.direction,p\.iri,p\.anchorId\)/);
  assert.match(spider, /alias:\$\{axis\.anchorId\}/);
});

test("root labels and union UID alone receive green breadcrumb feedback; Record URI click is independent", () => {
  const crumbs=read("src/canvas/top/breadcrumb-renderers.tsx");
  const record=read("src/canvas/right/pane.tsx");
  const results=read("src/canvas/tab/browse/results-view.tsx");
  assert.match(crumbs, /data-maestro-root-label="true"/);
  assert.match(crumbs, /data-maestro-anchor-preview/);
  assert.match(crumbs, /!bg-emerald/);
  assert.match(record, /!event\.shiftKey && binding\.termType === "uri"/);
  assert.match(results, /item\.title \|\| \(item\.termType === "uri"/);
});
