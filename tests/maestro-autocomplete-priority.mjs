/* Optional Node behavioral regression tests; no Next.js server or remote store.
 * Run from project root: node tests/maestro-autocomplete-priority.mjs
 * Requires the project's regular TypeScript devDependency. */
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ts = require("typescript");

function loadTs(path, dependencies = {}) {
  const output = ts.transpileModule(fs.readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  const module = { exports };
  const scope = { console, URL, Headers, DOMException, AbortController, AbortSignal, setTimeout, clearTimeout };
  const fn = vm.runInNewContext(`(function(exports,require,module){${output}\n})`, scope, { filename: path });
  fn(exports, (name) => {
    if (!(name in dependencies)) throw new Error(`Unexpected test import ${name}`);
    return dependencies[name];
  }, module);
  return module.exports;
}

const sourceUriPolicy = loadTs("src/lib/root-uri-policy.ts");
const query = loadTs("src/lib/uri-autocomplete-query.ts", {
  "@/lib/root-uri-policy": sourceUriPolicy,
  "@/lib/uri-autocomplete-settings": { readUriAutocompleteSettings: () => ({ limit: 10, timeoutSeconds: 5 }) },
  "@/lib/virtuoso-full-text": loadTs("src/lib/virtuoso-full-text.ts"),
});
const addr = "http://example.net/people@https://example.net/sparql";
const q = query.createRootUriAutocompleteQuery("York", addr, {limit: 10,timeoutSeconds:5});
assert.match(q, /FILTER\(CONTAINS\(LCASE\(STR\(\?label\)\), "york"\)\)/);
assert.match(q, /GRAPH <http:\/\/example.net\/people>/);
assert.match(q, /LIMIT 10$/);
assert.match(q, /IRI_RANK/);
assert.match(q, /\?label bif:contains/);
assert.doesNotMatch(q, /ORDER BY LCASE/);
assert.equal(query.createRootUriAutocompleteQuery("https://example.org",addr,{limit:10,timeoutSeconds:5}),null);
assert.equal(query.createRootUriAutocompleteQuery("http:",addr,{limit:10,timeoutSeconds:5}),null);
assert.match(query.createRootUriAutocompleteQuery("A",addr,{limit:5,timeoutSeconds:5}), /LIMIT 5$/);
for (const draft of ["Ford", "Tim"]) {
  const dbpedia = query.createRootUriAutocompleteQuery(draft, "$ALL$@https://dbpedia.org/sparql", {limit:10,timeoutSeconds:15});
  assert.match(dbpedia, /\?label bif:contains/);
  assert.match(dbpedia, /ORDER BY DESC \(<LONG::IRI_RANK> \(\?uri\)\) LIMIT 10$/);
  assert.doesNotMatch(dbpedia, /GRAPH <\$ALL\$>/);
  assert.ok(dbpedia.length <= 1600);
}
assert.ok(q.length <= 1600, "Must satisfy bounded autocomplete proxy priority limit");
assert.match(q, /^SELECT DISTINCT \?uri \?label WHERE \{[\s\S]*\} ORDER BY DESC \(\<LONG::IRI_RANK\> \(\?uri\)\) LIMIT (?:[1-9]|10)$/i);
console.log("PASS URI full-text indexed candidates, substring match, rank and proxy priority shape");

const calls = [];
let unlock;
const firstSlot = new Promise(resolve => { unlock = resolve; });
const scheduler = loadTs("src/lib/graph-server-query-scheduler.ts", {
  "./maestro-proxy-client-preferences": {
    currentProxyClient: () => "test-client",
    getProxyClientPreferences: () => ({ lightPerServer: 1, heavyPerServer: 1 }),
  },
});
assert.equal(scheduler.classifyMaestroRequest("/proxy/api/sparql",new Headers(),'{"requestClass":"autocomplete"}'),"autocomplete");
assert.equal(scheduler.weightMaestroQuery("SELECT DISTINCT ?uri ?label", "autocomplete"),"light");
const hold = scheduler.scheduleMaestroQuery("https://example.net/sparql","interactive",undefined,async()=>{
  calls.push("running"); await firstSlot;
},"light");
const slow = scheduler.scheduleMaestroQuery("https://example.net/sparql","facet",undefined,async()=>{ calls.push("facet"); },"light");
const auto = scheduler.scheduleMaestroQuery("https://example.net/sparql","autocomplete",undefined,async()=>{ calls.push("autocomplete"); },"light");
assert.deepEqual(calls,["running"]);
unlock();
await Promise.all([hold,slow,auto]);
assert.deepEqual(calls,["running","autocomplete","facet"]);
console.log("PASS autocomplete dispatch jumps ahead of earlier queued facet queries");
