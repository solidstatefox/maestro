const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function loadTS(file, dependencies = {}) {
  const code = fs.readFileSync(path.join(root, file), 'utf8');
  const js = ts.transpileModule(code, {compilerOptions:{module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  const mod = {exports:{}};
  vm.runInNewContext(js, {module:mod, exports:mod.exports, require(id) {
    if (Object.prototype.hasOwnProperty.call(dependencies, id)) return dependencies[id];
    throw Error(`Unexpected import ${id} in ${file}`);
  }, Response, ReadableStream, Headers, DOMException, TextDecoder, TextEncoder, URL, Map, Set, AbortController}, {filename:file});
  return mod.exports;
}

test('facet descriptor rows are distinct and keep grouped counts rather than summing them', () => {
  const {normalizeFctFacetItems} = loadTS('src/lib/fct-facet-normalization.ts', {
    './uri-labels': {toLabel: iri => iri.split('/').pop()}
  });
  const output = normalizeFctFacetItems([
    {uri:'http://example/role',label:'role',count:35},
    {uri:'http://example/role',label:'Role',count:35},
    {uri:'http://example/other',label:'Other',count:3},
  ]);
  assert.equal(output.length,2);
  assert.equal(output[0].label,'Role');
  assert.equal(output[0].count,35);
  assert.equal(output[1].count,3);
});

test('hierarchy normalization preserves distinct parent edges', () => {
  const {normalizeFctFacetItems} = loadTS('src/lib/fct-facet-normalization.ts', {
    './uri-labels': {toLabel: iri => iri.split('/').pop()}
  });
  const output = normalizeFctFacetItems([
    {uri:'http://example/Child', parent:'http://example/Parent1',label:'Child', count:10},
    {uri:'http://example/Child', parent:'http://example/Parent2',label:'Child', count:10},
    {uri:'http://example/Child', parent:'http://example/Parent1',label:'Child', count:10},
  ], true);
  assert.equal(output.length,2);
});

test('separate /events reader normalizes CRLF boundaries and does not reconstruct query responses', () => {
  const source = fs.readFileSync(path.join(root,'src/lib/client-query-events.ts'),'utf8');
  assert.ok(source.includes('buffer = buffer.replace(/\\r\\n/g, "\\n")'));
  assert.ok(source.includes('buffer.indexOf("\\n\\n")'));
  assert.doesNotMatch(source,/new Response\(data\.body/);
});

test('one queue tracker reports browser slots separately from telemetry-owned proxy lanes', () => {
  const source = fs.readFileSync(path.join(root,'src/lib/client-query-cache.ts'),'utf8');
  assert.match(source,/serverQueueIndex.*> 0/);
  assert.match(source,/requestQueue\.forEach/);
  assert.match(source,/const browserPositions = new Map<AbortController, number>\(\)/);
  assert.match(source,/browserPositions\.set\(job\.owner, index \+ 1\)/);
  assert.match(source,/const next = detail\.state === "queued" \? browserPositions\.get\(controller\) \?\? 0 : 0/);
  assert.match(source,/serverQueueIndex: queueIndex/);
  assert.match(source,/serverQueueLaneNumber: laneNumber, serverQueueLanePosition: lanePosition/);
  assert.match(source,/refreshPendingQueueIndexes\(\)/);
  assert.match(source,/notifyPendingQueryDetails\(\)/);
  assert.doesNotMatch(source,/const displayPositions = new Map/);
  assert.match(source,/return aPosition - bPosition \|\| a\.id - b\.id/);
});

test('Personal Perspectives HTML requires matching query/render signature', () => {
  const source=fs.readFileSync(path.join(root,'src/canvas/tab/view/personal-perspectives.tsx'),'utf8');
  assert.match(source,/setRenderedSignature\(contentSignature\)/);
  assert.match(source,/scopeIsReady && renderedSignature === contentSignature \? html : ""/);
  assert.match(source,/if \(!collection \|\| !scopeIsReady\) return/);
});

test('Configure stages only OR membership; ordinary edits remain live',()=>{
  const source=fs.readFileSync(path.join(root,'src/canvas/left/configure-pane.tsx'),'utf8');
  const machine=fs.readFileSync(path.join(root,'src/lib/app-lifecycle/configure.ts'),'utf8');
  assert.match(source,/configureController\.send\(\{ type: "ASSIGN", key, uid \}\)/);
  assert.match(source,/replaceLiveQuery\(\{ \.\.\.next/);
  assert.match(machine,/membership: Record<string, string \| null>/);
  assert.doesNotMatch(machine,/(?:pendingProperties|pendingCategories|pendingRoles)/);
});

test('auxiliary sampled Record metadata cannot override FCT result labels', () => {
  const source=fs.readFileSync(path.join(root,'src/canvas/utils/fct-response.ts'),'utf8');
  assert.match(source,/const isDisplayLabel = \(column: FctResponseColumn\)/);
  assert.match(source,/sampleSubject\|recordAncestor/);
  assert.match(source,/column\.termType === "literal"/);
});

test('Role value requests depend on the serialized FCT query, not a transient tree identity', () => {
  const source=fs.readFileSync(path.join(root,'src/canvas/left/filter.tsx'),'utf8');
  // The serialized FCT XML remains the query identity; the explicit retry
  // epoch is an independent request trigger, not the transient tree object.
  assert.match(source,/\[uri, widgetQueryXml, roleOrderLikeGroups, endpointReady, refreshRevision, retryRevision\]/);
  assert.match(source,/useMaestroComponentRetry\(`personal-role:\$\{uri\}`\)/);
  assert.match(source,/componentRetryHeaders\(retryRevision\)/);
  assert.doesNotMatch(source,/\[uri, widgetQueryXml, tree, roleOrderLikeGroups/);
});

test('bookmarked Status counts and query inspector stay bound to matching FCT scope', () => {
  const source=fs.readFileSync(path.join(root,'src/canvas/left/status-widget.tsx'),'utf8');
  assert.match(source,/const \[entriesScope, setEntriesScope\] = useState/);
  assert.match(source,/setEntriesScope\(queryXml\)/);
  assert.match(source,/const scopedEntries = entriesScope === queryXml \? entries : \[\]/);
  // Counts remain scope-gated, while the inspector can show a current-scope
  // XML/compiled SPARQL preview even when the Status request has failed.
  assert.match(source,/const scopedEntries = entriesScope === queryXml \? entries : \[\]/);
  assert.match(source,/fctQuery=\{entriesScope === queryXml \? fctQuery : inspectorXml\}/);
  assert.match(source,/preview.scope === queryXml \? preview.sparql : ""/);
});
