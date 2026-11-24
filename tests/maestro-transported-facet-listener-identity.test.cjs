const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
function load(file, imports = {}) {
  const {outputText} = ts.transpileModule(read(file), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}});
  const mod = {exports: {}};
  new Function("require", "module", "exports", outputText)(name => {
    if (Object.hasOwn(imports, name)) return imports[name];
    throw new Error(`Unexpected import ${name}`);
  }, mod, mod.exports);
  return mod.exports;
}
const paths = load("src/lib/fct-get-path.ts");
// Resolver and identity comparison are pure; unrelated query derivation is not invoked.
const {activeTransportedFacets, sameTransportedFacetIdentity} = load("src/lib/fct-facet-alias.ts", {
  "./fct-query-api": {}, "./fct-query-derived": {}, "./fct-get-path": paths,
});
const node = (id, name, attributes = {}, children = []) => ({id, name, attributes, children});
const tree = () => ({name: "query", attributes: {id: "a", addr: "$ALL$@https://cordis.europa.eu/datalab/sparql"}, children: [
  node("a3", "property", {iri: "http://data.europa.eu/s66#hasEuroSciVocClassification"}, [
    node("a6", "property", {iri: "http://www.w3.org/2008/05/skos-xl#altLabel"}, [
      node("a8", "property", {iri: "http://www.w3.org/2008/05/skos-xl#literalForm"}),
    ]),
  ]),
  node("anchor", "a", {href: "a8"}), node("a2", "view", {type: "list"}),
]});
test("freshly resolved CORDIS anchor matches the widget and mounts its listener", () => {
  const t = tree();
  const [widgetAnchor] = activeTransportedFacets(t);
  const [candidate] = activeTransportedFacets(t);
  assert.ok(candidate && widgetAnchor);
  assert.notEqual(candidate.path[0], widgetAnchor.path[0]);
  assert.equal(candidate.path.every((hop, i) => hop === widgetAnchor.path[i]), false);
  assert.equal(sameTransportedFacetIdentity(candidate, widgetAnchor), true);
  assert.equal(sameTransportedFacetIdentity(activeTransportedFacets(structuredClone(t))[0], widgetAnchor), true);
  assert.match(read("src/canvas/workspace.tsx"), /sameTransportedFacetIdentity\(candidate, widget\.anchor\)/);
  assert.match(read("src/canvas/left/personal-widget-cards.tsx"), /sameTransportedFacetIdentity\(alias, widget\.anchor\)/);
});
test("stale anchor identity, ownership, target, or hop cannot mount against a different query", () => {
  const [anchor] = activeTransportedFacets(tree());
  for (const field of ["id", "href", "parentId"]) assert.equal(sameTransportedFacetIdentity(anchor, {...anchor, [field]: "different"}), false);
  for (const field of ["id", "iri", "direction"]) {
    const other = structuredClone(anchor);
    other.path[1][field] = field === "direction" ? "reverse" : "different";
    assert.equal(sameTransportedFacetIdentity(anchor, other), false);
  }
  assert.equal(sameTransportedFacetIdentity(anchor, {...anchor, path: anchor.path.slice(1)}), false);
  assert.equal(sameTransportedFacetIdentity(anchor, undefined), false);
  assert.equal(sameTransportedFacetIdentity(undefined, undefined), true);
  const replaced = tree(); replaced.children = [node("a2", "view", {type: "list"})];
  assert.equal(activeTransportedFacets(replaced).some(other => sameTransportedFacetIdentity(other, anchor)), false);
});
test("widget preparation and parsing contribute to navigation activity, and Abort settles loading", () => {
  const controller = read("src/canvas/utils/workspace-controller.tsx");
  const listener = read("src/canvas/left/filter.tsx");
  assert.match(controller, /queryActivityPending: \(urlStateInitialized && endpointReadyForQuery && !focusWidgetsSuppressed && personalWidgets\.some\(widget => widget\.loading/);
  assert.match(controller, /function cancelMaestroPage\(\) \{\s*stopPendingMaestroQueries\(\);\s*setPersonalWidgets\(/);
  assert.match(listener, /if \(cancelled\) return;\s*if \(!timedOut && error instanceof Error && error\.name === "AbortError"\) \{[\s\S]*?loading: false/);
});
