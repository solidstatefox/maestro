import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseFctExecutionAddress, updateFctExecutionAddress, sparqlEditorUrl } from '../src/lib/fct-execution-address.ts';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const oldAddr = 'https://example.org/old-graph@https://vec.demo.openlinksw.com/sparql';
const newEndpoint = 'https://demo.openlinksw.com/sparql';
const newGraph = 'http://demo.openlinksw.com/ods/home/acme/query/status';

test('the one execution-address utility independently updates graph and server', () => {
  assert.deepEqual(parseFctExecutionAddress(oldAddr), {graph:'https://example.org/old-graph', endpoint:'https://vec.demo.openlinksw.com/sparql'});
  assert.equal(updateFctExecutionAddress(oldAddr, { endpoint: newEndpoint }), `https://example.org/old-graph@${newEndpoint}`);
  assert.equal(updateFctExecutionAddress(oldAddr, { graph: newGraph }), `${newGraph}@https://vec.demo.openlinksw.com/sparql`);
  assert.equal(updateFctExecutionAddress(oldAddr, { graph: newGraph, endpoint: newEndpoint }), `${newGraph}@${newEndpoint}`);
  assert.equal(parseFctExecutionAddress('invalid'), null);
  assert.equal(parseFctExecutionAddress('x@https://username:pass@example.org/sparql'), null);
});

test('SPARQL Execute points to the displayed execution target, including the selected graph', () => {
  const query='SELECT ?s WHERE { ?s ?p ?o } LIMIT 1';
  const uri=sparqlEditorUrl(`${newGraph}@${newEndpoint}`,query);
  assert.ok(uri);
  const url=new URL(uri);
  assert.equal(url.origin, 'https://demo.openlinksw.com');
  assert.equal(url.searchParams.get('qtxt'),query);
  assert.equal(url.searchParams.get('default-graph-uri'),newGraph);
  assert.equal(sparqlEditorUrl(undefined,query),null);
  assert.equal(sparqlEditorUrl(oldAddr.replace('/sparql','/not-a-sparql-editor'),query),null);
});

test('all query cloners share an optional target address; the live query remains detached', () => {
  const clone=read('src/lib/fct-query-clone.ts');
  assert.match(clone,/function cloneFctQueryTree\([^)]*executionAddr\?: string/);
  assert.match(clone,/function snapshotFctQueryXml\([^)]*executionAddr\?: string/);
  assert.match(clone,/function withFctQueryExecutionAddress\(xml: string, executionAddr: string\)/);
  assert.match(clone,/"@_addr": executionAddr/);
  assert.match(clone,/if \("@_graph" in attributes\)/);
});

test('all SPARQL Code Blocks use explicit provenance, never the current Browse query', () => {
  const block=read('src/components/ui/code-block.tsx');
  const inspector=read('src/canvas/utils/query-inspector.tsx');
  assert.doesNotMatch(block,/useFctQuery|tree\.attributes\.addr/);
  assert.match(block,/sparqlEditorUrl\(executionAddr, code\)/);
  assert.match(inspector,/addr: displayedExecutionAddr/);
  assert.match(inspector,/withFctQueryExecutionAddress\(selectedCode, displayedExecutionAddr\)/);
  assert.match(inspector,/executionAddr=\{displayedExecutionAddr\}/);
  assert.match(read('src/canvas/top/root-autocomplete-query-inspector.tsx'),/executionAddr=\{addr\}/);
  assert.match(read('src/canvas/workspace.tsx'),/executionAddr=\{fctQueryExecutionAddress\(bookmarkQueryDebug.xml\)\}/);
});

test('the FCT response carries the server the proxy executed against to the Results SPARQL Code Block', () => {
  const route=read('src/app/proxy/api/fct/route.ts');
  assert.match(route,/execution-addr=/);
  assert.match(route,/endpoint: executionEndpoint/);
  const parser=read('src/canvas/utils/fct-response.ts');
  assert.match(parser,/getAttribute\("execution-addr"\)/);
  const controller=read('src/canvas/utils/workspace-controller.tsx');
  assert.match(controller,/setSparqlExecutionAddr\(data.executionAddr \|\| ""\)/);
  const center=read('src/canvas/center/pane.tsx');
  assert.match(center,/executionAddr=\{querySourceFormat === "sparql" \? sparqlExecutionAddr/);
});

test('Status uses read-only ODS+remote operations while preserving provenance and proxy 401 diagnostics', () => {
  const route=read('src/app/proxy/api/fct/route.ts');
  // The legacy proxy handler is deliberately untouched so unrelated callers
  // and its 401 diagnostics have not been silently changed.
  assert.match(route,/const statusViewXml = cloneFctListStatusView\(bookmarkQueryXml\)/);
  assert.match(route,/queryPersonalSparql\(query, compiled.timeoutMs, request\)/);
  assert.match(route,/Upstream response body:/);
  assert.match(route,/SPARQL submitted by Maestro:/);
  const client=read('src/lib/fct-client.ts');
  // The final request identity routes the Status reads through the proxy
  // dispatch clock; it does not change their read-only SPARQL semantics.
  assert.match(client,/selectPersonal\(countQuery, ctx, signal, "status-facet-count"\)/);
  assert.match(client,/selectPersonal\(query, ctx, signal, "status-facet-personal"\)/);
  assert.match(client,/compileFctXmlToSparql\(fctQuery/);
  assert.match(client,/\"\/proxy\/api\/sparql\"/);
  assert.match(client,/fctListStatusClone\(liveXml, sourceAddr\)/);
  assert.match(client,/addr: sourceAddr/);
});
