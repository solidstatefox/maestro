import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('Bookmarks/History ribbon choices are gated to matching personal FCT graph and class', () => {
 const ids=read('src/lib/personal-perspective-ids.ts');
 const workspace=read('src/canvas/utils/workspace-controller.tsx');
 const view=read('src/canvas/tab/view/page.tsx');
 assert.match(ids,/personalPerspectiveMatchesQuery/);
 assert.match(ids,/namedGraph\.endsWith\(expectedGraph\)/);
 assert.match(ids,/tree\.attributes\.addr/);
 assert.match(ids,/node\.name === "class" && node\.attributes\.iri === expectedClass/);
 assert.match(workspace,/viewDiscoverySnapshot\.context\.items\.filter\(view => personalPerspectiveMatchesQuery\(view\.uri, queryTree\)\)/);
 assert.match(view,/personalPerspectiveMatchesQuery\(selectedViewUri, workspace\.queryTree\)/);
});

test('Status inspector is accessible on failure with XML and SPARQL/Execute', () => {
 const source=read('src/canvas/left/status-widget.tsx');
 assert.match(source,/fctQuery=\{entriesScope === queryXml \? fctQuery : inspectorXml\}/);
 assert.match(source,/extraQueries=\{fctQuery \? \[/);
 assert.match(source,/"SPARQL preview" : "SPARQL \(first batch\)"/);
 assert.match(source,/inspectorAddr=\{entriesScope === queryXml && executedAddr \? executedAddr : preview\.scope === queryXml \? preview\.addr : undefined\}/);
 assert.match(source,/compileFctXmlToSparql\(inspectorXml/);
 assert.match(source,/addr=\{inspectorAddr\}/);
 assert.match(source,/const scopedEntries = entriesScope === queryXml \? entries : \[\]/);
});

test('empty results retain a consistent gap underneath container headers', () => {
 assert.match(read('src/components/ui/maestro-empty-results.tsx'),/my-3/);
});

test('Sunburst wedge palette cannot produce white wedges', () => {
 const ttl=read('graph/sunburst/provider.ttl');
 assert.match(ttl, /' 66% '/);
 assert.match(ttl, /then '39' else '63'/);
 assert.doesNotMatch(ttl,/fill="(?:white|#fff(?:fff)?|rgb\(255, ?255, ?255\))"/i);
});
